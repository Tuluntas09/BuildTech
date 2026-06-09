#!/usr/bin/env python3
"""
build_price_snapshot.py — frozen OHLCV price snapshot generator for BuildTech.

Run from the backend/ directory:
  python scripts/build_price_snapshot.py

Options:
  --universe PATH     Path to universe JSON   (default: data/universe.json)
  --output PATH       Output parquet file     (default: snapshots/prices_snapshot.parquet)
  --start YYYY-MM-DD  History start date      (default: 1 year ago)
  --end   YYYY-MM-DD  History end date        (default: today)

Exit codes:
  0  at least one ticker succeeded
  1  all tickers failed, or fatal initialisation error

Purpose
-------
Writes a frozen parquet file read by the Tier-3 fallback of the DataResolver:

  live yfinance → SQLite cache (24h) → frozen parquet snapshot  ← this file

The snapshot is read by `app/data/snapshot_prices.py::SnapshotReader`.
Parquet column schema must match what SnapshotReader expects:

  ticker          : str
  date            : str (ISO "YYYY-MM-DD")
  open            : float | None
  high            : float | None
  low             : float | None
  close           : float | None
  adjusted_close  : float | None
  volume          : int | None

This script is STANDALONE and must never be called by the FastAPI app at runtime.

Price data is fetched through the existing YFinanceProvider — prices only.
This script must NOT call Ticker.info, financials, or any fundamentals endpoint.
"""

import argparse
import json
import logging
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

# ---------------------------------------------------------------------------
# Sys-path bootstrap: allow `python scripts/build_price_snapshot.py` from
# the backend/ directory without installing the package.
# ---------------------------------------------------------------------------
_SCRIPT_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPT_DIR.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.data.providers.base import BaseProvider, PriceRow, ProviderError  # noqa: E402
from app.data.providers.yfinance_provider import YFinanceProvider  # noqa: E402

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_UNIVERSE_PATH: Path = _BACKEND_DIR / "data" / "universe.json"
DEFAULT_OUTPUT_PATH: Path = _BACKEND_DIR / "snapshots" / "prices_snapshot.parquet"
DEFAULT_LOOKBACK_DAYS: int = 365

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("buildtech.price_snapshot")


# ---------------------------------------------------------------------------
# Universe loading
# ---------------------------------------------------------------------------

def load_universe(path: Path) -> list[str]:
    """Return a flat list of ticker strings from the universe JSON file.

    Keys starting with '_' are metadata and are ignored.
    Both stocks and ETFs are included — all need historical prices.
    """
    with path.open(encoding="utf-8") as fh:
        data: dict = json.load(fh)

    tickers: list[str] = []
    for ticker in data.get("stocks", []):
        if isinstance(ticker, str) and not ticker.startswith("_"):
            tickers.append(ticker.upper())
    for ticker in data.get("etfs", []):
        if isinstance(ticker, str) and not ticker.startswith("_"):
            tickers.append(ticker.upper())
    return tickers


# ---------------------------------------------------------------------------
# Row serialisation
# ---------------------------------------------------------------------------

