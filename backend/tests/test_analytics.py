"""
Backend tests for Task 15 — Portfolio historical analytics.

Coverage:
  1.  Unknown portfolio returns 404.
  2.  Invalid period returns 400.
  3.  Endpoint returns 200 with seeded local price data.
  4.  Cumulative return is correct for deterministic prices.
  5.  Annualized volatility is correct for deterministic prices.
  6.  Max drawdown is correct for non-monotonic prices.
  7.  Sharpe ratio is correct with risk-free rate = 0.
  8.  Equity curve starts at 1.0.
  9.  Equity curve dates are ISO YYYY-MM-DD format.
 10.  Drawdown series values are non-positive.
 11.  SPY benchmark is null when SPY local data is unavailable.
 12.  SPY benchmark is present when SPY local data is seeded.
 13.  Insufficient data flag triggers under 30 overlapping trading days.
 14.  Tickers with no price data are listed in tickers_excluded.
 15.  Analytics endpoint does not write to the database.
 16.  Analytics module does not import yfinance.
 17.  Analytics module does not import scoring.
 18.  Analytics module does not import construction.
 19.  period=ytd uses Jan 1 of current year.
 20.  period=max uses all available local data.
 21.  Equity curve length matches trading_days_used.
 22.  Analytics reads DB directly, not portfolio HTTP endpoint.
"""

import math
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.tables  # noqa: F401
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.tables import PortfolioHolding, PriceCache, SavedPortfolio


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 1, 1, 0, 0, 0)


