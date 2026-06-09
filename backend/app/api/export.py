"""
Export endpoint — GET /api/v1/export/portfolios/{portfolio_id}

Exports a saved candidate portfolio as v4-compatible JSON.
Reads only from saved_portfolio, portfolio_holding, portfolio_skip_log.
Does NOT call construction, scoring, or yfinance.
Does NOT write to the database.

Allowed for status: saved, archived, draft (read-only in all cases).

metrics_snapshot is set to {"status": "not_computed"} — performance metrics
are not persisted yet and must not be invented.

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.
"""

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.tables import PortfolioHolding, PortfolioSkipLog, SavedPortfolio

router = APIRouter(tags=["export"])

_RISK_NAMES: dict[int, str] = {
    1: "Citadel",
    2: "Anchor",
    3: "Compass",
    4: "Voyager",
    5: "Frontier",
}

# Regex for filename-safe characters only
_SAFE_FILENAME_RE = re.compile(r"[^\w\-]")


def _safe_filename(name: str, portfolio_id: int) -> str:
    """Produce a safe ASCII filename from the portfolio name."""
    sanitized = _SAFE_FILENAME_RE.sub("_", name).strip("_")[:50]
    if not sanitized:
        sanitized = "portfolio"
    return f"buildtech_{sanitized}_{portfolio_id}.json"


def _extract_constraints(metadata: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Pull constraints from portfolio_metadata.constraints_summary if persisted."""
    if not metadata:
        return {"single_asset_max": None, "min_positions": None, "max_positions": None}
    cs = metadata.get("constraints_summary") or {}
    return {
        "single_asset_max": cs.get("single_asset_max"),
        "min_positions": cs.get("min_positions"),
        # Fall back to actual_positions when max_positions wasn't stored
        "max_positions": cs.get("max_positions") or cs.get("actual_positions"),
    }


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.get("/export/portfolios/{portfolio_id}")
def export_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
) -> Response:
    """Export a saved candidate portfolio as v4-compatible JSON.

    Does NOT call construction, scoring, or yfinance.
    Does NOT write to the database.
    Allowed for all lifecycle statuses (saved, archived, draft).
    metrics_snapshot is {"status": "not_computed"} — not invented.
    """
    portfolio = (
        db.query(SavedPortfolio)
        .filter(SavedPortfolio.id == portfolio_id)
        .first()
    )
    if portfolio is None:
        raise HTTPException(
            status_code=404,
            detail=f"Portfolio {portfolio_id} not found.",
        )

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

    exported_at = datetime.now(timezone.utc).isoformat()
    risk_level = portfolio.risk_level_snapshot
    constraints = _extract_constraints(portfolio.portfolio_metadata)

    export_doc: dict[str, Any] = {
        "schema_version": "1.0",
        "source": "BuildTech",
        "exported_at": exported_at,
        "portfolio_id": portfolio.id,
        "portfolio_name": portfolio.name,
        "portfolio_status": portfolio.status,
        "risk_profile": {
            "level_id": risk_level,
            "level_name": _RISK_NAMES.get(risk_level) if risk_level is not None else None,
            "theme": None,
        },
        "variant_type": portfolio.variant_type,
        "construction_context": {
            "source_universe": portfolio.source_universe,
            "generation_method": portfolio.generation_method,
            "correlation_relaxations_applied": portfolio.correlation_relaxations_applied or 0,
            "constraints_applied": constraints,
            "construction_log": portfolio.construction_log or [],
        },
        "data_freshness_at_export": {
            "prices": portfolio.prices_freshness_at_save or "cached",
            "fundamentals_snapshot_date": portfolio.fundamentals_snapshot_date,
        },
        "holdings": [
            {
                "ticker": h.ticker,
                "asset_class": h.asset_class,
                "weight": h.weight,
                "score": h.score,
                "score_breakdown": h.score_breakdown,
            }
            for h in holdings
        ],
        "correlation_skips": [
            {
                "skipped_ticker": s.skipped_ticker,
                "skipped_asset_class": s.skipped_asset_class,
                "reason": s.reason,
                "threshold": s.threshold,
                "actual_correlation": s.actual_correlation,
                "conflicts_with_ticker": s.conflicts_with_ticker,
            }
            for s in skip_entries
        ],
        # Performance metrics are not yet persisted — not computed, not invented.
        "metrics_snapshot": {"status": "not_computed"},
    }

    content = json.dumps(export_doc, indent=2, default=str)
    filename = _safe_filename(portfolio.name, portfolio.id)

    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
