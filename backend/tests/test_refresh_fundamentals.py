"""
Unit tests for backend/scripts/refresh_fundamentals.py

All tests are network-free — yfinance is mocked via
  patch("scripts.refresh_fundamentals.yf")

Tests use pytest's tmp_path fixture for all filesystem operations.
"""

import json
import shutil
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from scripts.refresh_fundamentals import (
    KEEP_LAST_N,
    MAX_FAILURE_RATE,
    _normalize_info,
    fetch_ticker_fundamentals,
    load_universe,
    main,
    prune_old_snapshots,
    update_latest_pointer,
    write_snapshot,
)

SNAPSHOT_DATE = date(2026, 1, 15)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_universe_file(path: Path, stocks=("AAPL",), etfs=("SPY",)) -> Path:
    u = tmp = path / "universe.json"
    u.write_text(json.dumps({"stocks": list(stocks), "etfs": list(etfs)}))
    return u


def _stock_info() -> dict:
    return {
        "marketCap": 3_000_000_000_000,
        "trailingPE": 28.5,
        "priceToBook": 45.2,
        "enterpriseValue": 2_900_000_000_000,
        "ebitda": 120_000_000_000,
        "freeCashflow": 90_000_000_000,
        "returnOnEquity": 1.47,
        "returnOnAssets": 0.28,
        "debtToEquity": 140.0,
        "profitMargins": 0.25,
        "operatingMargins": 0.30,
        "averageVolume": 55_000_000,
        "currency": "USD",
    }


def _etf_info() -> dict:
    return {
        "expenseRatio": 0.0003,
        "totalAssets": 500_000_000_000,
        "averageVolume": 80_000_000,
        "category": "Large Blend",
        "currency": "USD",
    }


# ---------------------------------------------------------------------------
# 1. load_universe: stocks and ETFs parsed correctly
# ---------------------------------------------------------------------------

class TestLoadUniverse:

    def test_stocks_and_etfs_parsed(self, tmp_path):
        u = _make_universe_file(tmp_path, stocks=["AAPL", "MSFT"], etfs=["SPY"])
        result = load_universe(u)
        assert ("AAPL", "stock") in result
        assert ("MSFT", "stock") in result
        assert ("SPY", "etf") in result
        assert len(result) == 3

    def test_underscore_keys_ignored(self, tmp_path):
        data = {
            "_note": "meta comment",
            "_version": "placeholder",
            "stocks": ["AAPL"],
            "etfs": [],
        }
        u = tmp_path / "universe.json"
        u.write_text(json.dumps(data))
        result = load_universe(u)
        assert result == [("AAPL", "stock")]

    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_universe(tmp_path / "nonexistent.json")

    def test_tickers_uppercased(self, tmp_path):
        data = {"stocks": ["aapl"], "etfs": ["spy"]}
        u = tmp_path / "universe.json"
        u.write_text(json.dumps(data))
        result = load_universe(u)
        assert ("AAPL", "stock") in result
        assert ("SPY", "etf") in result


# ---------------------------------------------------------------------------
# 2. _normalize_info: stock and ETF mappings
# ---------------------------------------------------------------------------

