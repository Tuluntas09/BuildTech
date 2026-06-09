"""
Unit tests for backend/scripts/build_price_snapshot.py

All tests are network-free.  Rather than mocking yfinance directly, tests
inject a mock BaseProvider via main()'s provider= parameter, which is cleaner
and decoupled from yfinance internals.
"""

import json
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock

import pandas as pd
import pytest

from app.data.providers.base import BaseProvider, PriceRow, ProviderError
from app.data.snapshot_prices import SnapshotReader

from scripts.build_price_snapshot import (
    load_universe,
    main,
    print_summary,
    write_snapshot,
    _rows_to_records,
)

START = date(2024, 1, 2)
END = date(2024, 1, 5)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_universe(tmp_path: Path, stocks=("AAPL",), etfs=("SPY",)) -> Path:
    u = tmp_path / "universe.json"
    u.write_text(json.dumps({"stocks": list(stocks), "etfs": list(etfs)}))
    return u


def _make_price_row(ticker: str, price_date: date = START) -> PriceRow:
    from datetime import datetime, timezone
    return PriceRow(
        ticker=ticker,
        date=price_date,
        open=150.0,
        high=155.0,
        low=149.0,
        close=153.0,
        adjusted_close=152.5,
        volume=1_000_000,
        fetched_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )


def _mock_provider(rows_by_ticker: dict[str, list[PriceRow]]) -> BaseProvider:
    """Return a mock BaseProvider whose get_prices() dispatches by ticker."""
    mock = MagicMock(spec=BaseProvider)

    def get_prices(ticker, start, end):
        if ticker in rows_by_ticker:
            val = rows_by_ticker[ticker]
            if isinstance(val, Exception):
                raise val
            return val
        return []

    mock.get_prices.side_effect = get_prices
    return mock


# ---------------------------------------------------------------------------
# 1. load_universe
# ---------------------------------------------------------------------------

class TestLoadUniverse:

    def test_stocks_and_etfs_included(self, tmp_path):
        u = _make_universe(tmp_path, stocks=["AAPL", "MSFT"], etfs=["SPY"])
        result = load_universe(u)
        assert "AAPL" in result
        assert "MSFT" in result
        assert "SPY" in result
        assert len(result) == 3

    def test_underscore_keys_ignored(self, tmp_path):
        data = {"_note": "meta", "_version": "1", "stocks": ["AAPL"], "etfs": []}
        u = tmp_path / "universe.json"
        u.write_text(json.dumps(data))
        assert load_universe(u) == ["AAPL"]

    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_universe(tmp_path / "no_file.json")

    def test_tickers_uppercased(self, tmp_path):
        data = {"stocks": ["aapl"], "etfs": ["spy"]}
        u = tmp_path / "universe.json"
        u.write_text(json.dumps(data))
        result = load_universe(u)
        assert "AAPL" in result
        assert "SPY" in result


# ---------------------------------------------------------------------------
# 2. _rows_to_records: parquet column schema
# ---------------------------------------------------------------------------

class TestRowsToRecords:

    def test_required_columns_present(self):
        row = _make_price_row("AAPL", START)
        records = _rows_to_records([row])
        assert len(records) == 1
        rec = records[0]
        for col in ("ticker", "date", "open", "high", "low", "close", "adjusted_close", "volume"):
            assert col in rec, f"missing column: {col}"

    def test_date_stored_as_iso_string(self):
        row = _make_price_row("AAPL", START)
        records = _rows_to_records([row])
        assert records[0]["date"] == "2024-01-02"

    def test_fetched_at_excluded(self):
        row = _make_price_row("AAPL", START)
        records = _rows_to_records([row])
        assert "fetched_at" not in records[0]


# ---------------------------------------------------------------------------
# 3. write_snapshot
# ---------------------------------------------------------------------------

