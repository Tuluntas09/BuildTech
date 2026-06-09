"""
PriceCache — reads and writes the price_cache SQLite table.

Cache freshness: a cache entry is considered "fresh" when its most recent
fetched_at timestamp is within CACHE_MAX_AGE_HOURS of now (UTC).
Entries older than this threshold are bypassed in favour of the snapshot tier.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.data.providers.base import PriceRow
from app.models.tables import PriceCache as _PriceCacheRow

CACHE_MAX_AGE_HOURS: int = 24


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _row_to_price(r: _PriceCacheRow) -> PriceRow:
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


class PriceCache:
    """Service layer over the price_cache table.

    All datetime comparisons use naive UTC to match SQLite storage format.
    """

    def write(self, db: Session, rows: list[PriceRow]) -> None:
        """Upsert price rows into the cache.  Existing (ticker, date) entries are updated."""
        for row in rows:
            existing: Optional[_PriceCacheRow] = db.get(
                _PriceCacheRow, (row.ticker, row.date)
            )
            if existing is not None:
                existing.open = row.open
                existing.high = row.high
                existing.low = row.low
                existing.close = row.close
                existing.adjusted_close = row.adjusted_close
                existing.volume = row.volume
                existing.fetched_at = row.fetched_at
            else:
                db.add(
                    _PriceCacheRow(
                        ticker=row.ticker,
                        price_date=row.date,
                        open=row.open,
                        high=row.high,
                        low=row.low,
                        close=row.close,
                        adjusted_close=row.adjusted_close,
                        volume=row.volume,
                        fetched_at=row.fetched_at,
                    )
                )
        db.commit()

    def read(self, db: Session, ticker: str, start: date, end: date) -> list[PriceRow]:
        """Return cached rows for ticker in [start, end] inclusive, ordered by date."""
        stmt = (
            select(_PriceCacheRow)
            .where(
                _PriceCacheRow.ticker == ticker,
                _PriceCacheRow.price_date >= start,
                _PriceCacheRow.price_date <= end,
            )
            .order_by(_PriceCacheRow.price_date)
        )
        return [_row_to_price(r) for r in db.execute(stmt).scalars().all()]

    def is_fresh(self, db: Session, ticker: str) -> bool:
        """Return True if the most recent cache entry for ticker was fetched within
        CACHE_MAX_AGE_HOURS.  Returns False when no cache entry exists."""
        latest: Optional[datetime] = db.execute(
            select(_PriceCacheRow.fetched_at)
            .where(_PriceCacheRow.ticker == ticker)
            .order_by(_PriceCacheRow.fetched_at.desc())
            .limit(1)
        ).scalar_one_or_none()

        if latest is None:
            return False

        # Normalise to naive UTC for comparison
        if latest.tzinfo is not None:
            latest = latest.replace(tzinfo=None)

        return (_utcnow() - latest) < timedelta(hours=CACHE_MAX_AGE_HOURS)