class TestNormalizeInfo:

    def test_stock_fields_mapped(self):
        info = _stock_info()
        record = _normalize_info("AAPL", "stock", info, SNAPSHOT_DATE)
        assert record["ticker"] == "AAPL"
        assert record["asset_class"] == "stock"
        assert record["snapshot_date"] == str(SNAPSHOT_DATE)
        assert record["market_cap"] == pytest.approx(3_000_000_000_000)
        assert record["trailing_pe"] == pytest.approx(28.5)
        assert record["currency"] == "USD"

    def test_etf_fields_mapped(self):
        info = _etf_info()
        record = _normalize_info("SPY", "etf", info, SNAPSHOT_DATE)
        assert record["ticker"] == "SPY"
        assert record["asset_class"] == "etf"
        assert record["expense_ratio"] == pytest.approx(0.0003)
        assert record["total_assets"] == pytest.approx(500_000_000_000)
        assert record["category"] == "Large Blend"

    def test_missing_fields_are_none(self):
        record = _normalize_info("AAPL", "stock", {}, SNAPSHOT_DATE)
        assert record["market_cap"] is None
        assert record["trailing_pe"] is None
        assert record["currency"] is None

    def test_all_output_columns_present(self):
        """Both stock and ETF output columns must be present in every record."""
        stock_record = _normalize_info("AAPL", "stock", _stock_info(), SNAPSHOT_DATE)
        etf_record = _normalize_info("SPY", "etf", _etf_info(), SNAPSHOT_DATE)
        expected_cols = {
            "market_cap", "trailing_pe", "price_to_book", "enterprise_value",
            "ebitda", "free_cashflow", "return_on_equity", "return_on_assets",
            "debt_to_equity", "profit_margins", "operating_margins",
            "expense_ratio", "total_assets", "average_volume", "category", "currency",
        }
        assert expected_cols.issubset(stock_record.keys())
        assert expected_cols.issubset(etf_record.keys())

    def test_nan_float_becomes_none(self):
        import math
        record = _normalize_info("AAPL", "stock", {"marketCap": float("nan")}, SNAPSHOT_DATE)
        assert record["market_cap"] is None


# ---------------------------------------------------------------------------
# 3. fetch_ticker_fundamentals: yfinance mocked
# ---------------------------------------------------------------------------

class TestFetchTickerFundamentals:

    def test_success_returns_record(self):
        with patch("scripts.refresh_fundamentals.yf") as mock_yf:
            mock_yf.Ticker.return_value.info = _stock_info()
            record = fetch_ticker_fundamentals("AAPL", "stock", SNAPSHOT_DATE)
        assert record["ticker"] == "AAPL"
        assert record["market_cap"] == pytest.approx(3_000_000_000_000)

    def test_empty_info_raises_value_error(self):
        with patch("scripts.refresh_fundamentals.yf") as mock_yf:
            mock_yf.Ticker.return_value.info = {}
            with pytest.raises(ValueError, match="empty or minimal info"):
                fetch_ticker_fundamentals("AAPL", "stock", SNAPSHOT_DATE)

    def test_yfinance_exception_propagates(self):
        with patch("scripts.refresh_fundamentals.yf") as mock_yf:
            mock_yf.Ticker.return_value.info = property(
                lambda self: (_ for _ in ()).throw(RuntimeError("network error"))
            )
            mock_yf.Ticker.side_effect = RuntimeError("network error")
            with pytest.raises(RuntimeError, match="network error"):
                fetch_ticker_fundamentals("AAPL", "stock", SNAPSHOT_DATE)


# ---------------------------------------------------------------------------
# 4. write_snapshot: parquet round-trip
# ---------------------------------------------------------------------------

class TestWriteSnapshot:

    def test_writes_parquet_file(self, tmp_path):
        records = [
            {"ticker": "AAPL", "market_cap": 3e12, "snapshot_date": "2026-01-15"},
        ]
        path = tmp_path / "fundamentals_2026-01-15.parquet"
        write_snapshot(records, path)
        assert path.exists()
        df = pd.read_parquet(path)
        assert len(df) == 1
        assert df["ticker"].iloc[0] == "AAPL"

    def test_overwrites_existing_file(self, tmp_path):
        path = tmp_path / "fundamentals_2026-01-15.parquet"
        write_snapshot([{"ticker": "OLD", "snapshot_date": "2026-01-15"}], path)
        write_snapshot([{"ticker": "NEW", "snapshot_date": "2026-01-15"}], path)
        df = pd.read_parquet(path)
        assert df["ticker"].iloc[0] == "NEW"


# ---------------------------------------------------------------------------
# 5. update_latest_pointer: copy on Windows / symlink on POSIX
# ---------------------------------------------------------------------------

