"""
Portfolio construction orchestrator — Task 8 core algorithm.

Produces 3 candidate portfolio variants (Core, Growth Tilt, Defensive Tilt)
from a scored asset universe using:
  1. Filter  — risk-level vol ceiling + optional min ADV
  2. Rank    — variant-adjusted composite score
  3. Select  — greedy correlation-aware selection with relaxation
  4. Allocate — risk parity within each class, then class-level weights
  5. Constraints — verify and log any violations

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.

Construction Algorithm Lock (§3):
  - No hardcoded portfolios, sample allocations, or demo constants.
  - All outputs are generated dynamically from the input scored assets.
  - Test fixtures live only under tests/ and are never imported here.
"""

import math
from dataclasses import dataclass, field
from typing import Any, Optional

from app.core.allocation import (
    MAX_POSITIONS,
    MIN_POSITIONS,
    SINGLE_ASSET_MAX,
    allocate,
    check_constraints,
    get_risk_profile,
)
from app.core.correlation import (
    MAX_RELAXATIONS,
    MIN_SELECTED_ASSETS,
    compute_correlation,
    get_threshold,
)

# ---------------------------------------------------------------------------
# Variant factor-weight adjustments  (§7 — ±10% tilt logic)
# Deltas sum to zero within each table to preserve total weight = 1.
# ---------------------------------------------------------------------------

_STOCK_FACTOR_DELTAS: dict[str, dict[str, float]] = {
    "core": {},
    "growth_tilt": {
        "momentum":           +0.10,
        "quality":            +0.05,
        "value":              -0.10,
        "volatility_adjusted": -0.05,
        # size_liquidity: 0
    },
    "defensive_tilt": {
        "volatility_adjusted": +0.10,
        "quality":             +0.05,
        "momentum":            -0.10,
        "value":               +0.05,
        "size_liquidity":      -0.10,
    },
}

_ETF_FACTOR_DELTAS: dict[str, dict[str, float]] = {
    "core": {},
    "growth_tilt": {
        "risk_adjusted_return":  +0.10,
        "cost":                  -0.05,
        "diversification_benefit": -0.05,
        # liquidity_aum: 0
    },
    "defensive_tilt": {
        "diversification_benefit": +0.05,
        "liquidity_aum":           +0.05,
        "risk_adjusted_return":    -0.10,
        # cost: 0
    },
}

VARIANT_TYPES: tuple[str, ...] = ("core", "growth_tilt", "defensive_tilt")


# ---------------------------------------------------------------------------
# Data classes — input
# ---------------------------------------------------------------------------

@dataclass
class ConstructionAsset:
    """Single scored asset fed into the construction algorithm.

    daily_returns should be chronologically ordered (oldest first).
    For correlation, the trailing 252 values are used.
    For risk parity, annualized vol is derived from all supplied returns.
    """
    ticker: str
    asset_class: str          # "stock" | "etf"
    score_value: Optional[float]   # 0–100 composite, None if all factors N/A
    score_breakdown: dict[str, Any]  # from ScoreResult.to_breakdown_dict()
    daily_returns: list[float]       # chronological daily return series
    adv: Optional[float] = None      # average daily volume (optional filter)


@dataclass
class ConstructionParams:
    """Parameters controlling a single portfolio construction run."""
    risk_level: int            # 1–5 (maps to RISK_PROFILES)
    source_universe: str       # "full_universe" | "watchlist"
    target_n: int = 15         # target position count (clamped to [8, 20])
    min_adv: float = 0.0       # minimum ADV filter (0 = disabled)


# ---------------------------------------------------------------------------
# Data classes — output
# ---------------------------------------------------------------------------

@dataclass
class SkipEntry:
    """Single correlation-skip event; matches portfolio_skip_log schema (§12)."""
    skipped_ticker: str
    skipped_asset_class: str
    reason: str               # "correlation_exceeded"
    threshold: float
    actual_correlation: float
    conflicts_with_ticker: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "skipped_ticker": self.skipped_ticker,
            "skipped_asset_class": self.skipped_asset_class,
            "reason": self.reason,
            "threshold": round(self.threshold, 4),
            "actual_correlation": round(self.actual_correlation, 4),
            "conflicts_with_ticker": self.conflicts_with_ticker,
        }


