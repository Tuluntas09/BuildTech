"""
Risk parity allocation with constraint relaxation and equal-weight fallback.

Algorithm:
  1. Compute inverse-volatility weights within each asset class.
  2. Scale each class to its target weight derived from the risk profile midpoint.
  3. Enforce single-asset maximum (SINGLE_ASSET_MAX = 20%) via iterative
     cap-and-redistribute.
  4. If infeasible, relax single-asset max by +5% per step (up to 3 steps).
  5. After 3 failed relaxations, use equal-weight + 20% clip + renormalize.

generation_method (required on every output per plan §3):
  "risk_parity_full"       — succeeds on the first attempt
  "risk_parity_relaxed_N"  — succeeds after N relaxation steps
  "equal_weight_fallback"  — all 3 relaxation steps failed

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.
"""

import math
from typing import Optional

# ---------------------------------------------------------------------------
# Risk profile constants  (§5)
# ---------------------------------------------------------------------------

RISK_PROFILES: dict[int, dict] = {
    1: {
        "name": "Citadel",
        "stock_min": 0.10, "stock_max": 0.25,
        "etf_min": 0.75,   "etf_max": 0.90,
        "vol_ceiling": 0.08,
    },
    2: {
        "name": "Anchor",
        "stock_min": 0.25, "stock_max": 0.45,
        "etf_min": 0.55,   "etf_max": 0.75,
        "vol_ceiling": 0.12,
    },
    3: {
        "name": "Compass",
        "stock_min": 0.40, "stock_max": 0.65,
        "etf_min": 0.35,   "etf_max": 0.60,
        "vol_ceiling": 0.18,
    },
    4: {
        "name": "Voyager",
        "stock_min": 0.55, "stock_max": 0.80,
        "etf_min": 0.20,   "etf_max": 0.45,
        "vol_ceiling": 0.25,
    },
    5: {
        "name": "Frontier",
        "stock_min": 0.70, "stock_max": 0.95,
        "etf_min": 0.05,   "etf_max": 0.30,
        "vol_ceiling": None,
    },
}

# Allocation constraints
SINGLE_ASSET_MAX: float = 0.20
MIN_POSITIONS: int = 8
MAX_POSITIONS: int = 20
RELAXATION_STEP: float = 0.05
MAX_RELAXATIONS: int = 3


def get_risk_profile(risk_level: int) -> dict:
    """Return the risk profile dict for level 1–5.  Raises ValueError for unknown levels."""
    if risk_level not in RISK_PROFILES:
        raise ValueError(f"Unknown risk level {risk_level!r}; valid values are 1–5.")
    return RISK_PROFILES[risk_level]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _annualized_vol(daily_returns: list[float]) -> Optional[float]:
    """Annualized standard deviation of daily returns.  Returns None for < 2 obs."""
    n = len(daily_returns)
    if n < 2:
        return None
    mean_r = sum(daily_returns) / n
    variance = sum((r - mean_r) ** 2 for r in daily_returns) / (n - 1)
    if variance <= 0.0:
        return None
    return math.sqrt(variance * 252)


def _class_target_weights(
    n_stocks: int,
    n_etfs: int,
    profile: dict,
) -> tuple[float, float]:
    """Target (stock_weight, etf_weight) using the profile range midpoints.

    Weights are guaranteed to sum to 1.0.
    If a class has zero assets, the other class receives full weight.
    """
    if n_stocks == 0 and n_etfs == 0:
        return 0.0, 0.0
    if n_stocks == 0:
        return 0.0, 1.0
    if n_etfs == 0:
        return 1.0, 0.0

    stock_mid = (profile["stock_min"] + profile["stock_max"]) / 2.0
    etf_mid = (profile["etf_min"] + profile["etf_max"]) / 2.0
    total = stock_mid + etf_mid
    return stock_mid / total, etf_mid / total


def _is_feasible(n_assets: int, target_weight: float, max_single: float) -> bool:
    """True when n_assets can cover target_weight without exceeding max_single each."""
    return n_assets * max_single + 1e-9 >= target_weight


