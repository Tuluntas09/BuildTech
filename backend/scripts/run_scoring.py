#!/usr/bin/env python3
"""
run_scoring.py — populate asset_score_cache from local snapshots.

Run from the backend/ directory AFTER refresh_fundamentals.py and
build_price_snapshot.py have both completed successfully:

  python scripts/run_scoring.py

Prerequisites:
  snapshots/fundamentals_latest.parquet   (written by refresh_fundamentals.py)
  snapshots/prices_snapshot.parquet       (written by build_price_snapshot.py)

Exit codes:
  0  at least one asset scored
  1  no snapshots found, or all scoring failed
"""

import logging
import sys
from datetime import date, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Sys-path bootstrap: allow running as `python scripts/run_scoring.py`
# from the backend/ directory without installing the package.
# ---------------------------------------------------------------------------
_SCRIPT_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPT_DIR.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.core.scoring.service import ScoringService          # noqa: E402
from app.data.snapshot_fundamentals import FundamentalsReader  # noqa: E402
from app.data.snapshot_prices import SnapshotReader           # noqa: E402
from app.db.session import SessionLocal                        # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("buildtech.run_scoring")

FUNDAMENTALS_PATH = _BACKEND_DIR / "snapshots" / "fundamentals_latest.parquet"
PRICES_PATH       = _BACKEND_DIR / "snapshots" / "prices_snapshot.parquet"
PRICE_LOOKBACK    = 600  # calendar days — matches builder.py constant


def main() -> int:
    # ------------------------------------------------------------------
    # 1. Load fundamentals
    # ------------------------------------------------------------------
    if not FUNDAMENTALS_PATH.exists():
        logger.error("fundamentals_latest.parquet not found at %s", FUNDAMENTALS_PATH)
        logger.error("Run: python scripts/refresh_fundamentals.py")
        return 1

    reader = FundamentalsReader(FUNDAMENTALS_PATH)
    fundamentals = reader.read_all()
    if not fundamentals:
        logger.error("Fundamentals snapshot is empty — re-run refresh_fundamentals.py")
        return 1

    snapshot_date = reader.get_snapshot_date()
    logger.info("Loaded %d fundamentals records (snapshot: %s)", len(fundamentals), snapshot_date)

    # ------------------------------------------------------------------
    # 2. Load prices
    # ------------------------------------------------------------------
    if not PRICES_PATH.exists():
        logger.warning(
            "prices_snapshot.parquet not found — scoring will proceed without price data. "
            "Run build_price_snapshot.py for full scores."
        )
        prices_by_ticker: dict = {}
    else:
        snap = SnapshotReader(PRICES_PATH)
        end_date   = date.today()
        start_date = end_date - timedelta(days=PRICE_LOOKBACK)
        tickers = list({r["ticker"] for r in fundamentals if r.get("ticker")})
        prices_by_ticker = {}
        for ticker in tickers:
            rows = snap.read(ticker, start_date, end_date)
            if rows:
                prices_by_ticker[ticker] = rows
        logger.info(
            "Loaded prices for %d/%d tickers from snapshot", len(prices_by_ticker), len(tickers)
        )

    # ------------------------------------------------------------------
    # 3. Run scoring
    # ------------------------------------------------------------------
    service = ScoringService()
    db = SessionLocal()
    try:
        results = service.score_universe(
            fundamentals=fundamentals,
            prices_by_ticker=prices_by_ticker,
            db=db,
        )
        db.commit()
    except Exception as exc:
        logger.error("Scoring failed: %s", exc)
        db.rollback()
        return 1
    finally:
        db.close()

    # ------------------------------------------------------------------
    # 4. Summary
    # ------------------------------------------------------------------
    scored   = [r for r in results if r.score_value is not None]
    missing  = [r for r in results if r.has_missing_factors]
    sep = "─" * 60
    print(sep)
    print("  BuildTech — Scoring Summary")
    print(sep)
    print(f"  Fundamentals snapshot : {snapshot_date}")
    print(f"  Total assets processed: {len(results)}")
    print(f"  Scored (score_value)  : {len(scored)}")
    print(f"  Partial (missing data): {len(missing)}")
    print(f"  Unscored (None)       : {len(results) - len(scored)}")
    print(sep)
    for r in sorted(results, key=lambda x: (x.score_value or 0), reverse=True)[:10]:
        print(f"  {r.ticker:<8}  {f'{r.score_value:.1f}' if r.score_value is not None else 'N/A':>6}  {'[partial]' if r.has_missing_factors else ''}")
    if len(results) > 10:
        print(f"  … {len(results) - 10} more")
    print(sep)

    return 0 if scored else 1


if __name__ == "__main__":
    sys.exit(main())
