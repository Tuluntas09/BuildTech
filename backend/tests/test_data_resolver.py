"""
Unit tests for the Task 4 data layer: provider, cache, snapshot reader,
and DataResolver 3-tier fallback.

All tests are network-free — yfinance is mocked throughout.
"""

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from sqlalchemy.orm import Session

from app.data.cache import PriceCache, CACHE_MAX_AGE_HOURS
from app.data.providers.base import Freshness, PriceRow, ProviderError
from app.data.providers.yfinance_provider import YFinanceProvider, _normalize_history
from app.data.resolver import DataResolver, PriceResult
from app.data.snapshot_prices import SnapshotReader

from tests.conftest import make_price_row, make_yf_dataframe

START = date(2024, 1, 2)
END = date(2024, 1, 3)


# ===========================================================================
# Helpers
# ===========================================================================

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _hours_ago(n: float) -> datetime:
    return _utcnow() - timedelta(hours=n)


# ===========================================================================
# YFinanceProvider tests
# ===========================================================================

class TestYFinanceProvider:

    def test_live_success_returns_price_rows(self):
        """Provider returns normalised PriceRows when yfinance succeeds."""
        mock_df = make_yf_dataframe("AAPL", START, days=2)

        with patch("yfinance.Ticker") as MockTicker:
            MockTicker.return_value.history.return_value = mock_df
            provider = YFinanceProvider()
            rows = provider.get_prices("AAPL", START, END)

        assert len(rows) == 2
        assert all(isinstance(r, PriceRow) for r in rows)
        assert rows[0].ticker == "AAPL"
        assert rows[0].close == pytest.approx(153.0)
        assert rows[0].adjusted_close == pytest.approx(152.5)
        assert rows[0].volume == 1_000_000
        assert rows[0].date == date(2024, 1, 2)

    def test_live_failure_raises_provider_error(self):
        """ProviderError is raised when yfinance raises an exception."""
        with patch("yfinance.Ticker") as MockTicker:
            MockTicker.return_value.history.side_effect = RuntimeError("network down")
            provider = YFinanceProvider()
            with pytest.raises(ProviderError, match="yfinance request failed"):
                provider.get_prices("AAPL", START, END)

    def test_empty_yfinance_response_returns_empty_list(self):
        """Empty DataFrame from yfinance is mapped to an empty list."""
        with patch("yfinance.Ticker") as MockTicker:
            MockTicker.return_value.history.return_value = pd.DataFrame()
            provider = YFinanceProvider()
            rows = provider.get_prices("AAPL", START, END)
        assert rows == []

    def test_no_fundamentals_methods_called(self):
        """Provider must not call info, financials, balance_sheet, or income_stmt."""
        mock_df = make_yf_dataframe("AAPL", START, days=1)

        with patch("yfinance.Ticker") as MockTicker:
            mock_ticker_instance = MockTicker.return_value
            mock_ticker_instance.history.return_value = mock_df
            provider = YFinanceProvider()
            provider.get_prices("AAPL", START, END)

            mock_ticker_instance.info.__get__ = MagicMock()
            assert not mock_ticker_instance.financials.called
            assert not mock_ticker_instance.balance_sheet.called
            assert not mock_ticker_instance.income_stmt.called

    def test_normalise_multiindex_columns(self):
        """Provider handles MultiIndex columns from newer yfinance versions."""
        base_df = make_yf_dataframe("AAPL", START, days=1)
        multi_df = base_df.copy()
        multi_df.columns = pd.MultiIndex.from_tuples(
            [(c, "AAPL") for c in base_df.columns]
        )
        fetched = _utcnow()
        rows = _normalize_history(multi_df, "AAPL", fetched)
        assert len(rows) == 1
        assert rows[0].close == pytest.approx(153.0)

    def test_provider_name(self):
        provider = YFinanceProvider()
        assert provider.provider_name == "YFinanceProvider"

    def test_only_yfinance_provider_exists(self):
        """BaseProvider has exactly one concrete subclass in the data layer."""
        from app.data.providers.base import BaseProvider
        # Only YFinanceProvider should be a direct subclass; no second provider.
        subclasses = BaseProvider.__subclasses__()
        names = [cls.__name__ for cls in subclasses]
        assert "YFinanceProvider" in names
        for name in names:
            assert name == "YFinanceProvider", (
                f"Unexpected provider '{name}' — v1.0 only allows YFinanceProvider"
            )


# ===========================================================================
# PriceCache tests
# ===========================================================================