def _cap_and_redistribute(
    weights: dict[str, float],
    target_total: float,
    max_single: float,
) -> Optional[dict[str, float]]:
    """Iteratively cap weights at max_single and redistribute excess proportionally.

    Returns None if infeasible (not enough assets to absorb the excess).
    Terminates once no weight exceeds max_single or infeasibility is detected.
    """
    # Early-exit infeasibility check
    if not _is_feasible(len(weights), target_total, max_single):
        return None

    result = dict(weights)

    for _ in range(len(result) + 2):
        over = {t: w for t, w in result.items() if w > max_single + 1e-9}
        if not over:
            return result  # converged — no violations remain

        excess = sum(w - max_single for w in over.values())

        # Cap the violators
        for t in over:
            result[t] = max_single

        # Find recipients (assets still below the cap)
        under = {t: w for t, w in result.items() if w < max_single - 1e-9}
        if not under:
            # All assets capped; check if they sum to target
            if abs(sum(result.values()) - target_total) < 1e-6:
                return result
            return None  # infeasible

        # Redistribute proportionally to uncapped assets
        under_total = sum(under.values())
        for t in under:
            result[t] += excess * (under[t] / under_total)

    return None  # iteration limit (should not happen for sane inputs)


def _inverse_vol_weights_for_class(
    tickers: list[str],
    vols: dict[str, float],
    target_weight: float,
    max_single: float,
) -> Optional[dict[str, float]]:
    """Compute inverse-volatility weights for a single asset class.

    Tickers without valid volatility data receive the average inverse-vol of
    those that do have data.  If no asset has valid vol, falls back to equal
    weights.

    Returns None if the single-asset cap makes the distribution infeasible.
    """
    if not tickers:
        return {}

    valid = {t: vols[t] for t in tickers if t in vols and vols[t] > 0}

    if valid:
        inv_vols = {t: 1.0 / v for t, v in valid.items()}
        mean_inv = sum(inv_vols.values()) / len(inv_vols)
        all_inv = {t: inv_vols.get(t, mean_inv) for t in tickers}
        total_inv = sum(all_inv.values())
        raw_weights = {t: (iv / total_inv) * target_weight for t, iv in all_inv.items()}
    else:
        # No volatility data — equal weight within class
        per = target_weight / len(tickers)
        raw_weights = {t: per for t in tickers}

    return _cap_and_redistribute(raw_weights, target_weight, max_single)


def _equal_weight_fallback(
    tickers_by_class: dict[str, list[str]],
    stock_w: float,
    etf_w: float,
) -> dict[str, float]:
    """Equal-weight allocation within each class, clipped at SINGLE_ASSET_MAX.

    After clipping, weights are renormalized to sum to 1.0.  Class proportions
    may shift slightly from the target when clipping occurs; that is acceptable
    for the fallback path.
    """
    result: dict[str, float] = {}
    for cls, target in [("stock", stock_w), ("etf", etf_w)]:
        tickers = tickers_by_class.get(cls, [])
        if not tickers:
            continue
        per = target / len(tickers)
        for t in tickers:
            result[t] = min(per, SINGLE_ASSET_MAX)

    total = sum(result.values())
    if total > 1e-9:
        result = {t: w / total for t, w in result.items()}
    return result


# ---------------------------------------------------------------------------
# Public allocation entry point
# ---------------------------------------------------------------------------

