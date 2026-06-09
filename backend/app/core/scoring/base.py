"""
Scoring base — shared types, cross-sectional ranking helpers, stats utilities,
weight normalization, and the score cache write-through service.

Design notes
────────────
• All scoring is cross-sectional: every sub-factor is percentile-ranked within
  the asset class so that scores are comparable across the universe.
• Risk-free rate is 0.0.  The plan references a FRED T-bill snapshot for
  portfolio-metrics (§8), but that data is not available at scoring runtime.
  Using rf=0 is equivalent to computing "excess returns above cash"; it is
  safe, clearly documented, and does not require an external source.
• Market proxy for ETF diversification: SPY.  If SPY prices are absent from
  the price batch, the ETF diversification factor is marked N/A.
• Forbidden forecasting terms: expected return, forecast, predicted, projected,
  anticipated — not used anywhere in this module.
"""

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.tables import AssetScoreCache as _AssetScoreCacheRow

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RISK_FREE_RATE: float = 0.0
MARKET_PROXY_TICKER: str = "SPY"

# Minimum number of price rows for each computation
MIN_ROWS_3M: int = 64      # ~3 trading months
MIN_ROWS_6M: int = 127     # ~6 trading months
MIN_ROWS_12M: int = 253    # ~12 trading months
MIN_ROWS_MA200: int = 200  # 200-day moving average
MIN_ROWS_SHARPE: int = 30  # minimum for a meaningful Sharpe/Sortino
MIN_CORR_OVERLAP: int = 30 # minimum aligned dates for correlation


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class FactorScore:
    name: str
    weight: float           # nominal weight from §6 (e.g. 0.25)
    effective_weight: float # re-normalized after N/A exclusion; 0.0 when N/A
    score: Optional[float]  # 0–100; None when factor is entirely N/A
    is_na: bool
    na_reason: Optional[str]
    source: str             # "fundamentals" | "prices" | "mixed"
    sub_factors: dict[str, Any] = field(default_factory=dict)
    # sub_factors schema: {name: {raw, score, is_na, na_reason}}


