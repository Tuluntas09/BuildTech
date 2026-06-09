"""
Analytics endpoint — GET /api/v1/analytics/portfolios/{portfolio_id}

Computes historical performance metrics for a saved candidate portfolio.

Data sources (local only, in priority order):
  1. price_cache (SQLite)
  2. frozen parquet snapshot (if price_cache is empty for a ticker)

Does NOT call yfinance, scoring, or construction.
Does NOT write to the database.
Metrics are historical and period-specific only.

If insufficient price data is available, returns null metrics and an
honest reason — values are never invented.

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.
"""

from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.performance import compute_portfolio_metrics, compute_spy_benchmark
from app.data.snapshot_prices import SnapshotReader
from app.db.session import get_db
from app.models.tables import PortfolioHolding, PriceCache, SavedPortfolio

router = APIRouter(tags=["analytics"])

VALID_PERIODS: frozenset[str] = frozenset({"1y", "3y", "5y", "ytd", "max"})


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class DateValue(BaseModel):
    date: str
    value: float


class DateDrawdown(BaseModel):
    date: str
    drawdown: float


class PortfolioAnalyticsResponse(BaseModel):
    portfolio_id: int
    period_requested: str
    period_start: Optional[str]
    period_end: Optional[str]
    trading_days_used: int
    insufficient_data: bool
    reason: Optional[str]
    tickers_excluded: list[str]
    spy_available: bool
    cumulative_return: Optional[float]
    annualized_volatility: Optional[float]
    max_drawdown: Optional[float]
    sharpe_ratio: Optional[float]
    equity_curve: list[DateValue]
    drawdown_series: list[DateDrawdown]
    spy_benchmark: Optional[list[DateValue]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _period_start(period: str, today: date) -> date:
    if period == "ytd":
        return date(today.year, 1, 1)
    if period == "max":
        return date(1970, 1, 1)
    years = {"1y": 1, "3y": 3, "5y": 5}[period]
    try:
        return date(today.year - years, today.month, today.day)
    except ValueError:
        # Feb 29 falling into a non-leap year
        return date(today.year - years, today.month, today.day - 1)


def _resolve_local_prices(
    ticker: str,
    start: date,
    end: date,
    db: Session,
    snapshot: SnapshotReader,
) -> dict[date, float]:
    """Return {date: close_price} from SQLite cache, then snapshot fallback.

    Uses adjusted_close when available, close otherwise.
    Never calls yfinance or any live provider.
    """
    rows = (
        db.query(PriceCache)
        .filter(
            PriceCache.ticker == ticker,
            PriceCache.price_date >= start,
            PriceCache.price_date <= end,
        )
        .order_by(PriceCache.price_date)
        .all()
    )
    if rows:
        result: dict[date, float] = {}
        for r in rows:
            price = r.adjusted_close if r.adjusted_close is not None else r.close
            if price is not None and price > 0:
                result[r.price_date] = price
        if result:
            return result

    # Fallback: frozen parquet snapshot
    price_rows = snapshot.read(ticker, start, end)
    if not price_rows:
        return {}
    result = {}
    for r in price_rows:
        price = r.adjusted_close if r.adjusted_close is not None else r.close
        if price is not None and price > 0:
            result[r.date] = price
    return result


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.get("/analytics/portfolios/{portfolio_id}")
def get_portfolio_analytics(
    portfolio_id: int,
    period: str = "1y",
    db: Session = Depends(get_db),
) -> PortfolioAnalyticsResponse:
    """Return historical analytics for a saved candidate portfolio.

    Reads from local price_cache and frozen snapshot only.
    Does NOT call yfinance, scoring, or construction.
    Does NOT write to the database.
    """
    if period not in VALID_PERIODS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period '{period}'. Valid values: {sorted(VALID_PERIODS)}.",
        )

    portfolio = (
        db.query(SavedPortfolio).filter(SavedPortfolio.id == portfolio_id).first()
    )
    if portfolio is None:
        raise HTTPException(
            status_code=404,
            detail=f"Portfolio {portfolio_id} not found.",
        )

    holdings = (
        db.query(PortfolioHolding)
        .filter(PortfolioHolding.portfolio_id == portfolio_id)
        .all()
    )

    today = date.today()
    req_start = _period_start(period, today)
    req_end = today

    settings = get_settings()
    snapshot = SnapshotReader(Path(settings.snapshot_prices_path))

    # Resolve local prices for each holding
    ticker_prices: dict[str, dict[date, float]] = {}
    tickers_excluded: list[str] = []

    for h in holdings:
        prices = _resolve_local_prices(h.ticker, req_start, req_end, db, snapshot)
        if prices:
            ticker_prices[h.ticker] = prices
        else:
            tickers_excluded.append(h.ticker)

    def _no_data_response(reason: str) -> PortfolioAnalyticsResponse:
        return PortfolioAnalyticsResponse(
            portfolio_id=portfolio_id,
            period_requested=period,
            period_start=None,
            period_end=None,
            trading_days_used=0,
            insufficient_data=True,
            reason=reason,
            tickers_excluded=tickers_excluded,
            spy_available=False,
            cumulative_return=None,
            annualized_volatility=None,
            max_drawdown=None,
            sharpe_ratio=None,
            equity_curve=[],
            drawdown_series=[],
            spy_benchmark=None,
        )

    if not ticker_prices:
        return _no_data_response(
            "No usable local price data found for any holding in this portfolio."
        )

    # Normalize weights over included tickers
    included = [h for h in holdings if h.ticker in ticker_prices]
    weight_sum = sum(h.weight for h in included)
    weights = {
        h.ticker: h.weight / weight_sum
        for h in included
    }

    # Align to common dates across all included tickers
    date_sets = [set(ticker_prices[t].keys()) for t in ticker_prices]
    common_dates = sorted(set.intersection(*date_sets))

    metrics = compute_portfolio_metrics(common_dates, ticker_prices, weights)

    if metrics["insufficient_data"]:
        return PortfolioAnalyticsResponse(
            portfolio_id=portfolio_id,
            period_requested=period,
            period_start=common_dates[0].isoformat() if common_dates else None,
            period_end=common_dates[-1].isoformat() if common_dates else None,
            trading_days_used=metrics["trading_days_used"],
            insufficient_data=True,
            reason=metrics["reason"],
            tickers_excluded=tickers_excluded,
            spy_available=False,
            cumulative_return=None,
            annualized_volatility=None,
            max_drawdown=None,
            sharpe_ratio=None,
            equity_curve=[],
            drawdown_series=[],
            spy_benchmark=None,
        )

    # SPY benchmark (local data only, optional)
    spy_prices = _resolve_local_prices("SPY", req_start, req_end, db, snapshot)
    spy_available = bool(spy_prices)
    spy_benchmark_data: Optional[list[dict]] = None

    if spy_available:
        spy_curve = compute_spy_benchmark(spy_prices, common_dates)
        spy_benchmark_data = spy_curve if spy_curve else None
        if not spy_curve:
            spy_available = False

    return PortfolioAnalyticsResponse(
        portfolio_id=portfolio_id,
        period_requested=period,
        period_start=common_dates[0].isoformat(),
        period_end=common_dates[-1].isoformat(),
        trading_days_used=metrics["trading_days_used"],
        insufficient_data=False,
        reason=None,
        tickers_excluded=tickers_excluded,
        spy_available=spy_available,
        cumulative_return=metrics["cumulative_return"],
        annualized_volatility=metrics["annualized_volatility"],
        max_drawdown=metrics["max_drawdown"],
        sharpe_ratio=metrics["sharpe_ratio"],
        equity_curve=[DateValue(**e) for e in metrics["equity_curve"]],
        drawdown_series=[DateDrawdown(**e) for e in metrics["drawdown_series"]],
        spy_benchmark=(
            [DateValue(**e) for e in spy_benchmark_data]
            if spy_benchmark_data
            else None
        ),
    )