def allocate(
    tickers_by_class: dict[str, list[str]],
    daily_returns_by_ticker: dict[str, list[float]],
    risk_level: int,
    construction_log: list[dict],
) -> tuple[dict[str, float], str, int]:
    """Allocate portfolio weights using risk parity with relaxation fallback.

    Args:
        tickers_by_class: {"stock": [...tickers...], "etf": [...tickers...]}
        daily_returns_by_ticker: ticker → chronologically-ordered daily returns
        risk_level: 1–5 (maps to RISK_PROFILES)
        construction_log: mutable list; allocation events are appended here

    Returns:
        (weights, generation_method, relaxations_applied)
        weights: ticker → weight (all sum to ≈ 1.0)
        generation_method: "risk_parity_full" | "risk_parity_relaxed_N" | "equal_weight_fallback"
        relaxations_applied: 0–3
    """
    profile = get_risk_profile(risk_level)
    n_stocks = len(tickers_by_class.get("stock", []))
    n_etfs = len(tickers_by_class.get("etf", []))
    stock_w, etf_w = _class_target_weights(n_stocks, n_etfs, profile)

    # Pre-compute annualized volatilities
    vols: dict[str, float] = {}
    for ticker, rets in daily_returns_by_ticker.items():
        v = _annualized_vol(rets)
        if v is not None:
            vols[ticker] = v

    max_single = SINGLE_ASSET_MAX

    for attempt in range(MAX_RELAXATIONS + 1):
        stock_weights = (
            _inverse_vol_weights_for_class(
                tickers_by_class.get("stock", []), vols, stock_w, max_single
            )
            if n_stocks > 0
            else {}
        )
        etf_weights = (
            _inverse_vol_weights_for_class(
                tickers_by_class.get("etf", []), vols, etf_w, max_single
            )
            if n_etfs > 0
            else {}
        )

        if stock_weights is not None and etf_weights is not None:
            # Allocation succeeded
            combined: dict[str, float] = {**stock_weights, **etf_weights}
            if attempt == 0:
                generation_method = "risk_parity_full"
                construction_log.append({
                    "step": "allocate",
                    "method": "risk_parity",
                    "status": "success",
                })
            else:
                generation_method = f"risk_parity_relaxed_{attempt}"
                construction_log.append({
                    "step": "allocate_retry",
                    "method": "risk_parity",
                    "relax_step": attempt,
                    "status": "success",
                    "max_single_used": round(max_single, 3),
                })
            return combined, generation_method, attempt

        # Infeasible at this relaxation level — log and try again
        if attempt == 0:
            construction_log.append({
                "step": "allocate",
                "method": "risk_parity",
                "status": "infeasible",
            })
        else:
            construction_log.append({
                "step": "allocate_retry",
                "method": "risk_parity",
                "relax_step": attempt,
                "status": "infeasible",
            })

        max_single += RELAXATION_STEP

    # All relaxation attempts exhausted → equal-weight fallback
    fallback = _equal_weight_fallback(tickers_by_class, stock_w, etf_w)
    construction_log.append({
        "step": "allocate_fallback",
        "method": "equal_weight_clipped",
        "reason": "risk_parity_infeasible_after_3_relaxations",
    })
    return fallback, "equal_weight_fallback", MAX_RELAXATIONS


def check_constraints(
    weights: dict[str, float],
    tickers_by_class: dict[str, list[str]],
    risk_level: int,
) -> tuple[int, list[str]]:
    """Verify that weights satisfy portfolio constraints.

    Checks:
      - Single-asset max (SINGLE_ASSET_MAX = 20%)
      - Stock class weight within profile [min, max]
      - ETF class weight within profile [min, max]
      - Position count within [MIN_POSITIONS, MAX_POSITIONS]

    Returns:
        (violation_count, list_of_violation_description_strings)
    """
    profile = get_risk_profile(risk_level)
    violations: list[str] = []

    # Single-asset max
    for ticker, w in weights.items():
        if w > SINGLE_ASSET_MAX + 1e-6:
            violations.append(
                f"{ticker} weight {w:.4f} exceeds single-asset max {SINGLE_ASSET_MAX:.2f}"
            )

    # Class weights
    stock_tickers = tickers_by_class.get("stock", [])
    etf_tickers = tickers_by_class.get("etf", [])
    actual_stock_w = sum(weights.get(t, 0.0) for t in stock_tickers)
    actual_etf_w = sum(weights.get(t, 0.0) for t in etf_tickers)

    if stock_tickers:
        if actual_stock_w < profile["stock_min"] - 1e-3:
            violations.append(
                f"stock weight {actual_stock_w:.4f} below profile min {profile['stock_min']:.2f}"
            )
        if actual_stock_w > profile["stock_max"] + 1e-3:
            violations.append(
                f"stock weight {actual_stock_w:.4f} exceeds profile max {profile['stock_max']:.2f}"
            )

    if etf_tickers:
        if actual_etf_w < profile["etf_min"] - 1e-3:
            violations.append(
                f"ETF weight {actual_etf_w:.4f} below profile min {profile['etf_min']:.2f}"
            )
        if actual_etf_w > profile["etf_max"] + 1e-3:
            violations.append(
                f"ETF weight {actual_etf_w:.4f} exceeds profile max {profile['etf_max']:.2f}"
            )

    # Position count
    n_positions = sum(1 for w in weights.values() if w > 1e-6)
    if n_positions < MIN_POSITIONS:
        violations.append(
            f"position count {n_positions} below minimum {MIN_POSITIONS}"
        )
    if n_positions > MAX_POSITIONS:
        violations.append(
            f"position count {n_positions} exceeds maximum {MAX_POSITIONS}"
        )

    return len(violations), violations