@dataclass
class HoldingResult:
    """Single holding in the output portfolio."""
    ticker: str
    asset_class: str
    weight: float             # portfolio weight, e.g. 0.08 for 8%
    score: Optional[float]    # composite score used at construction time
    score_breakdown: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "asset_class": self.asset_class,
            "weight": round(self.weight, 6),
            "score": round(self.score, 4) if self.score is not None else None,
            "score_breakdown": self.score_breakdown,
        }


@dataclass
class PortfolioVariant:
    """Output of a single variant construction run.

    This is a pure algorithm output object; it is not persisted here.
    The API layer (Task 9+) maps this to SavedPortfolio / PortfolioHolding rows.
    """
    variant_type: str               # "core" | "growth_tilt" | "defensive_tilt"
    risk_level_snapshot: int
    source_universe: str            # "full_universe" | "watchlist"
    generation_method: str          # "risk_parity_full" | ... | "equal_weight_fallback"
    correlation_relaxations_applied: int
    holdings: list[HoldingResult]
    construction_log: list[dict[str, Any]]
    skip_log: list[SkipEntry]
    warnings: list[str]
    constraints_summary: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "variant_type": self.variant_type,
            "risk_level_snapshot": self.risk_level_snapshot,
            "source_universe": self.source_universe,
            "generation_method": self.generation_method,
            "correlation_relaxations_applied": self.correlation_relaxations_applied,
            "holdings": [h.to_dict() for h in self.holdings],
            "construction_log": self.construction_log,
            "skip_log": [s.to_dict() for s in self.skip_log],
            "warnings": self.warnings,
            "constraints_summary": self.constraints_summary,
        }


# ---------------------------------------------------------------------------
# Variant scoring helpers
# ---------------------------------------------------------------------------

def _compute_variant_score(
    asset: ConstructionAsset,
    variant_type: str,
) -> float:
    """Return a variant-adjusted composite score for ranking.

    Loads factor scores from score_breakdown, applies the variant's weight
    deltas, re-normalizes, and recomputes the composite.

    Falls back to score_value (or 0.0) if breakdown is missing or empty.
    """
    if asset.score_value is None:
        return 0.0

    factors = asset.score_breakdown.get("factors", [])
    if not factors:
        return asset.score_value

    deltas = (
        _STOCK_FACTOR_DELTAS if asset.asset_class == "stock" else _ETF_FACTOR_DELTAS
    ).get(variant_type, {})

    # Build adjusted weights for each non-NA factor
    adjusted: list[tuple[float, float]] = []  # (adjusted_weight, factor_score)
    for f in factors:
        if f.get("is_na") or f.get("score") is None:
            continue
        base_w = f.get("weight", 0.0)
        new_w = max(0.0, base_w + deltas.get(f["name"], 0.0))
        adjusted.append((new_w, f["score"]))

    if not adjusted:
        return asset.score_value

    total_w = sum(w for w, _ in adjusted)
    if total_w <= 0.0:
        return asset.score_value

    composite = sum((w / total_w) * s for w, s in adjusted)
    return max(0.0, min(100.0, composite))


# ---------------------------------------------------------------------------
# Filter step
# ---------------------------------------------------------------------------

def _filter_assets(
    assets: list[ConstructionAsset],
    params: ConstructionParams,
    profile: dict,
    construction_log: list[dict],
) -> list[ConstructionAsset]:
    """Remove assets that fail vol ceiling or min ADV requirements.

    Assets with unknown volatility or ADV are kept (can't penalize missing data).
    If filtering would leave fewer than MIN_POSITIONS assets, the filter is
    relaxed so at least MIN_POSITIONS candidates remain.
    """
    vol_ceiling: Optional[float] = profile.get("vol_ceiling")

    def _annualized_vol_quick(rets: list[float]) -> Optional[float]:
        n = len(rets)
        if n < 2:
            return None
        mean_r = sum(rets) / n
        var = sum((r - mean_r) ** 2 for r in rets) / (n - 1)
        return math.sqrt(var * 252) if var > 0 else None

    reasons: list[str] = []
    if vol_ceiling is not None:
        reasons.append(f"vol_ceiling={vol_ceiling:.0%}")
    if params.min_adv > 0:
        reasons.append(f"min_adv={params.min_adv:,.0f}")

    passed: list[ConstructionAsset] = []
    for a in assets:
        # Vol ceiling filter
        if vol_ceiling is not None:
            vol = _annualized_vol_quick(a.daily_returns)
            if vol is not None and vol > vol_ceiling:
                continue

        # ADV filter
        if params.min_adv > 0 and a.adv is not None and a.adv < params.min_adv:
            continue

        passed.append(a)

    # Safety: never filter below MIN_POSITIONS
    if len(passed) < MIN_POSITIONS and len(assets) >= MIN_POSITIONS:
        passed = list(assets)  # revert filter entirely

    construction_log.append({
        "step": "filter",
        "input_count": len(assets),
        "output_count": len(passed),
        "reason": ", ".join(reasons) if reasons else "no_filter_applied",
    })
    return passed