def _make_portfolio(db, *, name: str = "Test Portfolio") -> SavedPortfolio:
    p = SavedPortfolio(
        name=name,
        variant_type="core",
        risk_level_snapshot=3,
        status="saved",
        source_universe="full_universe",
        generation_method="risk_parity_full",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(p)
    db.flush()
    return p


def _add_holding(db, portfolio_id: int, ticker: str, weight: float = 1.0) -> None:
    db.add(PortfolioHolding(
        portfolio_id=portfolio_id,
        ticker=ticker,
        asset_class="stock",
        weight=weight,
        score=75.0,
    ))


def _add_prices(db, ticker: str, base_date: date, prices: list[float]) -> None:
    """Insert consecutive PriceCache rows starting from base_date."""
    for i, price in enumerate(prices):
        d = base_date + timedelta(days=i)
        db.add(PriceCache(
            ticker=ticker,
            price_date=d,
            open=price,
            high=price,
            low=price,
            close=price,
            adjusted_close=price,
            volume=100_000,
            fetched_at=_NOW,
        ))


# Arithmetic price series: 100, 101, ..., 134  (35 days)
_BASE_DATE = date(2025, 8, 1)
_ARITH_PRICES = [100.0 + i for i in range(35)]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def _make_client(engine, db_setup_fn=None):
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    if db_setup_fn:
        seed_db = Session()
        db_setup_fn(seed_db)
        seed_db.commit()
        seed_db.close()

    def override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app_instance = create_app()
    app_instance.dependency_overrides[get_db] = override_get_db
    return TestClient(app_instance)


@pytest.fixture()
def empty_client():
    """Client with no data."""
    engine = _make_engine()
    return _make_client(engine)


@pytest.fixture()
def arith_client():
    """Client with one portfolio + 35 arithmetic prices for ALPHA."""
    engine = _make_engine()

    def setup(db):
        p = _make_portfolio(db)
        _add_holding(db, p.id, "ALPHA", weight=1.0)
        _add_prices(db, "ALPHA", _BASE_DATE, _ARITH_PRICES)

    client = _make_client(engine, setup)
    # Return client + portfolio_id
    Session = sessionmaker(bind=engine)
    s = Session()
    pid = s.query(SavedPortfolio).first().id
    s.close()
    return client, pid


@pytest.fixture()
def drawdown_client():
    """Client with non-monotonic prices: rises then falls, 35 dates."""
    engine = _make_engine()
    # Prices: 100→120 (21 dates), then 120→101 (14 more dates) = 35 total
    up = [100.0 + i for i in range(21)]     # 100..120
    down = [120.0 - i for i in range(1, 15)]  # 119..106  (14 values)
    prices = up + down  # 35 values, peak=120, trough=106

    def setup(db):
        p = _make_portfolio(db, name="Drawdown Portfolio")
        _add_holding(db, p.id, "DRAWX", weight=1.0)
        _add_prices(db, "DRAWX", _BASE_DATE, prices)

    client = _make_client(engine, setup)
    Session = sessionmaker(bind=engine)
    s = Session()
    pid = s.query(SavedPortfolio).first().id
    s.close()
    return client, pid


@pytest.fixture()
def spy_client():
    """Client with ALPHA prices and SPY prices (same dates)."""
    engine = _make_engine()

    def setup(db):
        p = _make_portfolio(db, name="SPY Portfolio")
        _add_holding(db, p.id, "ALPHA", weight=1.0)
        _add_prices(db, "ALPHA", _BASE_DATE, _ARITH_PRICES)
        _add_prices(db, "SPY", _BASE_DATE, _ARITH_PRICES)

    client = _make_client(engine, setup)
    Session = sessionmaker(bind=engine)
    s = Session()
    pid = s.query(SavedPortfolio).first().id
    s.close()
    return client, pid


@pytest.fixture()
def insufficient_client():
    """Client with only 15 price dates (below 30 threshold)."""
    engine = _make_engine()
    prices = [100.0 + i for i in range(15)]

    def setup(db):
        p = _make_portfolio(db, name="Short Portfolio")
        _add_holding(db, p.id, "SHORT", weight=1.0)
        _add_prices(db, "SHORT", _BASE_DATE, prices)

    client = _make_client(engine, setup)
    Session = sessionmaker(bind=engine)
    s = Session()
    pid = s.query(SavedPortfolio).first().id
    s.close()
    return client, pid


@pytest.fixture()
def exclude_client():
    """Client with two holdings: ALPHA has prices, GHOST has none."""
    engine = _make_engine()

    def setup(db):
        p = _make_portfolio(db, name="Exclude Portfolio")
        _add_holding(db, p.id, "ALPHA", weight=0.6)
        _add_holding(db, p.id, "GHOST", weight=0.4)
        _add_prices(db, "ALPHA", _BASE_DATE, _ARITH_PRICES)
        # GHOST: no price rows

    client = _make_client(engine, setup)
    Session = sessionmaker(bind=engine)
    s = Session()
    pid = s.query(SavedPortfolio).first().id
    s.close()
    return client, pid


@pytest.fixture()
def ytd_client():
    """Client with prices covering Jan–Jun 2026 (60 dates)."""
    engine = _make_engine()
    ytd_base = date(2026, 1, 2)
    prices = [100.0 + i * 0.5 for i in range(60)]

    def setup(db):
        p = _make_portfolio(db, name="YTD Portfolio")
        _add_holding(db, p.id, "YTDX", weight=1.0)
        _add_prices(db, "YTDX", ytd_base, prices)

    client = _make_client(engine, setup)
    Session = sessionmaker(bind=engine)
    s = Session()
    pid = s.query(SavedPortfolio).first().id
    s.close()
    return client, pid


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _analytics(client, pid, period="max"):
    return client.get(f"/api/v1/analytics/portfolios/{pid}?period={period}")


# ---------------------------------------------------------------------------
# Test 1 — 404 for unknown portfolio
# ---------------------------------------------------------------------------

class TestNotFound:
    def test_unknown_portfolio_returns_404(self, empty_client):
        resp = empty_client.get("/api/v1/analytics/portfolios/99999?period=1y")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Test 2 — invalid period returns 400
# ---------------------------------------------------------------------------

class TestInvalidPeriod:
    def test_invalid_period_returns_400(self, arith_client):
        c, pid = arith_client
        resp = c.get(f"/api/v1/analytics/portfolios/{pid}?period=10y")
        assert resp.status_code == 400

    def test_empty_period_returns_400(self, arith_client):
        c, pid = arith_client
        resp = c.get(f"/api/v1/analytics/portfolios/{pid}?period=")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Test 3 — 200 with seeded prices
# ---------------------------------------------------------------------------

class TestSuccessfulResponse:
    def test_returns_200(self, arith_client):
        c, pid = arith_client
        resp = _analytics(c, pid)
        assert resp.status_code == 200

    def test_response_fields_present(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        required = {
            "portfolio_id", "period_requested", "period_start", "period_end",
            "trading_days_used", "insufficient_data", "reason", "tickers_excluded",
            "spy_available", "cumulative_return", "annualized_volatility",
            "max_drawdown", "sharpe_ratio", "equity_curve", "drawdown_series",
            "spy_benchmark",
        }
        assert required.issubset(doc.keys())

    def test_insufficient_data_false(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        assert doc["insufficient_data"] is False


# ---------------------------------------------------------------------------
# Test 4 — cumulative return for arithmetic prices
# ---------------------------------------------------------------------------

class TestCumulativeReturn:
    def test_cumulative_return_telescopes(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        # With prices 100..134: cumulative = 134/100 - 1 = 0.34 (exact telescoping)
        expected = 134.0 / 100.0 - 1.0
        assert abs(doc["cumulative_return"] - expected) < 1e-6


# ---------------------------------------------------------------------------
# Test 5 — annualized volatility
# ---------------------------------------------------------------------------

class TestAnnualizedVolatility:
    def test_annualized_volatility_correct(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        # Compute expected vol from known daily returns
        prices = _ARITH_PRICES
        returns = [prices[i] / prices[i - 1] - 1.0 for i in range(1, len(prices))]
        mean_r = sum(returns) / len(returns)
        variance = sum((r - mean_r) ** 2 for r in returns) / (len(returns) - 1)
        expected_vol = math.sqrt(variance) * math.sqrt(252)
        assert abs(doc["annualized_volatility"] - expected_vol) < 1e-6

    def test_annualized_volatility_non_negative(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        assert doc["annualized_volatility"] >= 0.0


# ---------------------------------------------------------------------------
# Test 6 — max drawdown for non-monotonic prices
# ---------------------------------------------------------------------------

class TestMaxDrawdown:
    def test_max_drawdown_value(self, drawdown_client):
        c, pid = drawdown_client
        doc = _analytics(c, pid).json()
        # Prices: 100→120 (peak=120), then 120→106 (trough=106 on last day)
        # Drawdown at trough = 106/120 - 1 = -0.11666...
        expected_dd = 106.0 / 120.0 - 1.0
        assert abs(doc["max_drawdown"] - expected_dd) < 1e-5

    def test_max_drawdown_is_non_positive(self, drawdown_client):
        c, pid = drawdown_client
        doc = _analytics(c, pid).json()
        assert doc["max_drawdown"] <= 0.0

    def test_max_drawdown_zero_for_monotonic_prices(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        # Arithmetic prices always increase → no drawdown
        assert abs(doc["max_drawdown"]) < 1e-9


# ---------------------------------------------------------------------------
# Test 7 — Sharpe ratio (risk-free = 0)
# ---------------------------------------------------------------------------

class TestSharpeRatio:
    def test_sharpe_ratio_correct(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        prices = _ARITH_PRICES
        returns = [prices[i] / prices[i - 1] - 1.0 for i in range(1, len(prices))]
        mean_r = sum(returns) / len(returns)
        variance = sum((r - mean_r) ** 2 for r in returns) / (len(returns) - 1)
        daily_std = math.sqrt(variance)
        expected_sharpe = (mean_r / daily_std) * math.sqrt(252)
        assert abs(doc["sharpe_ratio"] - expected_sharpe) < 1e-5


# ---------------------------------------------------------------------------
# Test 8 — equity curve starts at 1.0
# ---------------------------------------------------------------------------

class TestEquityCurveStart:
    def test_equity_curve_starts_at_one(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        assert doc["equity_curve"][0]["value"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Test 9 — equity curve date format
# ---------------------------------------------------------------------------

class TestEquityCurveDates:
    def test_equity_curve_dates_are_iso(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        for entry in doc["equity_curve"]:
            # Must be YYYY-MM-DD
            d = date.fromisoformat(entry["date"])
            assert isinstance(d, date)


# ---------------------------------------------------------------------------
# Test 10 — drawdown series non-positive
# ---------------------------------------------------------------------------

class TestDrawdownSeries:
    def test_drawdown_values_non_positive(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        for entry in doc["drawdown_series"]:
            assert entry["drawdown"] <= 0.0

    def test_drawdown_values_non_positive_non_monotonic(self, drawdown_client):
        c, pid = drawdown_client
        doc = _analytics(c, pid).json()
        for entry in doc["drawdown_series"]:
            assert entry["drawdown"] <= 0.0


# ---------------------------------------------------------------------------
# Test 11 — SPY null when not available
# ---------------------------------------------------------------------------

class TestSpyNotAvailable:
    def test_spy_benchmark_null_when_absent(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        assert doc["spy_available"] is False
        assert doc["spy_benchmark"] is None


# ---------------------------------------------------------------------------
# Test 12 — SPY present when seeded
# ---------------------------------------------------------------------------

class TestSpyAvailable:
    def test_spy_benchmark_present_when_seeded(self, spy_client):
        c, pid = spy_client
        doc = _analytics(c, pid).json()
        assert doc["spy_available"] is True
        assert doc["spy_benchmark"] is not None
        assert len(doc["spy_benchmark"]) > 0

    def test_spy_benchmark_starts_at_one(self, spy_client):
        c, pid = spy_client
        doc = _analytics(c, pid).json()
        assert doc["spy_benchmark"][0]["value"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Test 13 — insufficient data < 30 days
# ---------------------------------------------------------------------------

class TestInsufficientData:
    def test_insufficient_data_flag_set(self, insufficient_client):
        c, pid = insufficient_client
        doc = _analytics(c, pid).json()
        assert doc["insufficient_data"] is True

    def test_metrics_null_when_insufficient(self, insufficient_client):
        c, pid = insufficient_client
        doc = _analytics(c, pid).json()
        assert doc["cumulative_return"] is None
        assert doc["annualized_volatility"] is None
        assert doc["max_drawdown"] is None
        assert doc["sharpe_ratio"] is None

    def test_series_empty_when_insufficient(self, insufficient_client):
        c, pid = insufficient_client
        doc = _analytics(c, pid).json()
        assert doc["equity_curve"] == []
        assert doc["drawdown_series"] == []

    def test_reason_is_plain_text(self, insufficient_client):
        c, pid = insufficient_client
        doc = _analytics(c, pid).json()
        assert isinstance(doc["reason"], str)
        assert len(doc["reason"]) > 10


# ---------------------------------------------------------------------------
# Test 14 — excluded tickers
# ---------------------------------------------------------------------------

class TestTickersExcluded:
    def test_ghost_ticker_excluded(self, exclude_client):
        c, pid = exclude_client
        doc = _analytics(c, pid).json()
        assert "GHOST" in doc["tickers_excluded"]

    def test_included_ticker_not_excluded(self, exclude_client):
        c, pid = exclude_client
        doc = _analytics(c, pid).json()
        assert "ALPHA" not in doc["tickers_excluded"]

    def test_analytics_still_computed_when_some_excluded(self, exclude_client):
        c, pid = exclude_client
        doc = _analytics(c, pid).json()
        # ALPHA has 35 prices — sufficient data after GHOST exclusion
        assert doc["insufficient_data"] is False
        assert doc["cumulative_return"] is not None


# ---------------------------------------------------------------------------
# Test 15 — no DB writes
# ---------------------------------------------------------------------------

class TestNoDatabaseWrites:
    def test_row_counts_unchanged(self, arith_client):
        c, pid = arith_client
        before = c.get("/api/v1/portfolios?status=all&limit=100").json()["total"]
        _analytics(c, pid)
        after = c.get("/api/v1/portfolios?status=all&limit=100").json()["total"]
        assert before == after


# ---------------------------------------------------------------------------
# Tests 16–18 — module isolation
# ---------------------------------------------------------------------------

class TestModuleIsolation:
    def _import_lines(self, module) -> list[str]:
        import inspect
        src = inspect.getsource(module)
        return [
            line.strip()
            for line in src.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]

    def test_analytics_does_not_import_yfinance(self):
        import app.api.analytics as mod
        for line in self._import_lines(mod):
            assert "yfinance" not in line, f"analytics.py must not import yfinance: {line}"

    def test_analytics_does_not_import_scoring(self):
        import app.api.analytics as mod
        for line in self._import_lines(mod):
            assert "scoring" not in line, f"analytics.py must not import scoring: {line}"

    def test_analytics_does_not_import_construction(self):
        import app.api.analytics as mod
        for line in self._import_lines(mod):
            assert "construction" not in line, (
                f"analytics.py must not import construction: {line}"
            )

    def test_performance_does_not_import_yfinance(self):
        import app.core.performance as mod
        for line in self._import_lines(mod):
            assert "yfinance" not in line

    def test_performance_does_not_import_scoring(self):
        import app.core.performance as mod
        for line in self._import_lines(mod):
            assert "scoring" not in line

    def test_performance_does_not_import_construction(self):
        import app.core.performance as mod
        for line in self._import_lines(mod):
            assert "construction" not in line


# ---------------------------------------------------------------------------
# Test 19 — period=ytd
# ---------------------------------------------------------------------------

class TestPeriodYtd:
    def test_ytd_returns_data_from_jan_first(self, ytd_client):
        c, pid = ytd_client
        resp = c.get(f"/api/v1/analytics/portfolios/{pid}?period=ytd")
        assert resp.status_code == 200
        doc = resp.json()
        assert doc["insufficient_data"] is False
        # Period start must be Jan 1 or later of current year
        period_start = date.fromisoformat(doc["period_start"])
        assert period_start >= date(2026, 1, 1)

    def test_ytd_status_200(self, ytd_client):
        c, pid = ytd_client
        resp = c.get(f"/api/v1/analytics/portfolios/{pid}?period=ytd")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Test 20 — period=max
# ---------------------------------------------------------------------------

class TestPeriodMax:
    def test_max_returns_all_available_data(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid, period="max").json()
        assert doc["trading_days_used"] >= 1
        assert doc["insufficient_data"] is False

    def test_max_returns_more_than_1y(self, arith_client):
        """period=max and period=1y both return data from the same small seed set."""
        c, pid = arith_client
        doc_max = _analytics(c, pid, period="max").json()
        doc_1y = _analytics(c, pid, period="1y").json()
        # Both cover the same seeded dates (all within 1y range)
        assert doc_max["trading_days_used"] >= doc_1y["trading_days_used"]


# ---------------------------------------------------------------------------
# Test 21 — equity curve length = trading_days_used
# ---------------------------------------------------------------------------

class TestEquityCurveLength:
    def test_equity_curve_length_matches_trading_days_used(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        assert len(doc["equity_curve"]) == doc["trading_days_used"]

    def test_drawdown_series_same_length_as_equity_curve(self, arith_client):
        c, pid = arith_client
        doc = _analytics(c, pid).json()
        assert len(doc["drawdown_series"]) == len(doc["equity_curve"])


# ---------------------------------------------------------------------------
# Test 22 — analytics reads DB directly (no portfolio HTTP endpoint)
# ---------------------------------------------------------------------------

class TestDirectDbAccess:
    def test_analytics_does_not_import_portfolios_module(self):
        import inspect
        import app.api.analytics as mod
        src = inspect.getsource(mod)
        import_lines = [
            line.strip()
            for line in src.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]
        for line in import_lines:
            assert "api.portfolios" not in line, (
                f"analytics.py must not import portfolios endpoint: {line}"
            )

    def test_analytics_does_not_import_httpx_or_requests(self):
        import inspect
        import app.api.analytics as mod
        src = inspect.getsource(mod)
        import_lines = [
            line.strip()
            for line in src.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]
        for line in import_lines:
            assert "httpx" not in line and "requests" not in line, (
                f"analytics.py must not make HTTP calls: {line}"
            )
