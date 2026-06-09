"""
Portfolio persistence endpoints — POST/GET/PATCH /api/v1/portfolios

Persists generated candidate portfolio variants selected by the user.
Does NOT call construction, scoring, or yfinance.

Lifecycle: draft → saved → archived.  archived → saved (unarchive).

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.tables import PortfolioHolding, PortfolioSkipLog, SavedPortfolio

router = APIRouter(tags=["portfolios"])

_VALID_STATUSES = {"draft", "saved", "archived"}

# Allowed lifecycle transitions.  Holdings/weights cannot be edited here.
_VALID_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"saved"},
    "saved": {"archived"},
    "archived": {"saved"},
}


# ---------------------------------------------------------------------------
# Pydantic schemas — save request
# ---------------------------------------------------------------------------

class HoldingSaveIn(BaseModel):
    ticker: str
    asset_class: Optional[str] = None
    weight: float
    score: Optional[float] = None
    score_breakdown: Optional[dict[str, Any]] = None


class SkipLogSaveIn(BaseModel):
    skipped_ticker: str
    skipped_asset_class: Optional[str] = None
    reason: Optional[str] = None
    threshold: Optional[float] = None
    actual_correlation: Optional[float] = None
    conflicts_with_ticker: Optional[str] = None


class PortfolioSaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    status: str = Field(default="saved")
    variant_type: Optional[str] = None
    risk_level_snapshot: Optional[int] = None
    source_universe: Optional[str] = None
    generation_method: str  # NOT NULL — required by schema
    correlation_relaxations_applied: int = Field(default=0)
    # prices_freshness_at_save: 'cached' if not supplied; builder reads from price_cache.
    # The builder response does not report which price source was used per-request,
    # so 'cached' is the best available value when the caller omits this field.
    prices_freshness_at_save: Optional[str] = None
    fundamentals_snapshot_date: Optional[str] = None
    construction_log: list[dict[str, Any]] = Field(default_factory=list)
    portfolio_metadata: Optional[dict[str, Any]] = None
    holdings: list[HoldingSaveIn] = Field(default_factory=list)
    skip_log: list[SkipLogSaveIn] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Pydantic schemas — responses
# ---------------------------------------------------------------------------

class HoldingOut(BaseModel):
    ticker: str
    asset_class: Optional[str]
    weight: float
    score: Optional[float]
    score_breakdown: Optional[dict[str, Any]]


class SkipLogEntryOut(BaseModel):
    id: int
    skipped_ticker: str
    skipped_asset_class: Optional[str]
    reason: Optional[str]
    threshold: Optional[float]
    actual_correlation: Optional[float]
    conflicts_with_ticker: Optional[str]


class PortfolioSummaryOut(BaseModel):
    id: int
    name: str
    variant_type: Optional[str]
    risk_level_snapshot: Optional[int]
    status: str
    source_universe: Optional[str]
    generation_method: str
    correlation_relaxations_applied: Optional[int]
    prices_freshness_at_save: Optional[str]
    fundamentals_snapshot_date: Optional[str]
    created_at: str
    updated_at: str
    holding_count: int


class PortfolioDetailOut(BaseModel):
    id: int
    name: str
    variant_type: Optional[str]
    risk_level_snapshot: Optional[int]
    status: str
    source_universe: Optional[str]
    generation_method: str
    correlation_relaxations_applied: Optional[int]
    prices_freshness_at_save: Optional[str]
    fundamentals_snapshot_date: Optional[str]
    construction_log: list[dict[str, Any]]
    portfolio_metadata: Optional[dict[str, Any]]
    created_at: str
    updated_at: str
    holdings: list[HoldingOut]
    skip_log: list[SkipLogEntryOut]


class PortfolioListResponse(BaseModel):
    items: list[PortfolioSummaryOut]
    total: int
    limit: int
    offset: int


class PortfolioStatusPatch(BaseModel):
    status: str


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_summary(portfolio: SavedPortfolio, holding_count: int) -> PortfolioSummaryOut:
    return PortfolioSummaryOut(
        id=portfolio.id,
        name=portfolio.name,
        variant_type=portfolio.variant_type,
        risk_level_snapshot=portfolio.risk_level_snapshot,
        status=portfolio.status,
        source_universe=portfolio.source_universe,
        generation_method=portfolio.generation_method,
        correlation_relaxations_applied=portfolio.correlation_relaxations_applied,
        prices_freshness_at_save=portfolio.prices_freshness_at_save,
        fundamentals_snapshot_date=portfolio.fundamentals_snapshot_date,
        created_at=portfolio.created_at.isoformat(),
        updated_at=portfolio.updated_at.isoformat(),
        holding_count=holding_count,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/portfolios", response_model=PortfolioSummaryOut, status_code=201)
def save_portfolio(
    body: PortfolioSaveRequest,
    db: Session = Depends(get_db),
) -> PortfolioSummaryOut:
    """Persist a generated candidate portfolio variant.

    Does NOT call construction, scoring, or yfinance.
    Saves holdings, construction log, and skip log atomically.
    """
    if body.status not in _VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{body.status}'. Must be one of: {sorted(_VALID_STATUSES)}.",
        )
    if not body.holdings:
        raise HTTPException(
            status_code=400,
            detail="holdings must be non-empty. A saved candidate portfolio requires at least one holding.",
        )

    now = _now_naive()

    portfolio = SavedPortfolio(
        name=body.name.strip(),
        variant_type=body.variant_type,
        risk_level_snapshot=body.risk_level_snapshot,
        status=body.status,
        source_universe=body.source_universe,
        generation_method=body.generation_method,
        correlation_relaxations_applied=body.correlation_relaxations_applied,
        prices_freshness_at_save=body.prices_freshness_at_save or "cached",
        fundamentals_snapshot_date=body.fundamentals_snapshot_date,
        construction_log=body.construction_log,
        portfolio_metadata=body.portfolio_metadata,
        created_at=now,
        updated_at=now,
    )
    db.add(portfolio)
    db.flush()  # assign portfolio.id before inserting child rows

    for h in body.holdings:
        db.add(PortfolioHolding(
            portfolio_id=portfolio.id,
            ticker=h.ticker,
            asset_class=h.asset_class,
            weight=h.weight,
            score=h.score,
            score_breakdown=h.score_breakdown,
        ))

    for s in body.skip_log:
        db.add(PortfolioSkipLog(
            portfolio_id=portfolio.id,
            skipped_ticker=s.skipped_ticker,
            skipped_asset_class=s.skipped_asset_class,
            reason=s.reason,
            threshold=s.threshold,
            actual_correlation=s.actual_correlation,
            conflicts_with_ticker=s.conflicts_with_ticker,
            created_at=now,
        ))

    db.commit()
    db.refresh(portfolio)

    return _to_summary(portfolio, len(body.holdings))


@router.get("/portfolios", response_model=PortfolioListResponse)
def list_portfolios(
    status: Optional[str] = "saved",
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> PortfolioListResponse:
    """List saved portfolios.

    Default status filter is 'saved'. Pass ?status=all to return all statuses.
    """
    query = db.query(SavedPortfolio)
    if status and status != "all":
        if status not in _VALID_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid status filter '{status}'. "
                    f"Use one of: {sorted(_VALID_STATUSES)} or 'all'."
                ),
            )
        query = query.filter(SavedPortfolio.status == status)

    total = query.count()
    portfolios = (
        query.order_by(SavedPortfolio.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Batch-load holding counts for all returned portfolios
    count_by_id: dict[int, int] = {}
    if portfolios:
        portfolio_ids = [p.id for p in portfolios]
        count_rows = (
            db.query(
                PortfolioHolding.portfolio_id,
                func.count(PortfolioHolding.ticker).label("cnt"),
            )
            .filter(PortfolioHolding.portfolio_id.in_(portfolio_ids))
            .group_by(PortfolioHolding.portfolio_id)
            .all()
        )
        count_by_id = {row.portfolio_id: row.cnt for row in count_rows}

    items = [_to_summary(p, count_by_id.get(p.id, 0)) for p in portfolios]
    return PortfolioListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/portfolios/{portfolio_id}", response_model=PortfolioDetailOut)
def get_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
) -> PortfolioDetailOut:
    """Return one saved portfolio with full holdings, construction log, and skip log."""
    portfolio = (
        db.query(SavedPortfolio)
        .filter(SavedPortfolio.id == portfolio_id)
        .first()
    )
    if portfolio is None:
        raise HTTPException(status_code=404, detail=f"Portfolio {portfolio_id} not found.")

    holdings = (
        db.query(PortfolioHolding)
        .filter(PortfolioHolding.portfolio_id == portfolio_id)
        .order_by(PortfolioHolding.weight.desc())
        .all()
    )
    skip_entries = (
        db.query(PortfolioSkipLog)
        .filter(PortfolioSkipLog.portfolio_id == portfolio_id)
        .order_by(PortfolioSkipLog.id)
        .all()
    )

    return PortfolioDetailOut(
        id=portfolio.id,
        name=portfolio.name,
        variant_type=portfolio.variant_type,
        risk_level_snapshot=portfolio.risk_level_snapshot,
        status=portfolio.status,
        source_universe=portfolio.source_universe,
        generation_method=portfolio.generation_method,
        correlation_relaxations_applied=portfolio.correlation_relaxations_applied,
        prices_freshness_at_save=portfolio.prices_freshness_at_save,
        fundamentals_snapshot_date=portfolio.fundamentals_snapshot_date,
        construction_log=portfolio.construction_log or [],
        portfolio_metadata=portfolio.portfolio_metadata,
        created_at=portfolio.created_at.isoformat(),
        updated_at=portfolio.updated_at.isoformat(),
        holdings=[
            HoldingOut(
                ticker=h.ticker,
                asset_class=h.asset_class,
                weight=h.weight,
                score=h.score,
                score_breakdown=h.score_breakdown,
            )
            for h in holdings
        ],
        skip_log=[
            SkipLogEntryOut(
                id=s.id,
                skipped_ticker=s.skipped_ticker,
                skipped_asset_class=s.skipped_asset_class,
                reason=s.reason,
                threshold=s.threshold,
                actual_correlation=s.actual_correlation,
                conflicts_with_ticker=s.conflicts_with_ticker,
            )
            for s in skip_entries
        ],
    )


@router.patch("/portfolios/{portfolio_id}", response_model=PortfolioSummaryOut)
def update_portfolio_status(
    portfolio_id: int,
    body: PortfolioStatusPatch,
    db: Session = Depends(get_db),
) -> PortfolioSummaryOut:
    """Change portfolio lifecycle status.

    Allowed transitions:
      draft   → saved
      saved   → archived
      archived → saved  (unarchive)

    Holdings and weights cannot be changed; use Builder to generate a new
    candidate portfolio.
    """
    portfolio = (
        db.query(SavedPortfolio)
        .filter(SavedPortfolio.id == portfolio_id)
        .first()
    )
    if portfolio is None:
        raise HTTPException(status_code=404, detail=f"Portfolio {portfolio_id} not found.")

    new_status = body.status
    if new_status not in _VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{new_status}'. Must be one of: {sorted(_VALID_STATUSES)}.",
        )

    current = portfolio.status
    allowed = _VALID_TRANSITIONS.get(current, set())
    if new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot transition from '{current}' to '{new_status}'. "
                f"Allowed from '{current}': {sorted(allowed)}."
            ),
        )

    portfolio.status = new_status
    portfolio.updated_at = _now_naive()
    db.commit()
    db.refresh(portfolio)

    holding_count = (
        db.query(func.count(PortfolioHolding.ticker))
        .filter(PortfolioHolding.portfolio_id == portfolio_id)
        .scalar()
        or 0
    )

    return _to_summary(portfolio, holding_count)
