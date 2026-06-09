"""
Universe Explorer endpoint — GET /api/v1/universe

Read-only. Reads cached scoring results from asset_score_cache.
Does NOT compute scores, fetch prices, call yfinance, or invoke construction.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.tables import AssetScoreCache

router = APIRouter(tags=["universe"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class UniverseItem(BaseModel):
    ticker: str
    asset_class: Optional[str]
    score_value: Optional[float]
    has_missing_factors: bool
    breakdown: Optional[dict[str, Any]]
    fundamentals_snapshot_date: Optional[str]
    prices_computed_at: Optional[str]

    model_config = {"from_attributes": True}


class UniverseResponse(BaseModel):
    items: list[UniverseItem]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _extract_asset_class(breakdown: Optional[dict]) -> Optional[str]:
    if not breakdown:
        return None
    return breakdown.get("asset_class")


def _extract_has_missing(breakdown: Optional[dict]) -> bool:
    if not breakdown:
        return False
    return bool(breakdown.get("has_missing_factors", False))


def _to_item(row: AssetScoreCache) -> UniverseItem:
    bd = row.breakdown if isinstance(row.breakdown, dict) else None
    return UniverseItem(
        ticker=row.ticker,
        asset_class=_extract_asset_class(bd),
        score_value=row.score_value,
        has_missing_factors=_extract_has_missing(bd),
        breakdown=bd,
        fundamentals_snapshot_date=row.fundamentals_snapshot_date,
        prices_computed_at=(
            row.prices_computed_at.isoformat() if row.prices_computed_at else None
        ),
    )


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.get("/universe", response_model=UniverseResponse)
def get_universe(
    search: Optional[str] = Query(None, description="Filter by ticker (case-insensitive substring)"),
    asset_class: Optional[str] = Query(None, description="Filter by asset class: 'stock' or 'etf'"),
    sort_by: str = Query("score", description="Sort field: 'score' or 'ticker'"),
    sort_dir: str = Query("desc", description="Sort direction: 'asc' or 'desc'"),
    limit: int = Query(100, ge=1, le=500, description="Page size"),
    offset: int = Query(0, ge=0, description="Page offset"),
    db: Session = Depends(get_db),
) -> UniverseResponse:
    """Return cached scored assets from asset_score_cache.

    Supports ticker search, asset class filtering, sorting, and pagination.
    Returns an empty list when no cached scores exist — does not trigger scoring.
    """
    query = db.query(AssetScoreCache)

    # SQL-level ticker filter (ticker is a top-level indexed column)
    if search:
        query = query.filter(
            AssetScoreCache.ticker.ilike(f"%{search.strip()}%")
        )

    # SQL-level score sort (score_value is a top-level column)
    if sort_by == "ticker":
        if sort_dir == "asc":
            query = query.order_by(AssetScoreCache.ticker.asc())
        else:
            query = query.order_by(AssetScoreCache.ticker.desc())
    else:
        # Default: sort by score descending (NULLs last)
        if sort_dir == "asc":
            query = query.order_by(
                AssetScoreCache.score_value.asc().nulls_last()
            )
        else:
            query = query.order_by(
                AssetScoreCache.score_value.desc().nulls_last()
            )

    rows = query.all()

    # Python-level asset class filter (asset_class lives inside breakdown JSON)
    if asset_class:
        ac_lower = asset_class.strip().lower()
        rows = [r for r in rows if _extract_asset_class(
            r.breakdown if isinstance(r.breakdown, dict) else None
        ) == ac_lower]

    total = len(rows)
    page = rows[offset: offset + limit]
    items = [_to_item(r) for r in page]

    return UniverseResponse(items=items, total=total, limit=limit, offset=offset)
