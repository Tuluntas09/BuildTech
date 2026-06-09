"""
Watchlist CRUD — GET/POST/DELETE /api/v1/watchlist

Single-user watchlist. Tickers must be in asset_score_cache to be added.
Duplicate adds are idempotent — returns existing item with 200.

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.tables import AssetScoreCache, WatchlistItem

router = APIRouter(tags=["watchlist"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class WatchlistAddRequest(BaseModel):
    ticker: str
    notes: Optional[str] = None

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, v: str) -> str:
        return v.strip().upper()


class WatchlistItemOut(BaseModel):
    id: int
    ticker: str
    asset_class: Optional[str]
    added_at: str
    notes: Optional[str]
    score_value: Optional[float]

    model_config = {"from_attributes": True}


class WatchlistResponse(BaseModel):
    items: list[WatchlistItemOut]
    total: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_out(
    item: WatchlistItem,
    score_value: Optional[float],
) -> WatchlistItemOut:
    return WatchlistItemOut(
        id=item.id,
        ticker=item.ticker,
        asset_class=item.asset_class,
        added_at=item.added_at.isoformat(),
        notes=item.notes,
        score_value=score_value,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/watchlist", response_model=WatchlistResponse)
def get_watchlist(db: Session = Depends(get_db)) -> WatchlistResponse:
    """Return all watchlist items, enriched with current score values."""
    items = db.query(WatchlistItem).order_by(WatchlistItem.added_at.desc()).all()

    tickers = [item.ticker for item in items]
    score_lookup: dict[str, Optional[float]] = {}
    if tickers:
        rows = (
            db.query(AssetScoreCache)
            .filter(AssetScoreCache.ticker.in_(tickers))
            .all()
        )
        score_lookup = {r.ticker: r.score_value for r in rows}

    out = [_to_out(item, score_lookup.get(item.ticker)) for item in items]
    return WatchlistResponse(items=out, total=len(out))


@router.post("/watchlist", response_model=WatchlistItemOut)
def add_to_watchlist(
    body: WatchlistAddRequest,
    db: Session = Depends(get_db),
) -> WatchlistItemOut:
    """Add a scored asset to the watchlist.

    Idempotent: returns the existing watchlist item if the ticker is already
    present.  Returns 400 if the ticker is not in asset_score_cache.
    """
    ticker = body.ticker  # normalized to uppercase by validator

    score_row = (
        db.query(AssetScoreCache)
        .filter(AssetScoreCache.ticker == ticker)
        .first()
    )
    if score_row is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Ticker '{ticker}' is not in the scored universe. "
                "Only scored assets can be added to the watchlist."
            ),
        )

    existing = db.query(WatchlistItem).filter(WatchlistItem.ticker == ticker).first()
    if existing is not None:
        return _to_out(existing, score_row.score_value)

    bd = score_row.breakdown if isinstance(score_row.breakdown, dict) else {}
    asset_class: Optional[str] = bd.get("asset_class") if bd else None

    item = WatchlistItem(
        ticker=ticker,
        asset_class=asset_class,
        added_at=datetime.now(timezone.utc).replace(tzinfo=None),
        notes=body.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    return _to_out(item, score_row.score_value)


@router.delete("/watchlist/{ticker}", status_code=200)
def remove_from_watchlist(
    ticker: str,
    db: Session = Depends(get_db),
) -> dict:
    """Remove a ticker from the watchlist. Returns 404 if not present."""
    ticker = ticker.strip().upper()
    item = db.query(WatchlistItem).filter(WatchlistItem.ticker == ticker).first()
    if item is None:
        raise HTTPException(
            status_code=404,
            detail=f"Ticker '{ticker}' is not in the watchlist.",
        )
    db.delete(item)
    db.commit()
    return {"removed": ticker}
