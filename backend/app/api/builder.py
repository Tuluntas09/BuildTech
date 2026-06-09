"""
Builder generate endpoint — POST /api/v1/builder/generate

Connects the Task 8 construction algorithm to the API layer.

Data flow:
  1. Read user_profile → get risk_level
  2. Read asset_score_cache → scored universe
  3. Read price_cache → daily returns per ticker (no yfinance, no scoring)
  4. Map to ConstructionAsset objects
  5. Invoke PortfolioConstructor.build_variants()
  6. Return 3 variants (Core, Growth Tilt, Defensive Tilt) as response-only data

Persistence boundary: generated variants are NOT written to saved_portfolio,
portfolio_holding, or portfolio_skip_log in this task.

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.
"""

from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.construction import (
    ConstructionAsset,
    ConstructionParams,
    PortfolioConstructor,
)
from app.core.scoring.base import compute_daily_returns
from app.data.providers.base import PriceRow
from app.data.snapshot_prices import SnapshotReader
from app.db.session import get_db
from app.models.tables import AssetScoreCache, PriceCache as PriceCacheRow, UserProfile

router = APIRouter(tags=["builder"])

# How far back to look for price data (calendar days).
# 600 calendar days ≈ 420 trading days — enough for 252-day correlation window.
_PRICE_LOOKBACK_DAYS: int = 600

# Minimum number of price rows before we try the snapshot fallback.
_MIN_PRICE_ROWS: int = 50


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class BuilderRequest(BaseModel):
    source_universe: str = Field(
        default="full_universe",
        description="'full_universe' (default) or 'watchlist'",
    )
    max_positions: int = Field(default=15, ge=8, le=20)
    min_adv: float = Field(default=0.0, ge=0.0)


class HoldingOut(BaseModel):
    ticker: str
    asset_class: str
    weight: float
    score: Optional[float]
    score_breakdown: dict[str, Any]


class VariantOut(BaseModel):
    variant_type: str
    risk_level_snapshot: int
    source_universe: str
    generation_method: str
    correlation_relaxations_applied: int
    holdings: list[HoldingOut]
    construction_log: list[dict[str, Any]]
    skip_log: list[dict[str, Any]]
    warnings: list[str]
    constraints_summary: dict[str, Any]


class BuilderResponse(BaseModel):
    variants: list[VariantOut]
    risk_level: int
    risk_level_name: str
    source_universe: str
    asset_count_used: int


# ---------------------------------------------------------------------------
# Price loading helpers — DB only, no yfinance
# ---------------------------------------------------------------------------

def _orm_row_to_price_row(r: PriceCacheRow) -> PriceRow:
    return PriceRow(
        ticker=r.ticker,
        date=r.price_date,
        open=r.open,
        high=r.high,
        low=r.low,
        close=r.close,
        adjusted_close=r.adjusted_close,
        volume=r.volume,
        fetched_at=r.fetched_at,
    )


def _load_prices_from_db(
    db: Session,
    tickers: list[str],
) -> dict[str, list[PriceRow]]:
    """Batch-load price rows from price_cache for all tickers.

    One SQL query for all tickers — avoids N+1 round trips.
    Returns ticker → list[PriceRow] (sorted by date, oldest first).
    """
    start_date = date.today() - timedelta(days=_PRICE_LOOKBACK_DAYS)

    stmt = (
        select(PriceCacheRow)
        .where(PriceCacheRow.ticker.in_(tickers))
        .where(PriceCacheRow.price_date >= start_date)
        .order_by(PriceCacheRow.ticker, PriceCacheRow.price_date)
    )
    rows = db.execute(stmt).scalars().all()

    result: dict[str, list[PriceRow]] = {t: [] for t in tickers}
    for r in rows:
        result[r.ticker].append(_orm_row_to_price_row(r))
    return result


def _load_prices_from_snapshot(
    tickers: list[str],
    snapshot_path: str,
) -> dict[str, list[PriceRow]]:
    """Read price rows from the frozen parquet snapshot for tickers missing DB data.

    Returns empty lists (not an error) when the snapshot file does not exist.
    """
    path = Path(snapshot_path)
    if not path.is_absolute():
        # Resolve relative to the backend/ directory
        path = Path(__file__).parent.parent.parent / path

    reader = SnapshotReader(path)
    start_date = date.today() - timedelta(days=_PRICE_LOOKBACK_DAYS)
    end_date = date.today()

    result: dict[str, list[PriceRow]] = {}
    for ticker in tickers:
        result[ticker] = reader.read(ticker, start_date, end_date)
    return result