# ---------------------------------------------------------------------------
# Greedy correlation-aware selection
# ---------------------------------------------------------------------------

def _greedy_select(
    ranked_assets: list[ConstructionAsset],
    target_n: int,
    relaxation_count: int,
) -> tuple[list[ConstructionAsset], list[SkipEntry]]:
    """Single greedy pass with fixed relaxation_count thresholds.

    Highest-ranked asset enters first.  Each subsequent candidate must satisfy
    corr < threshold(class_pair) against all already-selected assets.
    Skipped assets generate SkipEntry records.
    """
    selected: list[ConstructionAsset] = []
    skip_log: list[SkipEntry] = []

    for candidate in ranked_assets:
        if len(selected) >= target_n:
            break

        conflict: Optional[tuple[ConstructionAsset, float, float]] = None
        for sel in selected:
            threshold = get_threshold(
                candidate.asset_class, sel.asset_class, relaxation_count
            )
            corr = compute_correlation(candidate.daily_returns, sel.daily_returns)
            if corr is not None and corr >= threshold:
                conflict = (sel, threshold, corr)
                break

        if conflict is not None:
            conflicting_asset, threshold, corr = conflict
            skip_log.append(
                SkipEntry(
                    skipped_ticker=candidate.ticker,
                    skipped_asset_class=candidate.asset_class,
                    reason="correlation_exceeded",
                    threshold=round(threshold, 4),
                    actual_correlation=round(corr, 4),
                    conflicts_with_ticker=conflicting_asset.ticker,
                )
            )
        else:
            selected.append(candidate)

    return selected, skip_log


def _select_with_relaxation(
    ranked_assets: list[ConstructionAsset],
    target_n: int,
    construction_log: list[dict],
) -> tuple[list[ConstructionAsset], list[SkipEntry], int]:
    """Run greedy selection, relaxing thresholds if fewer than 8 assets are chosen.

    Returns (selected, skip_log_from_last_pass, total_relaxations_applied).
    The skip_log reflects the final selection pass.
    """
    relaxation_count = 0
    selected: list[ConstructionAsset] = []
    skip_log: list[SkipEntry] = []

    while True:
        selected, skip_log = _greedy_select(ranked_assets, target_n, relaxation_count)

        if len(selected) >= MIN_SELECTED_ASSETS or relaxation_count >= MAX_RELAXATIONS:
            break

        relaxation_count += 1
        construction_log.append({
            "step": "select_relax",
            "reason": (
                f"only {len(selected)} asset(s) selected; "
                f"minimum is {MIN_SELECTED_ASSETS}"
            ),
            "relaxation_step": relaxation_count,
            "threshold_delta": f"+{relaxation_count * 0.05:.2f}",
        })

    construction_log.append({
        "step": "select",
        "target_n": target_n,
        "selected": len(selected),
        "skipped": len(skip_log),
    })

    return selected, skip_log, relaxation_count


# ---------------------------------------------------------------------------
# Single variant builder
# ---------------------------------------------------------------------------