class TestWriteSnapshot:

    def test_creates_parquet_file(self, tmp_path):
        records = [_rows_to_records([_make_price_row("AAPL", START)])[0]]
        out = tmp_path / "prices_snapshot.parquet"
        write_snapshot(records, out)
        assert out.exists()

    def test_parquet_readable(self, tmp_path):
        records = _rows_to_records([_make_price_row("AAPL", START)])
        out = tmp_path / "prices_snapshot.parquet"
        write_snapshot(records, out)
        df = pd.read_parquet(out)
        assert len(df) == 1
        assert df["ticker"].iloc[0] == "AAPL"

    def test_overwrites_existing(self, tmp_path):
        out = tmp_path / "prices_snapshot.parquet"
        write_snapshot([{"ticker": "OLD", "date": "2024-01-02"}], out)
        write_snapshot([{"ticker": "NEW", "date": "2024-01-02"}], out)
        df = pd.read_parquet(out)
        assert df["ticker"].iloc[0] == "NEW"


# ---------------------------------------------------------------------------
# 4. main(): integration tests with injected provider
# ---------------------------------------------------------------------------

class TestMain:

    def test_success_exit_0(self, tmp_path):
        u = _make_universe(tmp_path)
        out = tmp_path / "snap.parquet"
        provider = _mock_provider({
            "AAPL": [_make_price_row("AAPL", START)],
            "SPY": [_make_price_row("SPY", START)],
        })
        code = main(
            ["--universe", str(u), "--output", str(out),
             "--start", "2024-01-02", "--end", "2024-01-05"],
            provider=provider,
        )
        assert code == 0

    def test_snapshot_file_written_with_required_columns(self, tmp_path):
        u = _make_universe(tmp_path)
        out = tmp_path / "snap.parquet"
        provider = _mock_provider({
            "AAPL": [_make_price_row("AAPL", START)],
            "SPY": [_make_price_row("SPY", START)],
        })
        main(
            ["--universe", str(u), "--output", str(out),
             "--start", "2024-01-02", "--end", "2024-01-05"],
            provider=provider,
        )
        assert out.exists()
        df = pd.read_parquet(out)
        for col in ("ticker", "date", "open", "high", "low", "close", "adjusted_close", "volume"):
            assert col in df.columns, f"missing column: {col}"

    def test_per_ticker_failure_does_not_abort(self, tmp_path):
        u = _make_universe(tmp_path, stocks=["AAPL", "BAD"], etfs=[])
        out = tmp_path / "snap.parquet"
        provider = _mock_provider({
            "AAPL": [_make_price_row("AAPL", START)],
            "BAD": ProviderError("network error"),
        })
        code = main(
            ["--universe", str(u), "--output", str(out),
             "--start", "2024-01-02", "--end", "2024-01-05"],
            provider=provider,
        )
        assert code == 0
        df = pd.read_parquet(out)
        assert "AAPL" in df["ticker"].values
        assert "BAD" not in df["ticker"].values

    def test_zero_successes_exits_nonzero(self, tmp_path):
        u = _make_universe(tmp_path, stocks=["A", "B"], etfs=[])
        out = tmp_path / "snap.parquet"
        provider = _mock_provider({
            "A": ProviderError("down"),
            "B": ProviderError("down"),
        })
        code = main(
            ["--universe", str(u), "--output", str(out),
             "--start", "2024-01-02", "--end", "2024-01-05"],
            provider=provider,
        )
        assert code == 1
        assert not out.exists()

    def test_cli_override_universe(self, tmp_path):
        u = tmp_path / "custom_universe.json"
        u.write_text(json.dumps({"stocks": ["TSLA"], "etfs": []}))
        out = tmp_path / "snap.parquet"
        provider = _mock_provider({"TSLA": [_make_price_row("TSLA", START)]})
        code = main(
            ["--universe", str(u), "--output", str(out),
             "--start", "2024-01-02", "--end", "2024-01-05"],
            provider=provider,
        )
        assert code == 0
        df = pd.read_parquet(out)
        assert df["ticker"].iloc[0] == "TSLA"

    def test_cli_override_output(self, tmp_path):
        u = _make_universe(tmp_path)
        custom_out = tmp_path / "subdir" / "my_snapshot.parquet"
        provider = _mock_provider({
            "AAPL": [_make_price_row("AAPL", START)],
            "SPY": [_make_price_row("SPY", START)],
        })
        main(
            ["--universe", str(u), "--output", str(custom_out),
             "--start", "2024-01-02", "--end", "2024-01-05"],
            provider=provider,
        )
        assert custom_out.exists()

    def test_cli_override_start_end(self, tmp_path):
        u = _make_universe(tmp_path, stocks=["AAPL"], etfs=[])
        out = tmp_path / "snap.parquet"
        provider = _mock_provider({
            "AAPL": [_make_price_row("AAPL", date(2023, 6, 1))],
        })
        code = main(
            ["--universe", str(u), "--output", str(out),
             "--start", "2023-01-01", "--end", "2023-12-31"],
            provider=provider,
        )
        assert code == 0

    def test_snapshot_readable_by_snapshot_reader(self, tmp_path):
        u = _make_universe(tmp_path, stocks=["AAPL"], etfs=[])
        out = tmp_path / "prices_snapshot.parquet"
        provider = _mock_provider({
            "AAPL": [_make_price_row("AAPL", START), _make_price_row("AAPL", date(2024, 1, 3))],
            "SPY": [],
        })
        main(
            ["--universe", str(u), "--output", str(out),
             "--start", "2024-01-02", "--end", "2024-01-05"],
            provider=provider,
        )
        reader = SnapshotReader(out)
        rows = reader.read("AAPL", date(2024, 1, 1), date(2024, 1, 10))
        assert len(rows) == 2
        assert all(r.ticker == "AAPL" for r in rows)
        assert rows[0].date == START
        assert rows[0].close == pytest.approx(153.0)

    def test_missing_universe_file_exits_nonzero(self, tmp_path):
        code = main([
            "--universe", str(tmp_path / "no_such_file.json"),
            "--output", str(tmp_path / "snap.parquet"),
            "--start", "2024-01-02",
            "--end", "2024-01-05",
        ])
        assert code == 1

    def test_no_fundamentals_endpoint_called(self):
        """Script code must not access yfinance fundamentals attributes.

        info/financials/balance_sheet/income_stmt must never appear as attribute
        accesses in the AST.  (logger.info() is exempt — it's a logging call, not
        a data-provider attribute access on a yfinance Ticker object.)
        """
        import ast
        import scripts.build_price_snapshot as mod
        source = Path(mod.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        # 'info' appears as logger.info() — we only forbid it when the receiver
        # is named 'ticker' / 't' / 'yf' (i.e. a yfinance object).
        yf_receiver_names = {"ticker", "t", "yf", "Ticker"}
        forbidden_attrs = {"info", "financials", "balance_sheet", "income_stmt"}
        bad = []
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Attribute) and node.attr in forbidden_attrs):
                continue
            # Check if the receiver looks like a yfinance object
            recv = node.value
            if isinstance(recv, ast.Name) and recv.id in yf_receiver_names:
                bad.append(f"{recv.id}.{node.attr}")
            elif isinstance(recv, ast.Call):
                func = recv.func
                if isinstance(func, ast.Attribute) and func.attr == "Ticker":
                    bad.append(f"yf.Ticker(...).{node.attr}")
                elif isinstance(func, ast.Name) and func.id == "Ticker":
                    bad.append(f"Ticker(...).{node.attr}")
        assert bad == [], f"Script accesses yfinance fundamentals in code: {bad}"

    def test_no_fastapi_import(self):
        """Script source must not contain any fastapi or non-provider app.* imports."""
        import scripts.build_price_snapshot as mod
        source = Path(mod.__file__).read_text(encoding="utf-8")
        assert "import fastapi" not in source, "Script imports fastapi"
        assert "from fastapi" not in source, "Script imports from fastapi"
        # Price provider imports are allowed; FastAPI app imports are not
        assert "from app.api" not in source
        assert "from app.db" not in source
        assert "from app.models" not in source
        assert "from app.core" not in source

    def test_no_second_provider(self, tmp_path):
        """Only YFinanceProvider is used — no additional price provider classes."""
        from app.data.providers.base import BaseProvider
        subclasses = BaseProvider.__subclasses__()
        names = [cls.__name__ for cls in subclasses]
        assert len(names) == 1
        assert names[0] == "YFinanceProvider"
