"""
Correlation thresholds and calculation for construction-phase asset selection.

Plan §10 default thresholds:
  Stock ↔ Stock : 0.80  (1Y daily returns window)
  ETF ↔ ETF     : 0.75
  Stock ↔ ETF   : 0.85

Relaxation: +0.05 per step, maximum 3 relaxations.
If selection still < 8 assets after 3 relaxations, return what was selected
plus an "insufficient_diversification" warning in the construction log.

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.
"""

import math
from typing import Optional

# ---------------------------------------------------------------------------
# Thresholds  (§10)
# ---------------------------------------------------------------------------

BASE_THRESHOLDS: dict[tuple[str, str], float] = {
    ("stock", "stock"): 0.80,
    ("etf",   "etf"):   0.75,
    ("stock", "etf"):   0.85,
    ("etf",   "stock"): 0.85,
}

RELAXATION_STEP: float = 0.05
MAX_RELAXATIONS: int = 3

# Greedy selection: minimum accepted assets before "insufficient_diversification"
MIN_SELECTED_ASSETS: int = 8

# Trailing window for correlation (1Y)
CORRELATION_WINDOW: int = 252

# Minimum aligned observations required to compute a meaningful correlation
MIN_RETURN_OVERLAP: int = 30


def get_threshold(
    asset_class_a: str,
    asset_class_b: str,
    relaxation_count: int = 0,
) -> float:
    """Return the Pearson-correlation threshold for a pair of asset classes.

    A higher threshold is more permissive (allows more correlated candidates).
    Relaxation adds RELAXATION_STEP per step, capped at MAX_RELAXATIONS.

    Args:
        asset_class_a: "stock" or "etf"
        asset_class_b: "stock" or "etf"
        relaxation_count: number of relaxations applied so far (0–3)

    Returns:
        Correlation threshold (float in [0, 1]).
    """
    key = (asset_class_a.lower(), asset_class_b.lower())
    base = BASE_THRESHOLDS.get(key)
    if base is None:
        # Try swapped key (symmetric)
        base = BASE_THRESHOLDS.get((key[1], key[0]), 0.85)
    relaxations = max(0, min(relaxation_count, MAX_RELAXATIONS))
    return base + relaxations * RELAXATION_STEP


def compute_correlation(
    returns_a: list[float],
    returns_b: list[float],
) -> Optional[float]:
    """Pearson correlation of two return series using a trailing 1Y window.

    Both series are assumed to be chronologically ordered (oldest first) and
    to share the same end date (most-recent entry at the same calendar date).
    The function aligns by taking the trailing CORRELATION_WINDOW values from
    each series and uses min(len_a, len_b) common observations.

    Returns None when fewer than MIN_RETURN_OVERLAP observations are available.
    """
    ra = returns_a[-CORRELATION_WINDOW:] if len(returns_a) > CORRELATION_WINDOW else returns_a
    rb = returns_b[-CORRELATION_WINDOW:] if len(returns_b) > CORRELATION_WINDOW else returns_b

    n = min(len(ra), len(rb))
    if n < MIN_RETURN_OVERLAP:
        return None

    # Use the most-recent n observations from each series
    xa = ra[-n:]
    xb = rb[-n:]

    mx = sum(xa) / n
    my = sum(xb) / n
    dx = [v - mx for v in xa]
    dy = [v - my for v in xb]

    cov = sum(a * b for a, b in zip(dx, dy)) / n
    sx = math.sqrt(sum(a * a for a in dx) / n)
    sy = math.sqrt(sum(b * b for b in dy) / n)

    if sx == 0.0 or sy == 0.0:
        return None

    return max(-1.0, min(1.0, cov / (sx * sy)))
