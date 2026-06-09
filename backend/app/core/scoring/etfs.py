"""
ETF scorer — computes composite 0–100 scores for ETF assets.

Factor source matrix (§6):
  Cost (expense ratio)          20%   fundamentals snapshot
  Liquidity & AUM               25%   mixed (AUM from fundamentals; ADV from prices)
  Risk-adjusted return          30%   price data  (Sharpe, rf=0)
  Diversification benefit       25%   price data  (correlation to SPY)

Market proxy for diversification: SPY (see base.MARKET_PROXY_TICKER).
If SPY prices are absent, the diversification factor is marked N/A.

Scoring is cross-sectional within the ETF cohort.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from app.core.scoring.base import (
    MARKET_PROXY_TICKER,
    MIN_CORR_OVERLAP,
    MIN_ROWS_SHARPE,
    FactorScore,
    ScoreResult,
    aligned_returns,
    batch_rank,
    compute_composite,
    compute_daily_returns,
    factor_from_subs,
    normalize_weights,
    pearson_corr,
    sharpe,
)
from app.data.providers.base import PriceRow


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EtfScorer:
    """Batch scorer for ETF assets.

    No network calls are made — all data comes from the passed-in arguments.
    """

    def score_batch(
        self,
        fundamentals: list[dict[str, Any]],
        prices_by_ticker: dict[str, list[PriceRow]],
    ) -> list[ScoreResult]:
        """Score all ETFs cross-sectionally.

        Args:
            fundamentals: list of dicts from FundamentalsReader.read_all()
                          (asset_class == "etf" records).
            prices_by_ticker: mapping ticker → list[PriceRow].
                              Must include the market proxy (SPY) for
                              diversification; if absent that factor is N/A.

        Returns:
            One ScoreResult per ticker in *fundamentals*.
        """
        if not fundamentals:
            return []

        fund_by_ticker = {r["ticker"]: r for r in fundamentals}
        tickers = list(fund_by_ticker.keys())
        prices_computed_at = _utcnow()
        snapshot_date: Optional[str] = (
            str(fundamentals[0].get("snapshot_date"))
            if fundamentals[0].get("snapshot_date") is not None
            else None
        )

        spy_rows: list[PriceRow] = prices_by_ticker.get(MARKET_PROXY_TICKER, [])

        # ------------------------------------------------------------------ #
        # Pass 1: collect raw sub-factor values for cross-sectional ranking   #
        # ------------------------------------------------------------------ #

        # — Cost (fundamentals) —
        expense_vals: dict[str, float] = {}
        for t in tickers:
            er = fund_by_ticker[t].get("expense_ratio")
            if er is not None and er >= 0:
                expense_vals[t] = er

        expense_ranks = batch_rank(expense_vals, higher_is_better=False)

        # — Liquidity & AUM (mixed) —
        aum_vals: dict[str, float] = {}
        adv_vals: dict[str, float] = {}

        for t in tickers:
            f = fund_by_ticker[t]
            ta = f.get("total_assets")
            if ta is not None and ta > 0:
                aum_vals[t] = ta

            rows = prices_by_ticker.get(t, [])
            vols = [r.volume for r in rows if r.volume is not None and r.volume > 0]
            if vols:
                adv_vals[t] = sum(vols) / len(vols)
            else:
                avg_vol = f.get("average_volume")
                if avg_vol is not None and avg_vol > 0:
                    adv_vals[t] = avg_vol

        aum_ranks = batch_rank(aum_vals, higher_is_better=True)
        adv_ranks = batch_rank(adv_vals, higher_is_better=True)

        # — Risk-adjusted return (prices, rf=0) —
        sharpe_vals: dict[str, float] = {}

        for t in tickers:
            daily_rets = compute_daily_returns(prices_by_ticker.get(t, []))
            if len(daily_rets) >= MIN_ROWS_SHARPE:
                s = sharpe(daily_rets)
                if s is not None:
                    sharpe_vals[t] = s

        sharpe_ranks = batch_rank(sharpe_vals, higher_is_better=True)

        # — Diversification benefit (correlation to SPY) —
        # Lower correlation → better diversification → negate for ranking
        corr_vals: dict[str, float] = {}

        for t in tickers:
            if not spy_rows:
                break  # all ETFs get N/A; no SPY data
            etf_rows = prices_by_ticker.get(t, [])
            etf_rets, spy_rets = aligned_returns(etf_rows, spy_rows)
            if len(etf_rets) >= MIN_CORR_OVERLAP:
                corr = pearson_corr(etf_rets, spy_rets)
                if corr is not None:
                    corr_vals[t] = corr

        # Lower correlation is better → higher_is_better=False
        corr_ranks = batch_rank(corr_vals, higher_is_better=False)

        # ------------------------------------------------------------------ #
        # Pass 2: build one ScoreResult per ticker                            #
        # ------------------------------------------------------------------ #

        results: list[ScoreResult] = []

        for t in tickers:
            f = fund_by_ticker[t]

            # Sharpe raw for sub-factor detail
            daily_rets = compute_daily_returns(prices_by_ticker.get(t, []))
            sharpe_raw = (
                sharpe(daily_rets) if len(daily_rets) >= MIN_ROWS_SHARPE else None
            )

            # ADV raw for detail
            rows = prices_by_ticker.get(t, [])
            vols = [r.volume for r in rows if r.volume is not None and r.volume > 0]
            adv_raw = sum(vols) / len(vols) if vols else f.get("average_volume")

            # Correlation raw for detail
            corr_raw = corr_vals.get(t)

            # Diversification N/A reason
            if not spy_rows:
                div_na_reason = f"market proxy ({MARKET_PROXY_TICKER}) prices unavailable"
            elif t not in corr_vals:
                div_na_reason = (
                    f"fewer than {MIN_CORR_OVERLAP} aligned dates with "
                    f"{MARKET_PROXY_TICKER} or insufficient price data"
                )
            else:
                div_na_reason = "no data"

            factors: list[FactorScore] = [
                factor_from_subs(
                    "cost", 0.20, "fundamentals",
                    [
                        ("expense_ratio", f.get("expense_ratio"), expense_ranks.get(t),
                         "missing expense ratio in snapshot"),
                    ],
                ),
                factor_from_subs(
                    "liquidity_aum", 0.25, "mixed",
                    [
                        ("aum", f.get("total_assets"), aum_ranks.get(t),
                         "missing or non-positive total assets in snapshot"),
                        ("adv", adv_raw, adv_ranks.get(t),
                         "no volume data in prices or snapshot"),
                    ],
                ),
                factor_from_subs(
                    "risk_adjusted_return", 0.30, "prices",
                    [
                        ("sharpe", sharpe_raw, sharpe_ranks.get(t),
                         f"fewer than {MIN_ROWS_SHARPE} price rows or zero volatility"),
                    ],
                ),
                factor_from_subs(
                    "diversification_benefit", 0.25, "prices",
                    [
                        ("correlation_to_market", corr_raw, corr_ranks.get(t),
                         div_na_reason),
                    ],
                ),
            ]

            normalize_weights(factors)
            composite = compute_composite(factors)

            results.append(
                ScoreResult(
                    ticker=t,
                    asset_class="etf",
                    score_value=composite,
                    has_missing_factors=any(f.is_na for f in factors),
                    factors=factors,
                    fundamentals_snapshot_date=snapshot_date,
                    prices_computed_at=prices_computed_at,
                )
            )

        return results