class TestUpdateLatestPointer:

    def test_latest_file_is_created(self, tmp_path):
        dated = tmp_path / "fundamentals_2026-01-15.parquet"
        dated.write_bytes(b"fake parquet")
        update_latest_pointer(dated, tmp_path)
        latest = tmp_path / "fundamentals_latest.parquet"
        assert latest.exists()

    def test_replaces_existing_latest(self, tmp_path):
        dated = tmp_path / "fundamentals_2026-01-15.parquet"
        dated.write_bytes(b"v2")
        latest = tmp_path / "fundamentals_latest.parquet"
        latest.write_bytes(b"v1")
        update_latest_pointer(dated, tmp_path)
        assert latest.read_bytes() == b"v2"

    def test_windows_uses_copy(self, tmp_path):
        dated = tmp_path / "fundamentals_2026-01-15.parquet"
        dated.write_bytes(b"data")
        with patch("scripts.refresh_fundamentals.os.name", "nt"):
            strategy = update_latest_pointer(dated, tmp_path)
        assert strategy == "copy"
        latest = tmp_path / "fundamentals_latest.parquet"
        assert latest.exists()

    def test_posix_uses_symlink(self, tmp_path):
        dated = tmp_path / "fundamentals_2026-01-15.parquet"
        dated.write_bytes(b"data")
        with patch("scripts.refresh_fundamentals.os.name", "posix"):
            strategy = update_latest_pointer(dated, tmp_path)
        assert strategy in ("symlink", "copy")


# ---------------------------------------------------------------------------
# 6. prune_old_snapshots: keeps last KEEP_LAST_N, removes older
# ---------------------------------------------------------------------------

class TestPruneOldSnapshots:

    def _make_dated_files(self, tmp_path: Path, dates: list[str]) -> list[Path]:
        files = []
        for d in dates:
            p = tmp_path / f"fundamentals_{d}.parquet"
            p.write_bytes(b"data")
            files.append(p)
        return files

    def test_keeps_last_four(self, tmp_path):
        self._make_dated_files(
            tmp_path,
            ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"],
        )
        pruned = prune_old_snapshots(tmp_path, keep_n=4)
        assert len(pruned) == 1
        assert pruned[0].name == "fundamentals_2026-01-01.parquet"
        remaining = sorted(tmp_path.glob("fundamentals_????-??-??.parquet"))
        assert len(remaining) == 4

    def test_no_pruning_when_within_limit(self, tmp_path):
        self._make_dated_files(tmp_path, ["2026-01-01", "2026-01-08"])
        pruned = prune_old_snapshots(tmp_path, keep_n=4)
        assert pruned == []

    def test_latest_file_not_deleted(self, tmp_path):
        self._make_dated_files(
            tmp_path,
            ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"],
        )
        latest = tmp_path / "fundamentals_latest.parquet"
        latest.write_bytes(b"latest")
        prune_old_snapshots(tmp_path, keep_n=4)
        assert latest.exists()

    def test_price_snapshot_not_deleted(self, tmp_path):
        price_snap = tmp_path / "prices_snapshot.parquet"
        price_snap.write_bytes(b"prices")
        self._make_dated_files(
            tmp_path,
            ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"],
        )
        prune_old_snapshots(tmp_path, keep_n=4)
        assert price_snap.exists()


# ---------------------------------------------------------------------------
# 7. main(): full integration with mocked yfinance
# ---------------------------------------------------------------------------

