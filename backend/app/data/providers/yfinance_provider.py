"""
YFinanceProvider — fetches OHLCV price data via yfinance.

Scope: prices only.
Explicitly excluded: Ticker.info, financials, balance_sheet, income_stmt,
quarterly_* endpoints, or any fundamentals data.
"""

from datetime import date, datetime, timezone
from typing import Optional

import pandas as pd
import yfinance as yf

from app.data.providers.base import BaseProvider, PriceRow, ProviderError


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_float(val) -> Optional[float]:
    try:
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return None
        return float(val)
    except (TypeError, ValueError):
        return None


def _to_int(val) -> Optional[int]:
    try:
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return None
        return int(val)
    except (TypeError, ValueError):
        return None


def _normalize_history(df: pd.DataFrame, ticker: str, fetched_at: datetime) -> list[PriceRow]:
    """Convert a yfinance history DataFrame to PriceRow list."""
    if df.empty:
        return []

    # Flatten MultiIndex columns if present (newer yfinance versions)
    if isinstance(df.columns, pd.MultiIndex):
        df = df.copy()
        df.columns = df.columns.get_level_values(0)

    # Normalise column names: lowercase, map 'adj close' → 'adjusted_close'
    col_map: dict[str, str] = {}
    for c in df.columns:
        normalised = str(c).lower().strip()
        if normalised in ("adj close", "adj_close"):
            normalised = "adjusted_close"
        col_map[c] = normalised
    df = df.rename(columns=col_map)

    rows: list[PriceRow] = []
    for idx, row in df.iterrows():
        price_date: date = idx.date() if hasattr(idx, "date") else idx
        rows.append(
            PriceRow(
                ticker=ticker,
                date=price_date,
                open=_to_float(row.get("open")),
                high=_to_float(row.get("high")),
                low=_to_float(row.get("low")),
                close=_to_float(row.get("close")),
                adjusted_close=_to_float(row.get("adjusted_close")),
                volume=_to_int(row.get("volume")),
                fetched_at=fetched_at,
            )
        )
    return rows


class YFinanceProvider(BaseProvider):
    """Fetches OHLCV prices from yfinance.

    Uses Ticker.history() with auto_adjust=False so that both the raw Close
    and the Adj Close are available, matching the price_cache table schema.

    This provider MUST NOT call:
      - Ticker.info
      - Ticker.financials / Ticker.quarterly_financials
      - Ticker.balance_sheet / Ticker.quarterly_balance_sheet
      - Ticker.income_stmt / Ticker.quarterly_income_stmt
      - Any other fundamentals or company-info endpoint
    """

    def get_prices(self, ticker: str, start: date, end: date) -> list[PriceRow]:
        try:
            t = yf.Ticker(ticker)
            df: pd.DataFrame = t.history(
                start=str(start),
                end=str(end),
                auto_adjust=False,
                actions=False,
            )
        except Exception as exc:
            raise ProviderError(
                f"yfinance request failed for {ticker} [{start} → {end}]: {exc}"
            ) from exc

        return _normalize_history(df, ticker, _utcnow())
