"""
ScoringService — orchestrates fundamentals + price data into score cache writes.

Usage (from CLI or future API layer):

    from pathlib import Path
    from app.core.scoring.service import ScoringService
    from app.data.snapshot_fundamentals import FundamentalsReader

    reader = FundamentalsReader(Path("snapshots/fundamentals_latest.parquet"))
    service = ScoringService()
    results = service.score_universe(
        fundamentals=reader.read_all(),
        prices_by_ticker=...,   # dict[str, list[PriceRow]]
        db=db_session,
    )

No live yfinance calls are made here.  All data is supplied by the caller.
"""

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.core.scoring.base import ScoreCacheWriter, ScoreResult
from app.core.scoring.etfs import EtfScorer
from app.core.scoring.stocks import StockScorer
from app.data.providers.base import PriceRow

logger = logging.getLogger("buildtech.scoring")


class ScoringService:
    """Orchestrates stock and ETF scoring and writes results to asset_score_cache."""

    def __init__(self) -> None:
        self._stock_scorer = StockScorer()
        self._etf_scorer = EtfScorer()
        self._writer = ScoreCacheWriter()

    def score_universe(
        self,
        fundamentals: list[dict[str, Any]],
        prices_by_ticker: dict[str, list[PriceRow]],
        db: Session,
    ) -> list[ScoreResult]:
        """Score all assets and write results to asset_score_cache.

        Args:
            fundamentals: records from FundamentalsReader.read_all().
            prices_by_ticker: ticker → list[PriceRow] from price resolver/snapshot.
            db: SQLAlchemy session for cache writes.

        Returns:
            All ScoreResult objects (stocks + ETFs combined).
        """
        stock_records = [r for r in fundamentals if r.get("asset_class") == "stock"]
        etf_records = [r for r in fundamentals if r.get("asset_class") == "etf"]

        logger.info(
            "Scoring %d stocks and %d ETFs", len(stock_records), len(etf_records)
        )

        stock_results = self._stock_scorer.score_batch(stock_records, prices_by_ticker)
        etf_results = self._etf_scorer.score_batch(etf_records, prices_by_ticker)

        all_results = stock_results + etf_results

        self._writer.write_batch(db, all_results)

        scored = sum(1 for r in all_results if r.score_value is not None)
        missing = sum(1 for r in all_results if r.has_missing_factors)
        logger.info(
            "Scored %d/%d assets; %d have missing factors",
            scored, len(all_results), missing,
        )

        return all_results
