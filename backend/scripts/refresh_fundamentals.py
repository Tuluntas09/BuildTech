#!/usr/bin/env python3
"""
refresh_fundamentals.py — weekly fundamentals snapshot script for BuildTech.

Run from the backend/ directory:
  python scripts/refresh_fundamentals.py

Options:
  --universe PATH       Path to universe JSON (default: data/universe.json)
  --snapshots-dir PATH  Output directory        (default: snapshots/)
  --date YYYY-MM-DD     Snapshot date           (default: today)

Exit codes:
  0  success  (failure rate ≤ 10%)
  1  high failure rate (> 10%), or fatal initialisation error

Fundamentals are fetched via yfinance (.info).  This script is STANDALONE
and must never be called by the FastAPI app at runtime.  The app reads the
written parquet snapshot only; it never calls yfinance for fundamentals.

yfinance .info → our column mapping
────────────────────────────────────────────────────────────────────────────
STOCKS
  marketCap          → market_cap
  trailingPE         → trailing_pe
  priceToBook        → price_to_book
  enterpriseValue    → enterprise_value
  ebitda             → ebitda
  freeCashflow       → free_cashflow
  returnOnEquity     → return_on_equity
  returnOnAssets     → return_on_assets
  debtToEquity       → debt_to_equity
  profitMargins      → profit_margins
  operatingMargins   → operating_margins
  averageVolume      → average_volume
  currency           → currency

ETFs
  expenseRatio       → expense_ratio
  totalAssets        → total_assets
  averageVolume      → average_volume
  category           → category
  currency           → currency
────────────────────────────────────────────────────────────────────────────
All fields are optional per ticker; missing values are stored as null.
"""

import argparse
import json
import logging
import os
import shutil
import sys
from datetime import date
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import yfinance as yf

# ---------------------------------------------------------------------------
# Defaults (override via CLI arguments)
# ---------------------------------------------------------------------------

_SCRIPT_DIR = Path(__file__).parent
_BACKEND_DIR = _SCRIPT_DIR.parent
DEFAULT_UNIVERSE_PATH: Path = _BACKEND_DIR / "data" / "universe.json"
DEFAULT_SNAPSHOTS_DIR: Path = _BACKEND_DIR / "snapshots"
MAX_FAILURE_RATE: float = 0.10
KEEP_LAST_N: int = 4

# ---------------------------------------------------------------------------
# yfinance .info field mappings
# ---------------------------------------------------------------------------

_STOCK_FIELD_MAP: dict[str, str] = {
    "marketCap": "market_cap",
    "trailingPE": "trailing_pe",
    "priceToBook": "price_to_book",
    "enterpriseValue": "enterprise_value",
    "ebitda": "ebitda",
    "freeCashflow": "free_cashflow",
    "returnOnEquity": "return_on_equity",
    "returnOnAssets": "return_on_assets",
    "debtToEquity": "debt_to_equity",
    "profitMargins": "profit_margins",
    "operatingMargins": "operating_margins",
    "averageVolume": "average_volume",
    "currency": "currency",
}

