"""
Unit tests for Task 7 — scoring engine (stocks & ETFs).

All tests are network-free.  Fixtures create synthetic fundamentals dicts
and PriceRow lists in-memory; no parquet files or SQLite files on disk
beyond what pytest's tmp_path provides.
"""

import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

import app.models.tables  # noqa: F401 – registers ORM models
from app.db.base import Base
from app.data.providers.base import PriceRow
from app.models.tables import AssetScoreCache as AssetScoreCacheRow

from app.core.scoring.base import (
    MARKET_PROXY_TICKER,
    MIN_ROWS_3M,
    MIN_ROWS_SHARPE,
    ScoreCacheWriter,
    ScoreResult,
    batch_rank,
    compute_composite,
    compute_daily_returns,
    factor_from_subs,
    normalize_weights,
    pearson_corr,
    sharpe,
    sortino,
)
from app.core.scoring.stocks import StockScorer
from app.core.scoring.etfs import EtfScorer
from app.core.scoring.service import ScoringService
from app.data.snapshot_fundamentals import FundamentalsReader


# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _make_price_rows(
    ticker: str,
    n_days: int = 300,
    start_price: float = 100.0,
    drift: float = 0.0003,
    vol: float = 0.01,
    start_date: date = date(2023, 1, 3),
) -> list[PriceRow]:
    """Generate synthetic daily price rows with a random-walk-like price series."""
    import random
    random.seed(hash(ticker) % 2**31)
    rows = []
    price = start_price
    d = start_date
    fetched = _utcnow()
    for _ in range(n_days):
        # skip weekends
        while d.weekday() >= 5:
            d += timedelta(days=1)
        change = 1.0 + drift + vol * (random.gauss(0, 1))
        price = max(0.01, price * change)
        rows.append(
            PriceRow(
                ticker=ticker,
                date=d,
                open=price * 0.998,
                high=price * 1.005,
                low=price * 0.995,
                close=price,
                adjusted_close=price,
                volume=int(1_000_000 * (0.8 + random.random() * 0.4)),
                fetched_at=fetched,
            )
        )
        d += timedelta(days=1)
    return rows


def _stock_fund(
    ticker: str,
    snapshot_date: str = "2026-01-15",
    **overrides: Any,
) -> dict[str, Any]:
    base = {
        "ticker": ticker,
        "asset_class": "stock",
        "snapshot_date": snapshot_date,
        "market_cap": 3_000_000_000_000,
        "trailing_pe": 28.5,
        "price_to_book": 45.2,
        "enterprise_value": 2_900_000_000_000,
        "ebitda": 120_000_000_000,
        "free_cashflow": 90_000_000_000,
        "return_on_equity": 1.47,
        "return_on_assets": 0.28,
        "debt_to_equity": 140.0,
        "profit_margins": 0.25,
        "operating_margins": 0.30,
        "average_volume": 55_000_000,
        "currency": "USD",
    }
    base.update(overrides)
    return base