@dataclass
class ScoreResult:
    ticker: str
    asset_class: str
    score_value: Optional[float]   # composite 0–100; None if all factors N/A
    has_missing_factors: bool
    factors: list[FactorScore]
    fundamentals_snapshot_date: Optional[str]  # ISO date from snapshot
    prices_computed_at: Optional[datetime]

    def to_breakdown_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict for the Universe Explorer."""
        return {
            "asset_class": self.asset_class,
            "score_value": self.score_value,
            "has_missing_factors": self.has_missing_factors,
            "fundamentals_snapshot_date": self.fundamentals_snapshot_date,
            "prices_computed_at": (
                self.prices_computed_at.isoformat()
                if self.prices_computed_at else None
            ),
            "factors": [
                {
                    "name": f.name,
                    "weight": round(f.weight, 4),
                    "effective_weight": round(f.effective_weight, 4),
                    "score": round(f.score, 2) if f.score is not None else None,
                    "is_na": f.is_na,
                    "na_reason": f.na_reason,
                    "source": f.source,
                    "sub_factors": f.sub_factors,
                }
                for f in self.factors
            ],
        }


# ---------------------------------------------------------------------------
# Weight normalization
# ---------------------------------------------------------------------------

def normalize_weights(factors: list[FactorScore]) -> None:
    """Re-normalize effective_weight in-place.

    N/A factors receive effective_weight = 0.0.
    Available factors share the full 1.0 weight proportional to their nominal weights.
    """
    total = sum(f.weight for f in factors if not f.is_na)
    for f in factors:
        if f.is_na:
            f.effective_weight = 0.0
        else:
            f.effective_weight = (f.weight / total) if total > 0.0 else 0.0


def compute_composite(factors: list[FactorScore]) -> Optional[float]:
    """Weighted average of available (non-N/A) factor scores.

    Returns None when all factors are N/A.
    """
    available = [f for f in factors if not f.is_na and f.score is not None]
    if not available:
        return None
    raw = sum(f.score * f.effective_weight for f in available)
    return max(0.0, min(100.0, raw))


# ---------------------------------------------------------------------------
# Cross-sectional percentile ranking
# ---------------------------------------------------------------------------

def _percentile_rank(
    all_values: list[float],
    x: float,
    higher_is_better: bool,
) -> float:
    """Return the percentile rank of x within all_values, scaled 0–100.

    Uses the "mid-rank" convention for ties: (below + 0.5*equal) / n * 100.
    For a single-element list, returns 50.0 (neutral rank).
    """
    n = len(all_values)
    if n == 0:
        return 50.0
    if higher_is_better:
        below = sum(1 for v in all_values if v < x)
        equal = sum(1 for v in all_values if v == x)
    else:
        below = sum(1 for v in all_values if v > x)
        equal = sum(1 for v in all_values if v == x)
    return max(0.0, min(100.0, (below + 0.5 * equal) / n * 100.0))


def batch_rank(
    ticker_values: dict[str, float],
    higher_is_better: bool = True,
) -> dict[str, float]:
    """Cross-sectional percentile rank.

    Args:
        ticker_values: mapping of ticker → raw value.
        higher_is_better: if True, higher raw value → higher rank.

    Returns:
        mapping of ticker → percentile score 0–100.
    """
    if not ticker_values:
        return {}
    all_vals = list(ticker_values.values())
    return {
        ticker: _percentile_rank(all_vals, x, higher_is_better)
        for ticker, x in ticker_values.items()
    }


# ---------------------------------------------------------------------------
# Factor builder helper
# ---------------------------------------------------------------------------

SubFactorTuple = tuple[str, Any, Optional[float], str]
# (sub_name, raw_value, rank_score_or_none, na_reason_if_missing)

def factor_from_subs(
    name: str,
    weight: float,
    source: str,
    sub_items: list[SubFactorTuple],
) -> FactorScore:
    """Build a FactorScore by averaging available sub-factor percentile scores.

    Each sub_item is (sub_name, raw_value, rank_score | None, na_reason_if_missing).
    If rank_score is None the sub-factor is excluded from the average and its
    na_reason is recorded in the breakdown.
    If no sub-factors have scores the factor is marked N/A.
    """
    sub_factors: dict[str, Any] = {}
    scores: list[float] = []

    for sub_name, raw, score, na_reason_if_missing in sub_items:
        is_na = score is None
        sub_factors[sub_name] = {
            "raw": raw,
            "score": round(score, 2) if score is not None else None,
            "is_na": is_na,
            "na_reason": na_reason_if_missing if is_na else None,
        }
        if score is not None:
            scores.append(score)

    if not scores:
        return FactorScore(
            name=name,
            weight=weight,
            effective_weight=0.0,
            score=None,
            is_na=True,
            na_reason=f"no sub-factors available from {source}",
            source=source,
            sub_factors=sub_factors,
        )

    factor_score = sum(scores) / len(scores)
    return FactorScore(
        name=name,
        weight=weight,
        effective_weight=weight,   # will be re-normalized by caller
        score=max(0.0, min(100.0, factor_score)),
        is_na=False,
        na_reason=None,
        source=source,
        sub_factors=sub_factors,
    )


# ---------------------------------------------------------------------------
# Price statistics helpers
# ---------------------------------------------------------------------------

def compute_daily_returns(
    price_rows: list,  # list[PriceRow] — avoid circular import; duck-typed
) -> list[float]:
    """Compute daily log-linear returns from sorted adjusted_close prices.

    Rows with None adjusted_close are skipped.
    """
    valid = sorted(
        (r for r in price_rows if r.adjusted_close is not None),
        key=lambda r: r.date,
    )
    prices = [r.adjusted_close for r in valid]
    if len(prices) < 2:
        return []
    return [
        (prices[i] / prices[i - 1]) - 1.0
        for i in range(1, len(prices))
        if prices[i - 1] > 0
    ]


def sharpe(daily_returns: list[float], rf: float = RISK_FREE_RATE) -> Optional[float]:
    """Annualized Sharpe ratio.  Returns None when vol is zero or data insufficient."""
    n = len(daily_returns)
    if n < 2:
        return None
    mean_r = sum(daily_returns) / n
    variance = sum((r - mean_r) ** 2 for r in daily_returns) / (n - 1)
    vol = math.sqrt(variance) if variance > 0 else 0.0
    if vol == 0.0:
        return None
    ann_return = mean_r * 252
    ann_vol = vol * math.sqrt(252)
    return (ann_return - rf) / ann_vol


def sortino(daily_returns: list[float], rf: float = RISK_FREE_RATE) -> Optional[float]:
    """Annualized Sortino ratio.  Returns None when downside vol is zero."""
    n = len(daily_returns)
    if n < 2:
        return None
    mean_r = sum(daily_returns) / n
    downs = [r for r in daily_returns if r < rf]
    if len(downs) < 2:
        return None
    down_mean = sum(downs) / len(downs)
    down_var = sum((r - down_mean) ** 2 for r in downs) / (len(downs) - 1)
    down_vol = math.sqrt(down_var) if down_var > 0 else 0.0
    if down_vol == 0.0:
        return None
    ann_return = mean_r * 252
    ann_down_vol = down_vol * math.sqrt(252)
    return (ann_return - rf) / ann_down_vol


def pearson_corr(x: list[float], y: list[float]) -> Optional[float]:
    """Pearson correlation between two equal-length series.  Returns None if insufficient."""
    n = len(x)
    if n < 2 or len(y) != n:
        return None
    mx = sum(x) / n
    my = sum(y) / n
    dx = [xi - mx for xi in x]
    dy = [yi - my for yi in y]
    cov = sum(a * b for a, b in zip(dx, dy)) / n
    sx = math.sqrt(sum(a * a for a in dx) / n)
    sy = math.sqrt(sum(b * b for b in dy) / n)
    if sx == 0.0 or sy == 0.0:
        return None
    return max(-1.0, min(1.0, cov / (sx * sy)))


def aligned_returns(
    rows_a: list,  # list[PriceRow]
    rows_b: list,  # list[PriceRow]
) -> tuple[list[float], list[float]]:
    """Return two aligned daily return series sharing common dates."""
    def _date_returns(rows: list) -> dict:
        sorted_rows = sorted(
            (r for r in rows if r.adjusted_close is not None),
            key=lambda r: r.date,
        )
        result = {}
        for i in range(1, len(sorted_rows)):
            prev, curr = sorted_rows[i - 1], sorted_rows[i]
            if prev.adjusted_close and prev.adjusted_close > 0:
                result[curr.date] = curr.adjusted_close / prev.adjusted_close - 1.0
        return result

    ra = _date_returns(rows_a)
    rb = _date_returns(rows_b)
    common = sorted(set(ra) & set(rb))
    return [ra[d] for d in common], [rb[d] for d in common]


# ---------------------------------------------------------------------------
# Score cache write-through
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ScoreCacheWriter:
    """Writes ScoreResult objects to the asset_score_cache table (upsert by ticker)."""

    def write(self, db: Session, result: ScoreResult) -> None:
        existing: Optional[_AssetScoreCacheRow] = db.get(
            _AssetScoreCacheRow, result.ticker
        )
        breakdown = result.to_breakdown_dict()
        if existing is not None:
            existing.score_value = result.score_value
            existing.breakdown = breakdown
            existing.fundamentals_snapshot_date = result.fundamentals_snapshot_date
            existing.prices_computed_at = result.prices_computed_at
        else:
            db.add(
                _AssetScoreCacheRow(
                    ticker=result.ticker,
                    score_value=result.score_value,
                    breakdown=breakdown,
                    fundamentals_snapshot_date=result.fundamentals_snapshot_date,
                    prices_computed_at=result.prices_computed_at,
                )
            )
        db.commit()

    def write_batch(self, db: Session, results: list[ScoreResult]) -> None:
        for r in results:
            self.write(db, r)
