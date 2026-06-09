"""
SnapshotReader — reads prices from a frozen parquet snapshot file.

The snapshot file is written by scripts/build_price_snapshot.py (Task 6).
This module only reads; it never downloads or generates snapshots.

Expected parquet schema (all columns):
  ticker           : str
  date             : str (ISO "YYYY-MM-DD") or datetime/date
  open             : float | None
  high             : float | None
  low              : float | None
  close            : float | None
  adjusted_close   : float | None
  volume           : int | None
"""

from datetime import date, datetime
from pathlib import Path
from typing import Optional

from app.data.providers.base import PriceRow


def _utcnow() -> datetime:
    from datetime import timezone
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_float(val) -> Optional[float]:
    try:
        if val is None:
            return None
        import math
        if isinstance(val, float) and math.isnan(val):
            return None
        return float(val)
    except (TypeError, ValueError):
        return None


def _to_int(val) -> Optional[int]:
    try:
        if val is None:
            return None
        import math
        if isinstance(val, float) and math.isnan(val):
            return None
        return int(val)
    except (TypeError, ValueError):
        return None


def _coerce_date(val) -> Optional[date]:
    if val is None:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, str):
        try:
            return date.fromisoformat(val[:10])
        except ValueError:
            return None
    # pandas Timestamp
    try:
        return val.date()
    except AttributeError:
        return None


class SnapshotReader:
    """Reads OHLCV price data from a frozen parquet snapshot.

    Returns an empty list (not an error) when the snapshot file does not
    exist — this is expected before Task 6 generates the first snapshot.
    """

    def __init__(self, path: Path) -> None:
        self._path = path

    def read(self, ticker: str, start: date, end: date) -> list[PriceRow]:
        if not self._path.exists():
            return []

        try:
            import pandas as pd
            df = pd.read_parquet(self._path)
        except Exception:
            return []

        if df.empty or "ticker" not in df.columns:
            return []

        # Filter by ticker
        df = df[df["ticker"] == ticker].copy()
        if df.empty:
            return []

        # Coerce date column to Python date objects
        if "date" not in df.columns:
            return []

        df["_date"] = df["date"].apply(_coerce_date)
        df = df.dropna(subset=["_date"])
        df = df[(df["_date"] >= start) & (df["_date"] <= end)]
        if df.empty:
            return []

        snapshot_fetched_at = _utcnow()
        rows: list[PriceRow] = []
        for _, row in df.iterrows():
            rows.append(
                PriceRow(
                    ticker=ticker,
                    date=row["_date"],
                    open=_to_float(row.get("open")),
                    high=_to_float(row.get("high")),
                    low=_to_float(row.get("low")),
                    close=_to_float(row.get("close")),
                    adjusted_close=_to_float(row.get("adjusted_close")),
                    volume=_to_int(row.get("volume")),
                    fetched_at=snapshot_fetched_at,
                )
            )
        rows.sort(key=lambda r: r.date)
        return rows