class TestMain:

    def _make_universe(self, tmp_path: Path, stocks=("AAPL",), etfs=("SPY",)) -> Path:
        return _make_universe_file(tmp_path, stocks=stocks, etfs=etfs)

    def test_success_exit_0(self, tmp_path):
        u = self._make_universe(tmp_path)
        with patch("scripts.refresh_fundamentals.yf") as mock_yf:
            mock_yf.Ticker.return_value.info = _stock_info()
            code = main([
                "--universe", str(u),
                "--snapshots-dir", str(tmp_path / "snaps"),
                "--date", "2026-01-15",
            ])
        assert code == 0

    def test_snapshot_file_written(self, tmp_path):
        u = self._make_universe(tmp_path)
        snaps = tmp_path / "snaps"
        with patch("scripts.refresh_fundamentals.yf") as mock_yf:
            mock_yf.Ticker.return_value.info = _stock_info()
            main([
                "--universe", str(u),
                "--snapshots-dir", str(snaps),
                "--date", "2026-01-15",
            ])
        assert (snaps / "fundamentals_2026-01-15.parquet").exists()
        assert (snaps / "fundamentals_latest.parquet").exists()

    def test_high_failure_rate_exit_1(self, tmp_path):
        u = self._make_universe(tmp_path, stocks=["A", "B", "C", "D", "E", "F", "G", "H", "I", "X"], etfs=[])
        with patch("scripts.refresh_fundamentals.yf") as mock_yf:
            mock_yf.Ticker.side_effect = RuntimeError("down")
            code = main([
                "--universe", str(u),
                "--snapshots-dir", str(tmp_path / "snaps"),
                "--date", "2026-01-15",
            ])
        assert code == 1

    def test_idempotent_same_day_rerun(self, tmp_path):
        u = self._make_universe(tmp_path)
        snaps = tmp_path / "snaps"
        with patch("scripts.refresh_fundamentals.yf") as mock_yf:
            mock_yf.Ticker.return_value.info = _stock_info()
            main(["--universe", str(u), "--snapshots-dir", str(snaps), "--date", "2026-01-15"])
            main(["--universe", str(u), "--snapshots-dir", str(snaps), "--date", "2026-01-15"])
        dated = list(snaps.glob("fundamentals_????-??-??.parquet"))
        assert len(dated) == 1

    def test_partial_failures_still_writes(self, tmp_path):
        """If some tickers fail but failure rate ≤ 10%, succeeded records are written and exit is 0."""
        # 11 tickers: 10 succeed, 1 fails → 9.09% failure rate ≤ 10% threshold
        good = [f"T{i:02d}" for i in range(10)]
        u = self._make_universe(tmp_path, stocks=good + ["FAIL"], etfs=[])
        snaps = tmp_path / "snaps"

        def side_effect(ticker):
            m = MagicMock()
            if ticker == "FAIL":
                m.info = {}  # will trigger ValueError (empty info)
            else:
                m.info = _stock_info()
            return m

        with patch("scripts.refresh_fundamentals.yf") as mock_yf:
            mock_yf.Ticker.side_effect = side_effect
            code = main([
                "--universe", str(u),
                "--snapshots-dir", str(snaps),
                "--date", "2026-01-15",
            ])

        assert code == 0
        df = pd.read_parquet(snaps / "fundamentals_2026-01-15.parquet")
        assert len(df) == 10
        assert "FAIL" not in df["ticker"].values

    def test_missing_universe_file_exit_1(self, tmp_path):
        code = main([
            "--universe", str(tmp_path / "no_such_file.json"),
            "--snapshots-dir", str(tmp_path / "snaps"),
            "--date", "2026-01-15",
        ])
        assert code == 1

    def test_prunes_excess_snapshots(self, tmp_path):
        u = self._make_universe(tmp_path)
        snaps = tmp_path / "snaps"
        snaps.mkdir()
        for d in ["2025-12-01", "2025-12-08", "2025-12-15", "2025-12-22"]:
            (snaps / f"fundamentals_{d}.parquet").write_bytes(b"old")

        with patch("scripts.refresh_fundamentals.yf") as mock_yf:
            mock_yf.Ticker.return_value.info = _stock_info()
            main([
                "--universe", str(u),
                "--snapshots-dir", str(snaps),
                "--date", "2026-01-15",
            ])

        dated = sorted(snaps.glob("fundamentals_????-??-??.parquet"))
        assert len(dated) == KEEP_LAST_N
        names = [p.name for p in dated]
        assert "fundamentals_2026-01-15.parquet" in names
        assert "fundamentals_2025-12-01.parquet" not in names

    def test_no_fastapi_import(self):
        """Script source must not contain any fastapi or app.* imports."""
        import scripts.refresh_fundamentals as mod
        source = Path(mod.__file__).read_text(encoding="utf-8")
        assert "import fastapi" not in source, "Script imports fastapi"
        assert "from fastapi" not in source, "Script imports from fastapi"
        assert "from app" not in source, "Script imports from app.*"
        assert "import app" not in source, "Script imports app.*"