_ETF_FIELD_MAP: dict[str, str] = {
    "expenseRatio": "expense_ratio",
    "totalAssets": "total_assets",
    "averageVolume": "average_volume",
    "category": "category",
    "currency": "currency",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("buildtech.fundamentals")


# ---------------------------------------------------------------------------
# Universe loading
# ---------------------------------------------------------------------------

def load_universe(path: Path) -> list[tuple[str, str]]:
    """Return [(ticker, asset_class), ...] from a JSON universe file.

    Keys that start with '_' are treated as metadata comments and ignored.
    """
    with path.open(encoding="utf-8") as fh:
        data: dict[str, Any] = json.load(fh)

    tickers: list[tuple[str, str]] = []
    for ticker in data.get("stocks", []):
        if isinstance(ticker, str) and not ticker.startswith("_"):
            tickers.append((ticker.upper(), "stock"))
    for ticker in data.get("etfs", []):
        if isinstance(ticker, str) and not ticker.startswith("_"):
            tickers.append((ticker.upper(), "etf"))
    return tickers


# ---------------------------------------------------------------------------
# Fundamentals fetching and normalisation
# ---------------------------------------------------------------------------

def _to_float(val: Any) -> Optional[float]:
    try:
        if val is None:
            return None
        f = float(val)
        return None if (f != f) else f  # NaN check
    except (TypeError, ValueError):
        return None


def _to_int(val: Any) -> Optional[int]:
    f = _to_float(val)
    return None if f is None else int(f)


def _to_str(val: Any) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _normalize_info(
    ticker: str,
    asset_class: str,
    info: dict[str, Any],
    snapshot_date: date,
) -> dict[str, Any]:
    """Map a yfinance .info dict to our normalized schema.

    Numeric fields use _to_float; string fields use _to_str.
    All fields are optional — missing → None.
    """
    record: dict[str, Any] = {
        "ticker": ticker,
        "asset_class": asset_class,
        "snapshot_date": str(snapshot_date),
    }

    field_map = _STOCK_FIELD_MAP if asset_class == "stock" else _ETF_FIELD_MAP

    for yf_key, our_key in field_map.items():
        raw = info.get(yf_key)
        if our_key == "currency" or our_key == "category":
            record[our_key] = _to_str(raw)
        else:
            record[our_key] = _to_float(raw)

    # Ensure all expected columns exist (even if absent from this asset class)
    all_output_cols = set(_STOCK_FIELD_MAP.values()) | set(_ETF_FIELD_MAP.values())
    for col in all_output_cols:
        if col not in record:
            record[col] = None

    return record


def fetch_ticker_fundamentals(
    ticker: str,
    asset_class: str,
    snapshot_date: date,
) -> dict[str, Any]:
    """Fetch and normalise fundamentals for one ticker.

    Raises any exception from yfinance — the caller handles per-ticker errors.
    """
    info: dict[str, Any] = yf.Ticker(ticker).info
    if not isinstance(info, dict) or len(info) < 2:
        raise ValueError(f"empty or minimal info returned for {ticker!r}")
    return _normalize_info(ticker, asset_class, info, snapshot_date)


# ---------------------------------------------------------------------------
# Snapshot I/O
# ---------------------------------------------------------------------------

def write_snapshot(records: list[dict[str, Any]], dated_path: Path) -> None:
    """Write *records* to a parquet file at *dated_path*, overwriting if present."""
    dated_path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(records)
    df.to_parquet(dated_path, index=False)


def update_latest_pointer(dated_path: Path, snapshots_dir: Path) -> str:
    """Create (or refresh) fundamentals_latest.parquet pointing to *dated_path*.

    On Windows, symlinks require admin privileges or Developer Mode, so we
    default to a file copy.  On POSIX we try symlink first, then copy.

    Returns 'symlink' or 'copy' to indicate which strategy was used.
    """
    latest = snapshots_dir / "fundamentals_latest.parquet"
    if latest.exists() or latest.is_symlink():
        latest.unlink()

    if os.name == "nt":
        shutil.copy2(dated_path, latest)
        return "copy"

    try:
        latest.symlink_to(dated_path.name)
        return "symlink"
    except OSError:
        shutil.copy2(dated_path, latest)
        return "copy"


def prune_old_snapshots(snapshots_dir: Path, keep_n: int = KEEP_LAST_N) -> list[Path]:
    """Delete dated fundamentals snapshots beyond the last *keep_n*.

    Only touches files matching fundamentals_YYYY-MM-DD.parquet.
    Never deletes fundamentals_latest.parquet or price snapshot files.

    Returns the list of deleted paths.
    """
    dated = sorted(
        p for p in snapshots_dir.glob("fundamentals_????-??-??.parquet")
        if p.is_file()
    )
    to_delete = dated[:-keep_n] if len(dated) > keep_n else []
    for p in to_delete:
        p.unlink(missing_ok=True)
    return to_delete


# ---------------------------------------------------------------------------
# Summary report
# ---------------------------------------------------------------------------

def print_summary(
    *,
    total: int,
    successes: int,
    failures: list[tuple[str, str]],
    snapshot_date: date,
    dated_path: Path,
    latest_strategy: str,
    pruned: list[Path],
) -> None:
    failure_count = len(failures)
    failure_rate = failure_count / total if total > 0 else 0.0
    separator = "─" * 60

    print(separator)
    print("  BuildTech — Fundamentals Snapshot Summary")
    print(separator)
    print(f"  Snapshot date   : {snapshot_date}")
    print(f"  Output file     : {dated_path}")
    print(f"  Latest pointer  : {dated_path.parent / 'fundamentals_latest.parquet'} ({latest_strategy})")
    print(f"  Total tickers   : {total}")
    print(f"  Succeeded       : {successes}")
    print(f"  Failed          : {failure_count}  ({failure_rate:.1%})")
    if failure_rate > MAX_FAILURE_RATE:
        print(f"  ⚠  Failure rate {failure_rate:.1%} exceeds {MAX_FAILURE_RATE:.0%} threshold")
    if pruned:
        print(f"  Pruned snapshots: {[p.name for p in pruned]}")
    if failures:
        print("  Failed tickers:")
        for ticker, reason in failures:
            print(f"    ✗ {ticker:12s}  {reason}")
    print(separator)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    """Run the fundamentals snapshot.  Returns 0 on success, 1 on high failure rate."""
    parser = argparse.ArgumentParser(
        description="BuildTech weekly fundamentals snapshot script.",
        epilog="Exit 0 when failure rate ≤ 10%, exit 1 otherwise.",
    )
    parser.add_argument(
        "--universe",
        type=Path,
        default=DEFAULT_UNIVERSE_PATH,
        help=f"Path to universe JSON (default: {DEFAULT_UNIVERSE_PATH})",
    )
    parser.add_argument(
        "--snapshots-dir",
        type=Path,
        default=DEFAULT_SNAPSHOTS_DIR,
        dest="snapshots_dir",
        help=f"Output directory for snapshots (default: {DEFAULT_SNAPSHOTS_DIR})",
    )
    parser.add_argument(
        "--date",
        type=date.fromisoformat,
        default=date.today(),
        dest="snapshot_date",
        help="Snapshot date YYYY-MM-DD (default: today)",
    )

    args = parser.parse_args(argv)

    # Load universe
    try:
        universe = load_universe(args.universe)
    except (FileNotFoundError, json.JSONDecodeError, KeyError) as exc:
        logger.error("Failed to load universe from %s: %s", args.universe, exc)
        return 1

    if not universe:
        logger.error("Universe is empty — aborting.")
        return 1

    total = len(universe)
    snapshot_date: date = args.snapshot_date
    snapshots_dir: Path = args.snapshots_dir
    snapshots_dir.mkdir(parents=True, exist_ok=True)

    dated_path = snapshots_dir / f"fundamentals_{snapshot_date}.parquet"
    logger.info("Starting snapshot for %d tickers → %s", total, dated_path.name)

    records: list[dict[str, Any]] = []
    failures: list[tuple[str, str]] = []

    for ticker, asset_class in universe:
        try:
            record = fetch_ticker_fundamentals(ticker, asset_class, snapshot_date)
            records.append(record)
            logger.debug("✓ %s", ticker)
        except Exception as exc:
            msg = str(exc)
            failures.append((ticker, msg))
            logger.warning("✗ %s: %s", ticker, msg)

    successes = len(records)
    failure_count = len(failures)
    failure_rate = failure_count / total if total > 0 else 0.0

    # Write snapshot even on partial failure so we preserve whatever succeeded
    if records:
        write_snapshot(records, dated_path)
        logger.info("Wrote %d records to %s", successes, dated_path.name)
    else:
        logger.warning("No records written — all tickers failed")

    # Update latest pointer
    latest_strategy = "none"
    if records:
        latest_strategy = update_latest_pointer(dated_path, snapshots_dir)

    # Prune old snapshots (keeps last KEEP_LAST_N dated files)
    pruned = prune_old_snapshots(snapshots_dir, keep_n=KEEP_LAST_N)
    if pruned:
        logger.info("Pruned %d old snapshot(s)", len(pruned))

    print_summary(
        total=total,
        successes=successes,
        failures=failures,
        snapshot_date=snapshot_date,
        dated_path=dated_path,
        latest_strategy=latest_strategy,
        pruned=pruned,
    )

    return 0 if failure_rate <= MAX_FAILURE_RATE else 1


if __name__ == "__main__":
    sys.exit(main())