def _build_variant(
    assets: list[ConstructionAsset],
    params: ConstructionParams,
    variant_type: str,
) -> PortfolioVariant:
    """Build one portfolio variant end-to-end."""
    profile = get_risk_profile(params.risk_level)
    construction_log: list[dict] = []
    warnings: list[str] = []

    # Step 1 — filter
    filtered = _filter_assets(assets, params, profile, construction_log)

    # Step 2 — rank by variant-adjusted composite
    scored = [
        (a, _compute_variant_score(a, variant_type))
        for a in filtered
    ]
    ranked = [a for a, _ in sorted(scored, key=lambda x: x[1], reverse=True)]

    construction_log.append({
        "step": "rank",
        "method": "variant_adjusted_composite",
        "variant": variant_type,
    })

    # Step 3 — greedy correlation-aware selection
    target_n = max(MIN_POSITIONS, min(MAX_POSITIONS, params.target_n))
    selected, skip_log, corr_relaxations = _select_with_relaxation(
        ranked, target_n, construction_log
    )

    if len(selected) < MIN_SELECTED_ASSETS:
        warnings.append(
            f"insufficient_diversification: only {len(selected)} asset(s) selected "
            f"after {corr_relaxations} correlation relaxation(s)"
        )

    if not selected:
        # Nothing to allocate — return empty variant with log
        construction_log.append({
            "step": "constraints",
            "violations": 0,
            "details": [],
        })
        return PortfolioVariant(
            variant_type=variant_type,
            risk_level_snapshot=params.risk_level,
            source_universe=params.source_universe,
            generation_method="equal_weight_fallback",
            correlation_relaxations_applied=corr_relaxations,
            holdings=[],
            construction_log=construction_log,
            skip_log=skip_log,
            warnings=warnings,
            constraints_summary={
                "single_asset_max": SINGLE_ASSET_MAX,
                "min_positions": MIN_POSITIONS,
                "max_positions": MAX_POSITIONS,
                "actual_positions": 0,
                "violations": 0,
                "details": [],
            },
        )

    # Step 4 — allocate via risk parity
    tickers_by_class: dict[str, list[str]] = {"stock": [], "etf": []}
    for a in selected:
        tickers_by_class.setdefault(a.asset_class, []).append(a.ticker)

    daily_returns_map = {a.ticker: a.daily_returns for a in selected}

    weights, generation_method, alloc_relaxations = allocate(
        tickers_by_class, daily_returns_map, params.risk_level, construction_log
    )

    # Step 5 — check constraints
    n_violations, violation_details = check_constraints(
        weights, tickers_by_class, params.risk_level
    )
    construction_log.append({
        "step": "constraints",
        "violations": n_violations,
        "details": violation_details,
    })

    # Build holdings list
    asset_by_ticker = {a.ticker: a for a in selected}
    holdings = [
        HoldingResult(
            ticker=t,
            asset_class=asset_by_ticker[t].asset_class,
            weight=w,
            score=_compute_variant_score(asset_by_ticker[t], variant_type),
            score_breakdown=asset_by_ticker[t].score_breakdown,
        )
        for t, w in sorted(weights.items(), key=lambda kv: kv[1], reverse=True)
    ]

    # Constraints summary for output
    actual_stock_w = sum(weights.get(t, 0.0) for t in tickers_by_class.get("stock", []))
    actual_etf_w = sum(weights.get(t, 0.0) for t in tickers_by_class.get("etf", []))
    constraints_summary = {
        "single_asset_max": SINGLE_ASSET_MAX,
        "min_positions": MIN_POSITIONS,
        "max_positions": MAX_POSITIONS,
        "stock_weight_range": [profile["stock_min"], profile["stock_max"]],
        "etf_weight_range": [profile["etf_min"], profile["etf_max"]],
        "actual_stock_weight": round(actual_stock_w, 4),
        "actual_etf_weight": round(actual_etf_w, 4),
        "actual_positions": len(holdings),
        "violations": n_violations,
        "details": violation_details,
    }

    return PortfolioVariant(
        variant_type=variant_type,
        risk_level_snapshot=params.risk_level,
        source_universe=params.source_universe,
        generation_method=generation_method,
        correlation_relaxations_applied=corr_relaxations,
        holdings=holdings,
        construction_log=construction_log,
        skip_log=skip_log,
        warnings=warnings,
        constraints_summary=constraints_summary,
    )


# ---------------------------------------------------------------------------
# Public API — portfolio constructor
# ---------------------------------------------------------------------------

class PortfolioConstructor:
    """Generates the 3 candidate portfolio variants from a scored asset universe.

    This class is pure algorithm logic — no network calls, no database writes,
    no FastAPI routes.  Data is supplied by the caller; results are returned
    as plain Python objects for the API layer to persist (Task 9+).
    """

    def build_variants(
        self,
        assets: list[ConstructionAsset],
        params: ConstructionParams,
    ) -> list[PortfolioVariant]:
        """Build Core, Growth Tilt, and Defensive Tilt variants.

        Args:
            assets: scored assets with daily_returns attached.
            params: construction parameters (risk level, source, target count).

        Returns:
            List of 3 PortfolioVariant objects in order:
            [core, growth_tilt, defensive_tilt].
        """
        return [
            _build_variant(assets, params, variant_type)
            for variant_type in VARIANT_TYPES
        ]
