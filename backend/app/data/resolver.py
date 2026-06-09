"""
DataResolver — 3-tier price resolution.

Resolution order (plan §9):
  1. Live yfinance  → on success, write to SQLite cache, return Freshness.LIVE
  2. SQLite cache   → used only when cache was populated within CACHE_MAX_AGE_HOURS
  3. Frozen parquet → read-only fallback from the most recent price snapshot

Each call returns a PriceResult that carries both the records and the freshness
tier, so callers (UI badges, export) can surface data provenance.

Notes:
  - Live returning an empty list is treated the same as a ProviderError: we
    attempt the next tier so the user gets whatever data is available rather
    than a silent empty response.
  - All three tiers exhausted → PriceResult with empty records; freshness is
    Freshness.SNAPSHOT (last tier attempted).
"""

import logging
from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from app.data.cache import PriceCache
from app.data.providers.base import BaseProvider, Freshness, PriceRow, ProviderError
from app.data.snapshot_prices import SnapshotReader

logger = logging.getLogger("buildtech.resolver")


@dataclass
class PriceResult:
    ticker: str
    records: list[PriceRow]
    freshness: Freshness


class DataResolver:
    """Resolves price data for a single ticker through the 3-tier stack.

    Constructor arguments are injected so each tier can be replaced with a
    test double without patching global state.
    """

    def __init__(
        self,
        provider: BaseProvider,
        cache: PriceCache,
        snapshot: SnapshotReader,
    ) -> None:
        self._provider = provider
        self._cache = cache
        self._snapshot = snapshot

    def resolve_prices(
        self,
        ticker: str,
        start: date,
        end: date,
        db: Session,
    ) -> PriceResult:
        """Resolve OHLCV prices for *ticker* over [start, end] inclusive.

        Returns a PriceResult with the records and the freshness tier that
        supplied them.  Never raises — callers receive empty records if all
        tiers are exhausted.
        """

        # --- Tier 1: live yfinance ---
        try:
            live_rows = self._provider.get_prices(ticker, start, end)
            if live_rows:
                try:
                    self._cache.write(db, live_rows)
                except Exception as cache_err:
                    logger.warning(
                        "cache write failed after live fetch for %s: %s", ticker, cache_err
                    )
                return PriceResult(
                    ticker=ticker, records=live_rows, freshness=Freshness.LIVE
                )
            # Empty live result — fall through so we try cache/snapshot
            logger.debug("live provider returned no rows for %s [%s→%s]", ticker, start, end)
        except ProviderError as err:
            logger.debug("live provider error for %s: %s", ticker, err)

        # --- Tier 2: SQLite cache ---
        if self._cache.is_fresh(db, ticker):
            cached_rows = self._cache.read(db, ticker, start, end)
            if cached_rows:
                return PriceResult(
                    ticker=ticker, records=cached_rows, freshness=Freshness.CACHED
                )

        # --- Tier 3: frozen parquet snapshot ---
        snap_rows = self._snapshot.read(ticker, start, end)
        return PriceResult(
            ticker=ticker,
            records=snap_rows,
            freshness=Freshness.SNAPSHOT,
        )
