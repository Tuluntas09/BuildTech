"""
FundamentalsReader — reads normalized fundamentals from a parquet snapshot.

The snapshot is written by scripts/refresh_fundamentals.py.
This module only reads; it never fetches live data.

Expected parquet columns (subset used by scoring):
  ticker, asset_class, snapshot_date,
  market_cap, trailing_pe, price_to_book, enterprise_value,
  ebitda, free_cashflow, return_on_equity, return_on_assets,
  debt_to_equity, profit_margins, operating_margins, average_volume,
  expense_ratio, total_assets, category, currency
"""

from pathlib import Path
from typing import Any, Optional

import pandas as pd


class FundamentalsReader:
    """Reads all fundamentals records from a snapshot parquet file.

    Returns empty list (not an error) when the snapshot file does not exist.
    """

    def __init__(self, path: Path) -> None:
        self._path = path

    def read_all(self) -> list[dict[str, Any]]:
        """Return all records as a list of plain dicts."""
        if not self._path.exists():
            return []
        try:
            import math
            df = pd.read_parquet(self._path)
            raw = df.to_dict(orient="records")
            # Replace NaN with None so scoring code can use simple `is None` checks
            return [
                {
                    k: (None if isinstance(v, float) and math.isnan(v) else v)
                    for k, v in row.items()
                }
                for row in raw
            ]
        except Exception:
            return []

    def get_snapshot_date(self) -> Optional[str]:
        """Return the snapshot_date string from the first record, or None."""
        records = self.read_all()
        for r in records:
            val = r.get("snapshot_date")
            if val is not None:
                return str(val)
        return None