def _get_daily_returns(
    tickers: list[str],
    db: Session,
    snapshot_path: str,
) -> dict[str, list[float]]:
    """Load price data and compute daily returns for all tickers.

    Tries price_cache (SQLite) first.  Falls back to snapshot parquet for
    tickers below the minimum row threshold.  Does not call yfinance.
    """
    db_prices = _load_prices_from_db(db, tickers)

    # Find tickers that need snapshot fallback
    thin_tickers = [
        t for t in tickers if len(db_prices.get(t, [])) < _MIN_PRICE_ROWS
    ]
    snap_prices: dict[str, list[PriceRow]] = {}
    if thin_tickers:
        snap_prices = _load_prices_from_snapshot(thin_tickers, snapshot_path)

    returns: dict[str, list[float]] = {}
    for ticker in tickers:
        db_rows = db_prices.get(ticker, [])
        if len(db_rows) >= _MIN_PRICE_ROWS:
            returns[ticker] = compute_daily_returns(db_rows)
        else:
            snap_rows = snap_prices.get(ticker, [])
            if snap_rows:
                returns[ticker] = compute_daily_returns(snap_rows)
            else:
                returns[ticker] = []  # no price data; construction handles gracefully

    return returns


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("/builder/generate", response_model=BuilderResponse)
def generate(
    body: BuilderRequest,
    db: Session = Depends(get_db),
) -> BuilderResponse:
    """Dynamically generate 3 candidate portfolio variants.

    Reads scored assets from asset_score_cache and price history from
    price_cache.  Invokes the Task 8 construction algorithm.

    Does NOT compute scores, call yfinance, or write portfolio records.
    """
    # Validate source_universe
    if body.source_universe not in ("full_universe", "watchlist"):
        raise HTTPException(
            status_code=400,
            detail=f"Unknown source_universe {body.source_universe!r}. "
                   "Valid values: 'full_universe', 'watchlist'.",
        )

    # Load user profile
    profile = db.query(UserProfile).first()
    if profile is None:
        raise HTTPException(
            status_code=400,
            detail="No profile found. Complete onboarding to set your risk level first.",
        )
    if profile.risk_level is None:
        raise HTTPException(
            status_code=400,
            detail="Profile has no risk level set. "
                   "Complete profile setup to choose a risk level.",
        )
    risk_level: int = profile.risk_level

    # Load scored universe: full_universe or watchlist
    if body.source_universe == "full_universe":
        score_rows = db.query(AssetScoreCache).all()
        if not score_rows:
            raise HTTPException(
                status_code=400,
                detail="No cached scores found. Run the scoring process first.",
            )
    else:
        # watchlist source — restrict to tickers the user has added
        from app.models.tables import WatchlistItem
        watchlist_items = db.query(WatchlistItem).all()
        if not watchlist_items:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Watchlist is empty. Add scored assets to the watchlist first."
                ),
            )
        watchlist_tickers = [item.ticker for item in watchlist_items]
        score_rows = (
            db.query(AssetScoreCache)
            .filter(AssetScoreCache.ticker.in_(watchlist_tickers))
            .all()
        )
        if not score_rows:
            raise HTTPException(
                status_code=400,
                detail="No scored data found for watchlist tickers. Re-run scoring first.",
            )

    # Map score cache rows to construction input
    # asset_class lives inside breakdown JSON
    valid_assets: list[tuple[str, str, Optional[float], dict]] = []
    for row in score_rows:
        bd = row.breakdown if isinstance(row.breakdown, dict) else {}
        ac = bd.get("asset_class") if bd else None
        if ac not in ("stock", "etf"):
            continue  # skip rows with no valid asset class
        valid_assets.append((row.ticker, ac, row.score_value, bd))

    if not valid_assets:
        raise HTTPException(
            status_code=400,
            detail=(
                "No cached scores contain valid asset class information. "
                "Re-run the scoring process to populate asset class data."
            ),
        )

    tickers = [t for t, _, _, _ in valid_assets]

    # Load price history for daily returns (no yfinance, no scoring)
    settings = get_settings()
    returns_by_ticker = _get_daily_returns(
        tickers, db, settings.snapshot_prices_path
    )

    # Build ConstructionAsset objects
    construction_assets = [
        ConstructionAsset(
            ticker=ticker,
            asset_class=ac,
            score_value=score_val,
            score_breakdown=bd,
            daily_returns=returns_by_ticker.get(ticker, []),
            adv=None,  # ADV filter disabled by default; not stored in score cache
        )
        for ticker, ac, score_val, bd in valid_assets
    ]

    # Build construction parameters
    params = ConstructionParams(
        risk_level=risk_level,
        source_universe=body.source_universe,
        target_n=body.max_positions,
        min_adv=body.min_adv,
    )

    # Invoke construction algorithm (Task 8)
    constructor = PortfolioConstructor()
    variants = constructor.build_variants(construction_assets, params)

    # Map to response shape
    from app.core.allocation import RISK_PROFILES
    risk_name = RISK_PROFILES.get(risk_level, {}).get("name", f"Level {risk_level}")

    return BuilderResponse(
        variants=[
            VariantOut(
                variant_type=v.variant_type,
                risk_level_snapshot=v.risk_level_snapshot,
                source_universe=v.source_universe,
                generation_method=v.generation_method,
                correlation_relaxations_applied=v.correlation_relaxations_applied,
                holdings=[
                    HoldingOut(
                        ticker=h.ticker,
                        asset_class=h.asset_class,
                        weight=h.weight,
                        score=h.score,
                        score_breakdown=h.score_breakdown,
                    )
                    for h in v.holdings
                ],
                construction_log=v.construction_log,
                skip_log=[s.to_dict() for s in v.skip_log],
                warnings=v.warnings,
                constraints_summary=v.constraints_summary,
            )
            for v in variants
        ],
        risk_level=risk_level,
        risk_level_name=risk_name,
        source_universe=body.source_universe,
        asset_count_used=len(construction_assets),
    )