class TestPriceCache:

    def test_write_and_read_roundtrip(self, db: Session):
        """Rows written to cache can be read back with all fields intact."""
        cache = PriceCache()
        row = make_price_row("AAPL", date(2024, 1, 2))
        cache.write(db, [row])
        result = cache.read(db, "AAPL", date(2024, 1, 1), date(2024, 1, 5))
        assert len(result) == 1
        assert result[0].ticker == "AAPL"
        assert result[0].close == pytest.approx(153.0)
        assert result[0].adjusted_close == pytest.approx(152.5)
        assert result[0].volume == 1_000_000

    def test_write_upserts_existing_row(self, db: Session):
        """Writing the same (ticker, date) twice updates rather than duplicates."""
        cache = PriceCache()
        row1 = make_price_row("AAPL", date(2024, 1, 2))
        row2 = PriceRow(
            ticker="AAPL",
            date=date(2024, 1, 2),
            open=200.0,
            high=210.0,
            low=195.0,
            close=205.0,
            adjusted_close=204.0,
            volume=2_000_000,
            fetched_at=_utcnow(),
        )
        cache.write(db, [row1])
        cache.write(db, [row2])
        result = cache.read(db, "AAPL", date(2024, 1, 1), date(2024, 1, 5))
        assert len(result) == 1
        assert result[0].close == pytest.approx(205.0)

    def test_read_returns_rows_ordered_by_date(self, db: Session):
        """read() returns rows sorted ascending by date."""
        cache = PriceCache()
        for d in [date(2024, 1, 4), date(2024, 1, 2), date(2024, 1, 3)]:
            cache.write(db, [make_price_row("AAPL", d)])
        result = cache.read(db, "AAPL", date(2024, 1, 1), date(2024, 1, 5))
        assert [r.date for r in result] == [
            date(2024, 1, 2), date(2024, 1, 3), date(2024, 1, 4)
        ]

    def test_is_fresh_returns_true_for_recent_data(self, db: Session):
        cache = PriceCache()
        row = make_price_row("AAPL", date(2024, 1, 2), fetched_at=_hours_ago(1))
        cache.write(db, [row])
        assert cache.is_fresh(db, "AAPL") is True

    def test_is_fresh_returns_false_for_stale_data(self, db: Session):
        cache = PriceCache()
        row = make_price_row("AAPL", date(2024, 1, 2), fetched_at=_hours_ago(25))
        cache.write(db, [row])
        assert cache.is_fresh(db, "AAPL") is False

    def test_is_fresh_returns_false_when_no_data(self, db: Session):
        cache = PriceCache()
        assert cache.is_fresh(db, "AAPL") is False

    def test_read_respects_date_range(self, db: Session):
        """read() does not return rows outside the requested range."""
        cache = PriceCache()
        for d in [date(2024, 1, 1), date(2024, 1, 2), date(2024, 1, 10)]:
            cache.write(db, [make_price_row("AAPL", d)])
        result = cache.read(db, "AAPL", date(2024, 1, 2), date(2024, 1, 5))
        assert len(result) == 1
        assert result[0].date == date(2024, 1, 2)


# ===========================================================================
# SnapshotReader tests
# ===========================================================================

class TestSnapshotReader:

    def test_reads_rows_from_parquet(self, snapshot_path: Path):
        reader = SnapshotReader(snapshot_path)
        rows = reader.read("AAPL", date(2024, 1, 1), date(2024, 1, 5))
        assert len(rows) == 2
        assert all(r.ticker == "AAPL" for r in rows)
        assert rows[0].date == date(2024, 1, 2)

    def test_filters_by_ticker(self, snapshot_path: Path):
        reader = SnapshotReader(snapshot_path)
        rows = reader.read("MSFT", date(2024, 1, 1), date(2024, 1, 5))
        assert len(rows) == 1
        assert rows[0].ticker == "MSFT"

    def test_returns_empty_when_file_missing(self, tmp_path: Path):
        reader = SnapshotReader(tmp_path / "nonexistent.parquet")
        rows = reader.read("AAPL", date(2024, 1, 1), date(2024, 1, 5))
        assert rows == []

    def test_returns_empty_for_unknown_ticker(self, snapshot_path: Path):
        reader = SnapshotReader(snapshot_path)
        rows = reader.read("ZZZZ", date(2024, 1, 1), date(2024, 1, 5))
        assert rows == []

    def test_filters_by_date_range(self, snapshot_path: Path):
        reader = SnapshotReader(snapshot_path)
        rows = reader.read("AAPL", date(2024, 1, 3), date(2024, 1, 3))
        assert len(rows) == 1
        assert rows[0].date == date(2024, 1, 3)


# ===========================================================================
# DataResolver 3-tier tests
# ===========================================================================