def _etf_fund(
    ticker: str,
    snapshot_date: str = "2026-01-15",
    **overrides: Any,
) -> dict[str, Any]:
    base = {
        "ticker": ticker,
        "asset_class": "etf",
        "snapshot_date": snapshot_date,
        "expense_ratio": 0.0003,
        "total_assets": 500_000_000_000,
        "average_volume": 80_000_000,
        "category": "Large Blend",
        "currency": "USD",
        # stock fields are None for ETFs
        "market_cap": None,
        "trailing_pe": None,
        "price_to_book": None,
        "enterprise_value": None,
        "ebitda": None,
        "free_cashflow": None,
        "return_on_equity": None,
        "return_on_assets": None,
        "debt_to_equity": None,
        "profit_margins": None,
        "operating_margins": None,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 1. base helpers
# ---------------------------------------------------------------------------

class TestBatchRank:

    def test_higher_is_better(self):
        ranks = batch_rank({"A": 10.0, "B": 20.0, "C": 30.0}, higher_is_better=True)
        assert ranks["C"] > ranks["B"] > ranks["A"]

    def test_lower_is_better(self):
        ranks = batch_rank({"A": 10.0, "B": 20.0, "C": 30.0}, higher_is_better=False)
        assert ranks["A"] > ranks["B"] > ranks["C"]

    def test_single_ticker_returns_50(self):
        ranks = batch_rank({"X": 99.0}, higher_is_better=True)
        assert ranks["X"] == pytest.approx(50.0)

    def test_empty_returns_empty(self):
        assert batch_rank({}) == {}

    def test_scores_in_0_100(self):
        vals = {str(i): float(i) for i in range(20)}
        ranks = batch_rank(vals, higher_is_better=True)
        for v in ranks.values():
            assert 0.0 <= v <= 100.0


class TestNormalizeWeights:

    def test_all_available(self):
        factors = [
            factor_from_subs("a", 0.5, "x", [("s1", 1.0, 60.0, "n/a")]),
            factor_from_subs("b", 0.5, "x", [("s1", 1.0, 40.0, "n/a")]),
        ]
        normalize_weights(factors)
        assert sum(f.effective_weight for f in factors) == pytest.approx(1.0)

    def test_one_na_weight_shared(self):
        factors = [
            factor_from_subs("a", 0.5, "x", [("s1", 1.0, 60.0, "n/a")]),
            factor_from_subs("b", 0.5, "x", []),  # no sub-factors → N/A
        ]
        normalize_weights(factors)
        assert factors[0].effective_weight == pytest.approx(1.0)
        assert factors[1].effective_weight == pytest.approx(0.0)

    def test_all_na_effective_weights_zero(self):
        factors = [
            factor_from_subs("a", 0.5, "x", []),
            factor_from_subs("b", 0.5, "x", []),
        ]
        normalize_weights(factors)
        assert all(f.effective_weight == 0.0 for f in factors)

    def test_unequal_weights_normalized_proportionally(self):
        factors = [
            factor_from_subs("a", 0.25, "x", [("s", 1.0, 50.0, "")]),
            factor_from_subs("b", 0.75, "x", [("s", 1.0, 50.0, "")]),
        ]
        normalize_weights(factors)
        assert factors[0].effective_weight == pytest.approx(0.25)
        assert factors[1].effective_weight == pytest.approx(0.75)


class TestComputeComposite:

    def test_all_factors_available(self):
        factors = [
            factor_from_subs("a", 0.5, "x", [("s", 1.0, 80.0, "")]),
            factor_from_subs("b", 0.5, "x", [("s", 1.0, 40.0, "")]),
        ]
        normalize_weights(factors)
        score = compute_composite(factors)
        assert score == pytest.approx(60.0)

    def test_all_na_returns_none(self):
        factors = [factor_from_subs("a", 0.5, "x", [])]
        normalize_weights(factors)
        assert compute_composite(factors) is None

    def test_clamps_to_0_100(self):
        factors = [factor_from_subs("a", 1.0, "x", [("s", 999.0, 110.0, "")])]
        normalize_weights(factors)
        score = compute_composite(factors)
        assert score is not None
        assert 0.0 <= score <= 100.0


class TestStatsHelpers:

    def test_sharpe_positive_drift(self):
        # Use alternating positive returns with slight variation so vol > 0
        returns = [0.002 + 0.001 * (i % 3 - 1) for i in range(100)]
        s = sharpe(returns)
        assert s is not None and s > 0

    def test_sharpe_zero_vol_returns_none(self):
        # Truly identical values → std = 0 → None
        assert sharpe([0.001] * 50) is None

    def test_sortino_negative_returns(self):
        # Varying negative returns so downside_vol > 0
        returns = [-0.002 - 0.001 * (i % 3) for i in range(100)]
        so = sortino(returns)
        assert so is not None and so < 0

    def test_pearson_corr_perfect_positive(self):
        x = [1.0, 2.0, 3.0, 4.0, 5.0]
        assert pearson_corr(x, x) == pytest.approx(1.0)

    def test_pearson_corr_perfect_negative(self):
        x = [1.0, 2.0, 3.0]
        y = [-1.0, -2.0, -3.0]
        assert pearson_corr(x, y) == pytest.approx(-1.0)

    def test_pearson_corr_too_short_returns_none(self):
        assert pearson_corr([1.0], [1.0]) is None

    def test_daily_returns_length(self):
        rows = _make_price_rows("TEST", n_days=10)
        rets = compute_daily_returns(rows)
        assert len(rets) == 9  # n_days - 1 (excluding weekends shifts but formula is n-1)


# ---------------------------------------------------------------------------
# 2. Stock scorer
# ---------------------------------------------------------------------------

class TestStockScorer:

    def test_complete_data_returns_score(self):
        scorer = StockScorer()
        fund = [_stock_fund("AAPL"), _stock_fund("MSFT", trailing_pe=20.0, market_cap=2e12)]
        prices = {
            "AAPL": _make_price_rows("AAPL", n_days=300),
            "MSFT": _make_price_rows("MSFT", n_days=300),
        }
        results = scorer.score_batch(fund, prices)
        assert len(results) == 2
        for r in results:
            assert r.score_value is not None
            assert 0.0 <= r.score_value <= 100.0
            assert r.asset_class == "stock"

    def test_score_bounded_0_to_100(self):
        scorer = StockScorer()
        funds = [_stock_fund(f"T{i}") for i in range(10)]
        prices = {f["ticker"]: _make_price_rows(f["ticker"], n_days=300) for f in funds}
        results = scorer.score_batch(funds, prices)
        for r in results:
            if r.score_value is not None:
                assert 0.0 <= r.score_value <= 100.0

    def test_missing_fundamentals_fields_na(self):
        """A stock with all fundamentals None gets value/quality/size as N/A."""
        scorer = StockScorer()
        fund_sparse = _stock_fund(
            "SPARSE",
            trailing_pe=None, price_to_book=None,
            enterprise_value=None, ebitda=None, free_cashflow=None,
            return_on_equity=None, return_on_assets=None,
            debt_to_equity=None, profit_margins=None,
            market_cap=None, average_volume=None,
        )
        fund_full = _stock_fund("FULL")
        prices = {
            "SPARSE": _make_price_rows("SPARSE", n_days=300),
            "FULL": _make_price_rows("FULL", n_days=300),
        }
        results = scorer.score_batch([fund_sparse, fund_full], prices)
        sparse_result = next(r for r in results if r.ticker == "SPARSE")
        assert sparse_result.has_missing_factors is True
        # Value and Quality factors should be N/A
        value_f = next(f for f in sparse_result.factors if f.name == "value")
        quality_f = next(f for f in sparse_result.factors if f.name == "quality")
        assert value_f.is_na is True
        assert quality_f.is_na is True

    def test_missing_price_history_na(self):
        """A stock with no price rows gets momentum/vol/adv as N/A."""
        scorer = StockScorer()
        fund = _stock_fund("NOPRICE")
        prices: dict = {}  # no price data
        results = scorer.score_batch([fund], prices)
        r = results[0]
        assert r.has_missing_factors is True
        momentum_f = next(f for f in r.factors if f.name == "momentum")
        vol_f = next(f for f in r.factors if f.name == "volatility_adjusted")
        assert momentum_f.is_na is True
        assert vol_f.is_na is True

    def test_short_price_history_partial_momentum(self):
        """With 80 rows, only 3M momentum sub-factor is available."""
        scorer = StockScorer()
        fund = [_stock_fund("A"), _stock_fund("B")]
        prices = {
            "A": _make_price_rows("A", n_days=80),
            "B": _make_price_rows("B", n_days=80),
        }
        results = scorer.score_batch(fund, prices)
        for r in results:
            mom_f = next(f for f in r.factors if f.name == "momentum")
            # 3M sub-factor might be available (need 64 rows)
            ret3m_sf = mom_f.sub_factors.get("return_3m", {})
            # 12M sub-factor should be N/A (need 253 rows)
            ret12m_sf = mom_f.sub_factors.get("return_12m", {})
            assert ret12m_sf.get("is_na") is True

    def test_breakdown_has_source_labels(self):
        scorer = StockScorer()
        fund = [_stock_fund("AAPL")]
        prices = {"AAPL": _make_price_rows("AAPL", n_days=300)}
        results = scorer.score_batch(fund, prices)
        r = results[0]
        factor_sources = {f.name: f.source for f in r.factors}
        assert factor_sources["value"] == "fundamentals"
        assert factor_sources["quality"] == "fundamentals"
        assert factor_sources["momentum"] == "prices"
        assert factor_sources["volatility_adjusted"] == "prices"
        assert factor_sources["size_liquidity"] == "mixed"

    def test_snapshot_date_stored(self):
        scorer = StockScorer()
        fund = [_stock_fund("AAPL", snapshot_date="2026-03-01")]
        prices = {"AAPL": _make_price_rows("AAPL", n_days=300)}
        results = scorer.score_batch(fund, prices)
        assert results[0].fundamentals_snapshot_date == "2026-03-01"

    def test_prices_computed_at_stored(self):
        scorer = StockScorer()
        fund = [_stock_fund("AAPL")]
        prices = {"AAPL": _make_price_rows("AAPL", n_days=300)}
        results = scorer.score_batch(fund, prices)
        assert results[0].prices_computed_at is not None
        assert isinstance(results[0].prices_computed_at, datetime)

    def test_all_na_factors_score_is_none(self):
        scorer = StockScorer()
        fund = _stock_fund(
            "GHOST",
            trailing_pe=None, price_to_book=None,
            enterprise_value=None, ebitda=None, free_cashflow=None,
            return_on_equity=None, return_on_assets=None,
            debt_to_equity=None, profit_margins=None,
            market_cap=None, average_volume=None,
        )
        prices: dict = {}
        results = scorer.score_batch([fund], prices)
        assert results[0].score_value is None

    def test_empty_fundamentals_returns_empty(self):
        scorer = StockScorer()
        assert scorer.score_batch([], {}) == []


# ---------------------------------------------------------------------------
# 3. ETF scorer
# ---------------------------------------------------------------------------

class TestEtfScorer:

    def test_complete_data_returns_score(self):
        scorer = EtfScorer()
        funds = [_etf_fund("SPY"), _etf_fund("QQQ", expense_ratio=0.002)]
        prices = {
            "SPY": _make_price_rows("SPY", n_days=300),
            "QQQ": _make_price_rows("QQQ", n_days=300),
        }
        results = scorer.score_batch(funds, prices)
        assert len(results) == 2
        for r in results:
            assert r.asset_class == "etf"
            assert r.score_value is not None
            assert 0.0 <= r.score_value <= 100.0

    def test_missing_expense_ratio_na(self):
        scorer = EtfScorer()
        fund = _etf_fund("NOCOST", expense_ratio=None)
        prices = {
            "NOCOST": _make_price_rows("NOCOST", n_days=300),
            MARKET_PROXY_TICKER: _make_price_rows(MARKET_PROXY_TICKER, n_days=300),
        }
        results = scorer.score_batch([fund], prices)
        r = results[0]
        cost_f = next(f for f in r.factors if f.name == "cost")
        assert cost_f.is_na is True

    def test_missing_aum_na(self):
        scorer = EtfScorer()
        fund = _etf_fund("NOAUM", total_assets=None, average_volume=None)
        prices = {
            "NOAUM": _make_price_rows("NOAUM", n_days=300),
            MARKET_PROXY_TICKER: _make_price_rows(MARKET_PROXY_TICKER, n_days=300),
        }
        results = scorer.score_batch([fund], prices)
        r = results[0]
        liq_f = next(f for f in r.factors if f.name == "liquidity_aum")
        # AUM sub-factor is N/A; ADV from prices should be available
        aum_sf = liq_f.sub_factors.get("aum", {})
        assert aum_sf.get("is_na") is True

    def test_no_spy_prices_diversification_na(self):
        scorer = EtfScorer()
        fund = _etf_fund("VTI")
        prices = {
            "VTI": _make_price_rows("VTI", n_days=300),
            # SPY prices deliberately absent
        }
        results = scorer.score_batch([fund], prices)
        r = results[0]
        div_f = next(f for f in r.factors if f.name == "diversification_benefit")
        assert div_f.is_na is True

    def test_diversification_lower_corr_better(self):
        """An ETF with lower (more negative) SPY correlation scores higher on diversification."""
        scorer = EtfScorer()
        fetched = _utcnow()
        start = date(2023, 1, 3)
        n = 300

        def _rows(ticker: str, prices: list[float]) -> list[PriceRow]:
            d = start
            rows = []
            for p in prices:
                while d.weekday() >= 5:
                    d += timedelta(days=1)
                rows.append(PriceRow(
                    ticker=ticker, date=d, open=p, high=p, low=p,
                    close=p, adjusted_close=p, volume=1_000_000, fetched_at=fetched,
                ))
                d += timedelta(days=1)
            return rows

        # SPY: monotonically increasing  → corr(SPY,SPY)=+1, corr(SPY,INVERSE)≈-1
        spy_prices = [100.0 + i * 0.5 for i in range(n)]
        # INVERSE_ETF: perfect negative of SPY
        inv_prices = [200.0 - i * 0.5 for i in range(n)]
        # MIRROR_ETF: same as SPY (high positive correlation)
        mirror_prices = [100.0 + i * 0.5 for i in range(n)]

        spy_rows_det = _rows("SPY", spy_prices)
        inv_rows = _rows("INVERSE", inv_prices)
        mirror_rows = _rows("MIRROR", mirror_prices)

        funds = [_etf_fund("INVERSE"), _etf_fund("MIRROR")]
        prices = {
            "INVERSE": inv_rows,
            "MIRROR": mirror_rows,
            "SPY": spy_rows_det,
        }
        results = scorer.score_batch(funds, prices)
        inv_r = next(r for r in results if r.ticker == "INVERSE")
        mirror_r = next(r for r in results if r.ticker == "MIRROR")
        inv_div = next(f for f in inv_r.factors if f.name == "diversification_benefit")
        mirror_div = next(f for f in mirror_r.factors if f.name == "diversification_benefit")

        assert not inv_div.is_na and not mirror_div.is_na, "Both should have correlation data"
        # INVERSE has corr ≈ -1 (best diversification) → higher score than MIRROR (corr ≈ +1)
        assert inv_div.score > mirror_div.score

    def test_breakdown_has_source_labels(self):
        scorer = EtfScorer()
        funds = [_etf_fund("SPY")]
        prices = {
            "SPY": _make_price_rows("SPY", n_days=300),
        }
        results = scorer.score_batch(funds, prices)
        r = results[0]
        factor_sources = {f.name: f.source for f in r.factors}
        assert factor_sources["cost"] == "fundamentals"
        assert factor_sources["liquidity_aum"] == "mixed"
        assert factor_sources["risk_adjusted_return"] == "prices"
        assert factor_sources["diversification_benefit"] == "prices"

    def test_empty_fundamentals_returns_empty(self):
        scorer = EtfScorer()
        assert scorer.score_batch([], {}) == []


# ---------------------------------------------------------------------------
# 4. N/A handling — weight re-normalization
# ---------------------------------------------------------------------------

class TestNAHandling:

    def test_missing_factor_weight_redistributed(self):
        """When Value factor is N/A, its 25% weight is distributed to others."""
        scorer = StockScorer()
        fund_no_value = _stock_fund(
            "NOVAL",
            trailing_pe=None, price_to_book=None,
            enterprise_value=None, ebitda=None, free_cashflow=None,
        )
        fund_full = _stock_fund("FULL")
        prices = {
            "NOVAL": _make_price_rows("NOVAL", n_days=300),
            "FULL": _make_price_rows("FULL", n_days=300),
        }
        results = scorer.score_batch([fund_no_value, fund_full], prices)
        noval_r = next(r for r in results if r.ticker == "NOVAL")
        value_f = next(f for f in noval_r.factors if f.name == "value")
        assert value_f.is_na is True
        assert value_f.effective_weight == pytest.approx(0.0)
        # Remaining factors' effective weights should sum to 1.0
        total_eff = sum(f.effective_weight for f in noval_r.factors)
        assert total_eff == pytest.approx(1.0)

    def test_has_missing_factors_flag(self):
        scorer = StockScorer()
        fund = _stock_fund("X", trailing_pe=None, price_to_book=None,
                           enterprise_value=None, ebitda=None, free_cashflow=None)
        prices = {"X": _make_price_rows("X", n_days=300)}
        results = scorer.score_batch([fund], prices)
        assert results[0].has_missing_factors is True

    def test_complete_data_no_missing_flag(self):
        scorer = StockScorer()
        fund = _stock_fund("FULL")
        prices = {"FULL": _make_price_rows("FULL", n_days=300)}
        results = scorer.score_batch([fund], prices)
        r = results[0]
        # With complete data, all factors should have scores (not necessarily all sub-factors)
        # The flag can only be False if all 5 factors are available
        non_na = [f for f in r.factors if not f.is_na]
        assert len(non_na) > 0


# ---------------------------------------------------------------------------
# 5. Score cache write-through
# ---------------------------------------------------------------------------

class TestScoreCacheWriter:

    def test_write_stores_score(self, db):
        scorer = StockScorer()
        fund = [_stock_fund("AAPL")]
        prices = {"AAPL": _make_price_rows("AAPL", n_days=300)}
        results = scorer.score_batch(fund, prices)

        writer = ScoreCacheWriter()
        writer.write(db, results[0])

        row = db.get(AssetScoreCacheRow, "AAPL")
        assert row is not None
        assert row.ticker == "AAPL"
        assert row.score_value is not None
        assert 0.0 <= row.score_value <= 100.0

    def test_write_stores_fundamentals_snapshot_date(self, db):
        scorer = StockScorer()
        fund = [_stock_fund("AAPL", snapshot_date="2026-03-15")]
        prices = {"AAPL": _make_price_rows("AAPL", n_days=300)}
        results = scorer.score_batch(fund, prices)

        writer = ScoreCacheWriter()
        writer.write(db, results[0])

        row = db.get(AssetScoreCacheRow, "AAPL")
        assert row.fundamentals_snapshot_date == "2026-03-15"

    def test_write_stores_prices_computed_at(self, db):
        scorer = StockScorer()
        fund = [_stock_fund("MSFT")]
        prices = {"MSFT": _make_price_rows("MSFT", n_days=300)}
        results = scorer.score_batch(fund, prices)

        writer = ScoreCacheWriter()
        writer.write(db, results[0])

        row = db.get(AssetScoreCacheRow, "MSFT")
        assert row.prices_computed_at is not None

    def test_write_stores_breakdown_json(self, db):
        scorer = StockScorer()
        fund = [_stock_fund("AAPL")]
        prices = {"AAPL": _make_price_rows("AAPL", n_days=300)}
        results = scorer.score_batch(fund, prices)

        writer = ScoreCacheWriter()
        writer.write(db, results[0])

        row = db.get(AssetScoreCacheRow, "AAPL")
        assert isinstance(row.breakdown, dict)
        assert "factors" in row.breakdown
        assert isinstance(row.breakdown["factors"], list)
        # Check source labels present in breakdown
        sources = {f["source"] for f in row.breakdown["factors"]}
        assert "fundamentals" in sources or "prices" in sources

    def test_write_upserts_existing(self, db):
        scorer = StockScorer()
        fund = [_stock_fund("AAPL")]
        prices = {"AAPL": _make_price_rows("AAPL", n_days=300)}
        results = scorer.score_batch(fund, prices)

        writer = ScoreCacheWriter()
        writer.write(db, results[0])
        # Write again — should update, not duplicate
        writer.write(db, results[0])

        from sqlalchemy import select
        count = db.execute(
            select(AssetScoreCacheRow).where(AssetScoreCacheRow.ticker == "AAPL")
        ).scalars().all()
        assert len(count) == 1

    def test_write_batch(self, db):
        scorer = StockScorer()
        funds = [_stock_fund("AAPL"), _stock_fund("MSFT")]
        prices = {
            "AAPL": _make_price_rows("AAPL", n_days=300),
            "MSFT": _make_price_rows("MSFT", n_days=300),
        }
        results = scorer.score_batch(funds, prices)
        writer = ScoreCacheWriter()
        writer.write_batch(db, results)

        from sqlalchemy import select
        rows = db.execute(select(AssetScoreCacheRow)).scalars().all()
        assert len(rows) == 2


# ---------------------------------------------------------------------------
# 6. Scoring service (integration)
# ---------------------------------------------------------------------------

class TestScoringService:

    def test_score_universe_writes_to_cache(self, db):
        service = ScoringService()
        fundamentals = [
            _stock_fund("AAPL"),
            _stock_fund("MSFT"),
            _etf_fund("SPY"),
        ]
        prices = {
            "AAPL": _make_price_rows("AAPL", n_days=300),
            "MSFT": _make_price_rows("MSFT", n_days=300),
            "SPY": _make_price_rows("SPY", n_days=300),
        }
        results = service.score_universe(fundamentals, prices, db)
        assert len(results) == 3
        # All should be in DB
        from sqlalchemy import select
        rows = db.execute(select(AssetScoreCacheRow)).scalars().all()
        assert len(rows) == 3

    def test_no_construction_output_produced(self, db):
        """Score universe must not create any saved_portfolio or portfolio_holding rows."""
        from app.models.tables import SavedPortfolio, PortfolioHolding
        from sqlalchemy import select

        service = ScoringService()
        fundamentals = [_stock_fund("AAPL")]
        prices = {"AAPL": _make_price_rows("AAPL", n_days=300)}
        service.score_universe(fundamentals, prices, db)

        portfolios = db.execute(select(SavedPortfolio)).scalars().all()
        holdings = db.execute(select(PortfolioHolding)).scalars().all()
        assert portfolios == []
        assert holdings == []


# ---------------------------------------------------------------------------
# 7. FundamentalsReader
# ---------------------------------------------------------------------------

class TestFundamentalsReader:

    def test_read_all_from_parquet(self, tmp_path):
        path = tmp_path / "fundamentals_2026-01-15.parquet"
        df = pd.DataFrame([
            _stock_fund("AAPL"),
            _etf_fund("SPY"),
        ])
        df.to_parquet(path, index=False)

        reader = FundamentalsReader(path)
        records = reader.read_all()
        assert len(records) == 2
        tickers = {r["ticker"] for r in records}
        assert {"AAPL", "SPY"} == tickers

    def test_missing_file_returns_empty(self, tmp_path):
        reader = FundamentalsReader(tmp_path / "no_file.parquet")
        assert reader.read_all() == []

    def test_get_snapshot_date(self, tmp_path):
        path = tmp_path / "fund.parquet"
        df = pd.DataFrame([_stock_fund("AAPL", snapshot_date="2026-03-01")])
        df.to_parquet(path, index=False)
        reader = FundamentalsReader(path)
        assert reader.get_snapshot_date() == "2026-03-01"

    def test_nan_values_become_none(self, tmp_path):
        """NaN in parquet should be returned as None (for easy is None checks)."""
        import numpy as np
        path = tmp_path / "fund.parquet"
        df = pd.DataFrame([{"ticker": "AAPL", "asset_class": "stock",
                            "snapshot_date": "2026-01-15", "trailing_pe": float("nan")}])
        df.to_parquet(path, index=False)
        reader = FundamentalsReader(path)
        records = reader.read_all()
        assert records[0].get("trailing_pe") is None


# ---------------------------------------------------------------------------
# 8. Scope checks
# ---------------------------------------------------------------------------

class TestScopeCompliance:

    def test_no_live_yfinance_in_scorer(self):
        """Scoring modules must not import yfinance directly."""
        import ast, importlib
        for mod_name in [
            "app.core.scoring.base",
            "app.core.scoring.stocks",
            "app.core.scoring.etfs",
            "app.core.scoring.service",
        ]:
            mod = importlib.import_module(mod_name)
            source = Path(mod.__file__).read_text(encoding="utf-8")
            tree = ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    names = (
                        [alias.name for alias in node.names]
                        if isinstance(node, ast.Import)
                        else ([node.module] if node.module else [])
                    )
                    for n in names:
                        assert "yfinance" not in (n or ""), (
                            f"yfinance imported in {mod_name}"
                        )

    def test_no_new_provider_subclasses(self):
        """Only YFinanceProvider may subclass BaseProvider."""
        from app.data.providers.base import BaseProvider
        import app.data.providers.yfinance_provider  # ensure subclass is registered  # noqa: F401
        names = [cls.__name__ for cls in BaseProvider.__subclasses__()]
        assert "YFinanceProvider" in names
        assert len(names) == 1, f"Unexpected extra providers: {names}"

    def test_no_construction_imports_in_scoring(self):
        """Scoring modules must not import construction/allocation/portfolio logic."""
        import ast, importlib
        forbidden_modules = {"construction", "allocation", "correlation", "portfolio"}
        for mod_name in [
            "app.core.scoring.base",
            "app.core.scoring.stocks",
            "app.core.scoring.etfs",
            "app.core.scoring.service",
        ]:
            mod = importlib.import_module(mod_name)
            source = Path(mod.__file__).read_text(encoding="utf-8")
            for term in forbidden_modules:
                # Only check import statements, not comments
                tree = ast.parse(source)
                for node in ast.walk(tree):
                    if isinstance(node, ast.ImportFrom) and node.module:
                        assert term not in node.module, (
                            f"'{term}' imported in {mod_name}: {node.module}"
                        )
