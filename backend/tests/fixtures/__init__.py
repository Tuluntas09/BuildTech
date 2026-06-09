# TEST FIXTURE — NOT FOR PRODUCTION USE
"""
Construction-module test fixtures.

This package may only be imported by code under tests/.
It must never be imported by app/api/* or app/core/construction.py.
"""

from __future__ import annotations

import math
from typing import Optional

from app.core.construction import ConstructionAsset


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_returns(
    n: int = 300,
    drift: float = 0.0003,
    vol: float = 0.01,
    seed: int = 42,
) -> list[float]:
    """Synthetic random-walk daily returns with deterministic seed."""
    import random
    rng = random.Random(seed)
    return [drift + vol * (rng.gauss(0, 1)) for _ in range(n)]


def _make_correlated_returns(
    base_returns: list[float],
    correlation: float,
    seed: int = 99,
) -> list[float]:
    """Generate returns with a target Pearson correlation to base_returns.

    Uses the Cholesky decomposition approach:
      y = rho*x + sqrt(1-rho^2)*z
    where z is independent noise.
    """
    import random
    rng = random.Random(seed)
    n = len(base_returns)
    noise = [rng.gauss(0, 1) for _ in range(n)]
    # Normalize base and noise to unit std for clean mixing
    bm = sum(base_returns) / n
    bstd = math.sqrt(sum((r - bm) ** 2 for r in base_returns) / max(n - 1, 1)) or 1.0
    nm = sum(noise) / n
    nstd = math.sqrt(sum((z - nm) ** 2 for z in noise) / max(n - 1, 1)) or 1.0

    base_norm = [(r - bm) / bstd for r in base_returns]
    noise_norm = [(z - nm) / nstd for z in noise]

    rho_sq = correlation ** 2
    mixed = [
        correlation * b + math.sqrt(max(0.0, 1.0 - rho_sq)) * z
        for b, z in zip(base_norm, noise_norm)
    ]
    # Re-scale to match original base volatility
    mm = sum(mixed) / n
    mstd = math.sqrt(sum((v - mm) ** 2 for v in mixed) / max(n - 1, 1)) or 1.0
    target_vol = 0.01
    return [((v - mm) / mstd) * target_vol for v in mixed]


def _make_deterministic_returns(
    n: int,
    step: float,
) -> list[float]:
    """Returns that go up or down by `step` each day (zero noise, maximal correlation)."""
    return [step] * n


def make_stock_asset(
    ticker: str,
    score_value: float = 60.0,
    daily_returns: Optional[list[float]] = None,
    adv: Optional[float] = 1_000_000.0,
    factor_overrides: Optional[dict] = None,
) -> ConstructionAsset:
    """Build a minimal stock ConstructionAsset for tests."""
    if daily_returns is None:
        daily_returns = _make_returns(seed=hash(ticker) % 2**31)

    factors = [
        {"name": "value",             "weight": 0.25, "effective_weight": 0.25, "score": 60.0, "is_na": False},
        {"name": "quality",           "weight": 0.25, "effective_weight": 0.25, "score": 60.0, "is_na": False},
        {"name": "momentum",          "weight": 0.20, "effective_weight": 0.20, "score": 60.0, "is_na": False},
        {"name": "volatility_adjusted","weight": 0.15,"effective_weight": 0.15, "score": 60.0, "is_na": False},
        {"name": "size_liquidity",    "weight": 0.15, "effective_weight": 0.15, "score": 60.0, "is_na": False},
    ]
    if factor_overrides:
        for f in factors:
            if f["name"] in factor_overrides:
                f.update(factor_overrides[f["name"]])

    return ConstructionAsset(
        ticker=ticker,
        asset_class="stock",
        score_value=score_value,
        score_breakdown={"factors": factors},
        daily_returns=daily_returns,
        adv=adv,
    )


def make_etf_asset(
    ticker: str,
    score_value: float = 60.0,
    daily_returns: Optional[list[float]] = None,
    adv: Optional[float] = 5_000_000.0,
    factor_overrides: Optional[dict] = None,
) -> ConstructionAsset:
    """Build a minimal ETF ConstructionAsset for tests."""
    if daily_returns is None:
        daily_returns = _make_returns(seed=hash(ticker) % 2**31)

    factors = [
        {"name": "cost",                   "weight": 0.20, "effective_weight": 0.20, "score": 60.0, "is_na": False},
        {"name": "liquidity_aum",          "weight": 0.25, "effective_weight": 0.25, "score": 60.0, "is_na": False},
        {"name": "risk_adjusted_return",   "weight": 0.30, "effective_weight": 0.30, "score": 60.0, "is_na": False},
        {"name": "diversification_benefit","weight": 0.25, "effective_weight": 0.25, "score": 60.0, "is_na": False},
    ]
    if factor_overrides:
        for f in factors:
            if f["name"] in factor_overrides:
                f.update(factor_overrides[f["name"]])

    return ConstructionAsset(
        ticker=ticker,
        asset_class="etf",
        score_value=score_value,
        score_breakdown={"factors": factors},
        daily_returns=daily_returns,
        adv=adv,
    )


def make_universe(
    n_stocks: int = 15,
    n_etfs: int = 10,
    base_score: float = 60.0,
) -> list[ConstructionAsset]:
    """Build a mixed stock+ETF universe with varied independent return series."""
    assets: list[ConstructionAsset] = []
    for i in range(n_stocks):
        assets.append(make_stock_asset(
            ticker=f"STK{i:02d}",
            score_value=base_score + (n_stocks - i) * 0.5,
            daily_returns=_make_returns(seed=i * 7 + 1),
        ))
    for i in range(n_etfs):
        assets.append(make_etf_asset(
            ticker=f"ETF{i:02d}",
            score_value=base_score + (n_etfs - i) * 0.5,
            daily_returns=_make_returns(seed=i * 13 + 100),
        ))
    return assets