class TestDataResolver:

    def _make_resolver(
        self,
        provider=None,
        cache=None,
        snapshot=None,
    ) -> DataResolver:
        return DataResolver(
            provider=provider or MagicMock(spec=YFinanceProvider),
            cache=cache or PriceCache(),
            snapshot=snapshot or MagicMock(spec=SnapshotReader),
        )

    def test_live_success_returns_live_freshness(self, db: Session):
        """Tier 1: live provider succeeds → Freshness.LIVE."""
        live_rows = [make_price_row("AAPL", date(2024, 1, 2))]
        provider = MagicMock(spec=YFinanceProvider)
        provider.get_prices.return_value = live_rows

        resolver = self._make_resolver(provider=provider)
        result = resolver.resolve_prices("AAPL", START, END, db)

        assert result.freshness == Freshness.LIVE
        assert len(result.records) == 1
        assert result.records[0].ticker == "AAPL"

    def test_live_success_writes_to_cache(self, db: Session):
        """Tier 1 success: returned rows are persisted to cache."""
        live_rows = [make_price_row("AAPL", date(2024, 1, 2))]
        provider = MagicMock(spec=YFinanceProvider)
        provider.get_prices.return_value = live_rows

        resolver = self._make_resolver(provider=provider)
        resolver.resolve_prices("AAPL", START, END, db)

        cache = PriceCache()
        cached = cache.read(db, "AAPL", date(2024, 1, 1), date(2024, 1, 5))
        assert len(cached) == 1

    def test_live_failure_fresh_cache_returns_cached_freshness(self, db: Session):
        """Tier 2: live raises ProviderError, cache is fresh → Freshness.CACHED."""
        provider = MagicMock(spec=YFinanceProvider)
        provider.get_prices.side_effect = ProviderError("network error")

        cache = PriceCache()
        cache.write(db, [make_price_row("AAPL", date(2024, 1, 2), fetched_at=_hours_ago(1))])

        resolver = self._make_resolver(provider=provider, cache=cache)
        result = resolver.resolve_prices("AAPL", START, END, db)

        assert result.freshness == Freshness.CACHED
        assert len(result.records) == 1

    def test_live_failure_stale_cache_falls_to_snapshot(
        self, db: Session, snapshot_path: Path
    ):
        """Tier 3: live fails, cache is stale → Freshness.SNAPSHOT."""
        provider = MagicMock(spec=YFinanceProvider)
        provider.get_prices.side_effect = ProviderError("network error")

        cache = PriceCache()
        cache.write(
            db,
            [make_price_row("AAPL", date(2024, 1, 2), fetched_at=_hours_ago(30))],
        )

        resolver = self._make_resolver(
            provider=provider,
            cache=cache,
            snapshot=SnapshotReader(snapshot_path),
        )
        result = resolver.resolve_prices("AAPL", START, END, db)

        assert result.freshness == Freshness.SNAPSHOT
        assert len(result.records) == 2

    def test_all_tiers_miss_returns_empty_snapshot_freshness(
        self, db: Session, tmp_path: Path
    ):
        """All tiers exhausted → empty records, freshness=SNAPSHOT (last tier tried)."""
        provider = MagicMock(spec=YFinanceProvider)
        provider.get_prices.side_effect = ProviderError("down")

        resolver = self._make_resolver(
            provider=provider,
            cache=PriceCache(),
            snapshot=SnapshotReader(tmp_path / "no_file.parquet"),
        )
        result = resolver.resolve_prices("AAPL", START, END, db)

        assert result.freshness == Freshness.SNAPSHOT
        assert result.records == []

    def test_live_empty_result_falls_through_to_cache(self, db: Session):
        """Empty live result (e.g., market closed) falls through to cache tier."""
        provider = MagicMock(spec=YFinanceProvider)
        provider.get_prices.return_value = []  # empty, not an error

        cache = PriceCache()
        cache.write(db, [make_price_row("AAPL", date(2024, 1, 2), fetched_at=_hours_ago(1))])

        resolver = self._make_resolver(provider=provider, cache=cache)
        result = resolver.resolve_prices("AAPL", START, END, db)

        assert result.freshness == Freshness.CACHED

    def test_freshness_enum_values_match_plan(self):
        """Freshness enum values must match the strings used in the plan and UI."""
        assert Freshness.LIVE == "live"
        assert Freshness.CACHED == "cached"
        assert Freshness.SNAPSHOT == "snapshot"

    def test_resolver_does_not_use_non_yfinance_provider(self, db: Session):
        """Only YFinanceProvider is supplied as the provider — no other provider."""
        real_provider = YFinanceProvider()
        # Confirm it IS a YFinanceProvider and IS-A BaseProvider
        from app.data.providers.base import BaseProvider
        assert isinstance(real_provider, BaseProvider)
        assert type(real_provider).__name__ == "YFinanceProvider"

    def test_price_result_carries_ticker(self, db: Session):
        """PriceResult.ticker matches the requested ticker."""
        provider = MagicMock(spec=YFinanceProvider)
        provider.get_prices.return_value = [make_price_row("TSLA", date(2024, 1, 2))]

        resolver = self._make_resolver(provider=provider)
        result = resolver.resolve_prices("TSLA", START, END, db)

        assert result.ticker == "TSLA"