def _rows_to_records(rows: list[PriceRow]) -> list[dict]:
    """Convert PriceRow dataclasses to plain dicts for the parquet schema.

    date is stored as an ISO string ("YYYY-MM-DD") — SnapshotReader's
    _coerce_date() handles string, date, datetime, and Timestamp inputs.
    fetched_at is intentionally excluded: SnapshotReader generates it fresh.
    """
    return [
        {
            "ticker": r.ticker,
            "date": str(r.date),
            "open": r.open,
            "high": r.high,
            "low": r.low,
            "close": r.close,
            "adjusted_close": r.adjusted_close,
            "volume": r.volume,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Snapshot I/O
# ---------------------------------------------------------------------------

def write_snapshot(records: list[dict], output_path: Path) -> None:
    """Write *records* to a parquet file, overwriting any existing file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(records)
    df.to_parquet(output_path, index=False)


# ---------------------------------------------------------------------------
# Summary report
# ---------------------------------------------------------------------------

def print_summary(
    *,
    total: int,
    successes: int,
    failures: list[tuple[str, str]],
    start: date,
    end: date,
    output_path: Path,
    row_count: int,
) -> None:
    failure_count = len(failures)
    failure_rate = failure_count / total if total > 0 else 0.0
    sep = "─" * 60

    print(sep)
    print("  BuildTech — Price Snapshot Summary")
    print(sep)
    print(f"  Date range      : {start} → {end}")
    print(f"  Output file     : {output_path}")
    print(f"  Total rows      : {row_count}")
    print(f"  Total tickers   : {total}")
    print(f"  Succeeded       : {successes}")
    print(f"  Failed          : {failure_count}  ({failure_rate:.1%})")
    if failure_count > 0:
        print("  Failed tickers:")
        for ticker, reason in failures:
            print(f"    ✗ {ticker:12s}  {reason}")
    if successes == 0:
        print("  ✗ No data written — all tickers failed")
    print(sep)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main(
    argv: Optional[list[str]] = None,
    provider: Optional[BaseProvider] = None,
) -> int:
    """Run the price snapshot generator.

    *provider* is injectable for tests.  When None, a YFinanceProvider is used.

    Returns 0 if at least one ticker succeeded, 1 if all failed or a fatal
    initialisation error occurred.
    """
    today = date.today()

    parser = argparse.ArgumentParser(
        description="BuildTech frozen price snapshot generator.",
        epilog="Exit 0 when at least one ticker succeeds, exit 1 otherwise.",
    )
    parser.add_argument(
        "--universe",
        type=Path,
        default=DEFAULT_UNIVERSE_PATH,
        help=f"Path to universe JSON (default: {DEFAULT_UNIVERSE_PATH})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help=f"Output parquet path (default: {DEFAULT_OUTPUT_PATH})",
    )
    parser.add_argument(
        "--start",
        type=date.fromisoformat,
        default=today - timedelta(days=DEFAULT_LOOKBACK_DAYS),
        dest="start",
        help=f"History start date YYYY-MM-DD (default: {DEFAULT_LOOKBACK_DAYS} days ago)",
    )
    parser.add_argument(
        "--end",
        type=date.fromisoformat,
        default=today,
        dest="end",
        help="History end date YYYY-MM-DD (default: today)",
    )

    args = parser.parse_args(argv)

    # Load universe
    try:
        tickers = load_universe(args.universe)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        logger.error("Failed to load universe from %s: %s", args.universe, exc)
        return 1

    if not tickers:
        logger.error("Universe is empty — aborting.")
        return 1

    if provider is None:
        provider = YFinanceProvider()

    total = len(tickers)
    start: date = args.start
    end: date = args.end
    output_path: Path = args.output

    logger.info(
        "Starting price snapshot: %d tickers, %s → %s", total, start, end
    )

    all_records: list[dict] = []
    failures: list[tuple[str, str]] = []

    for ticker in tickers:
        try:
            rows = provider.get_prices(ticker, start, end)
            if not rows:
                logger.warning("✗ %s: no data returned for range %s → %s", ticker, start, end)
                failures.append((ticker, f"no data for range {start} → {end}"))
                continue
            all_records.extend(_rows_to_records(rows))
            logger.debug("✓ %s: %d rows", ticker, len(rows))
        except (ProviderError, Exception) as exc:
            msg = str(exc)
            failures.append((ticker, msg))
            logger.warning("✗ %s: %s", ticker, msg)

    successes = total - len(failures)

    if all_records:
        write_snapshot(all_records, output_path)
        logger.info("Wrote %d rows → %s", len(all_records), output_path)
    else:
        logger.error("No price data written — all tickers failed.")

    print_summary(
        total=total,
        successes=successes,
        failures=failures,
        start=start,
        end=end,
        output_path=output_path,
        row_count=len(all_records),
    )

    return 0 if successes > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
