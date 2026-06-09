"""
Backend tests for Task 11 — Builder generate endpoint.

Coverage:
  1. Returns 400 when no profile exists.
  2. Returns 400 when profile has no risk_level.
  3. Returns 400 when no cached scores exist.
  4. Returns 3 variants when profile + scores are present.
  5. Variants include required fields (holdings, log, skip_log, etc.).
  6. Watchlist source returns 501.
  7. Unknown source_universe returns 400.
  8. No yfinance import in builder module.
  9. No scoring recomputation in builder module.
 10. No portfolio/holding writes after generation.
 11. No forbidden routes were added (save, export, watchlist CRUD).
 12. max_positions is respected.
"""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.tables  # noqa: F401
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.tables import AssetScoreCache, SavedPortfolio, UserProfile


# ---------------------------------------------------------------------------
# Test DB fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app_instance = create_app()
    app_instance.dependency_overrides[get_db] = override_get_db
    with TestClient(app_instance) as c:
        yield c
    Base.metadata.drop_all(engine)


@pytest.fixture()
def seeded_client():
    """Client with profile (risk_level=3) and 12 scored assets (8 stocks + 4 ETFs)."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    db = SessionLocal()

    # Profile with risk_level=3 (Compass)
    db.add(UserProfile(risk_level=3, name="Test User"))

    # 8 stock assets
    stock_tickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "JPM", "JNJ"]
    for i, ticker in enumerate(stock_tickers):
        score = 80.0 - i * 3.0
        db.add(AssetScoreCache(
            ticker=ticker,
            score_value=score,
            breakdown=_stock_breakdown(score),
            fundamentals_snapshot_date="2026-06-01",
            prices_computed_at=datetime(2026, 6, 8),
        ))

    # 4 ETF assets
    etf_tickers = ["SPY", "QQQ", "IVV", "VTI"]
    for i, ticker in enumerate(etf_tickers):
        score = 70.0 - i * 2.0
        db.add(AssetScoreCache(
            ticker=ticker,
            score_value=score,
            breakdown=_etf_breakdown(score),
            fundamentals_snapshot_date=None,
            prices_computed_at=datetime(2026, 6, 8),
        ))

    db.commit()
    db.close()

    def override_get_db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    app_instance = create_app()
    app_instance.dependency_overrides[get_db] = override_get_db
    with TestClient(app_instance) as c:
        yield c
    Base.metadata.drop_all(engine)


# ---------------------------------------------------------------------------
# Score breakdown helpers
# ---------------------------------------------------------------------------

def _stock_breakdown(score: float) -> dict:
    return {
        "asset_class": "stock",
        "score_value": score,
        "has_missing_factors": False,
        "fundamentals_snapshot_date": "2026-06-01",
        "prices_computed_at": "2026-06-08T10:00:00",
        "factors": [
            {"name": "momentum", "weight": 0.25, "effective_weight": 0.25,
             "score": score, "is_na": False, "na_reason": None,
             "source": "prices", "sub_factors": {}},
            {"name": "quality", "weight": 0.25, "effective_weight": 0.25,
             "score": score, "is_na": False, "na_reason": None,
             "source": "fundamentals", "sub_factors": {}},
            {"name": "value", "weight": 0.25, "effective_weight": 0.25,
             "score": score, "is_na": False, "na_reason": None,
             "source": "fundamentals", "sub_factors": {}},
            {"name": "volatility_adjusted", "weight": 0.25, "effective_weight": 0.25,
             "score": score, "is_na": False, "na_reason": None,
             "source": "prices", "sub_factors": {}},
        ],
    }


def _etf_breakdown(score: float) -> dict:
    return {
        "asset_class": "etf",
        "score_value": score,
        "has_missing_factors": False,
        "fundamentals_snapshot_date": None,
        "prices_computed_at": "2026-06-08T10:00:00",
        "factors": [
            {"name": "risk_adjusted_return", "weight": 0.40, "effective_weight": 0.40,
             "score": score, "is_na": False, "na_reason": None,
             "source": "prices", "sub_factors": {}},
            {"name": "cost", "weight": 0.20, "effective_weight": 0.20,
             "score": score, "is_na": False, "na_reason": None,
             "source": "fundamentals", "sub_factors": {}},
            {"name": "diversification_benefit", "weight": 0.20, "effective_weight": 0.20,
             "score": score, "is_na": False, "na_reason": None,
             "source": "prices", "sub_factors": {}},
            {"name": "liquidity_aum", "weight": 0.20, "effective_weight": 0.20,
             "score": score, "is_na": False, "na_reason": None,
             "source": "fundamentals", "sub_factors": {}},
        ],
    }


# ---------------------------------------------------------------------------
# Test 1 — No profile
# ---------------------------------------------------------------------------

class TestNoProfile:
    def test_returns_400_when_no_profile(self, client):
        resp = client.post("/api/v1/builder/generate", json={})
        assert resp.status_code == 400
        assert "profile" in resp.json()["detail"].lower()

    def test_error_message_mentions_onboarding(self, client):
        resp = client.post("/api/v1/builder/generate", json={})
        detail = resp.json()["detail"].lower()
        assert "risk level" in detail or "onboarding" in detail or "profile" in detail


# ---------------------------------------------------------------------------
# Test 2 — Profile without risk_level
# ---------------------------------------------------------------------------

class TestNoRiskLevel:
    def test_returns_400_when_no_risk_level(self, client):
        # Need to insert a profile without risk_level
        from app.db.session import get_db as _get_db
        db_gen = client.app.dependency_overrides[_get_db]()
        db = next(db_gen)
        db.add(UserProfile(name="No Level", risk_level=None))
        db.commit()
        try:
            next(db_gen)
        except StopIteration:
            pass

        resp = client.post("/api/v1/builder/generate", json={})
        assert resp.status_code == 400
        assert "risk level" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Test 3 — No cached scores
# ---------------------------------------------------------------------------

class TestNoCachedScores:
    def test_returns_400_when_no_scores(self, client):
        from app.db.session import get_db as _get_db
        db_gen = client.app.dependency_overrides[_get_db]()
        db = next(db_gen)
        db.add(UserProfile(risk_level=3, name="Test"))
        db.commit()
        try:
            next(db_gen)
        except StopIteration:
            pass

        resp = client.post("/api/v1/builder/generate", json={})
        assert resp.status_code == 400
        assert "score" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Test 4 — Returns 3 variants with valid data
# ---------------------------------------------------------------------------

class TestGenerateVariants:
    def test_returns_200_with_three_variants(self, seeded_client):
        resp = seeded_client.post("/api/v1/builder/generate", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["variants"]) == 3

    def test_variant_types(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        types = {v["variant_type"] for v in data["variants"]}
        assert types == {"core", "growth_tilt", "defensive_tilt"}

    def test_risk_level_snapshot_matches_profile(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        assert data["risk_level"] == 3
        assert data["risk_level_name"] == "Compass"
        for v in data["variants"]:
            assert v["risk_level_snapshot"] == 3

    def test_source_universe_is_full_universe(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        assert data["source_universe"] == "full_universe"
        for v in data["variants"]:
            assert v["source_universe"] == "full_universe"

    def test_asset_count_reported(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        assert data["asset_count_used"] == 12  # 8 stocks + 4 ETFs


# ---------------------------------------------------------------------------
# Test 5 — Required fields in variant response
# ---------------------------------------------------------------------------

class TestVariantFields:
    def test_holdings_present(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        for v in data["variants"]:
            assert "holdings" in v
            assert isinstance(v["holdings"], list)

    def test_holdings_have_required_fields(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        core = next(v for v in data["variants"] if v["variant_type"] == "core")
        if core["holdings"]:
            h = core["holdings"][0]
            assert "ticker" in h
            assert "asset_class" in h
            assert "weight" in h
            assert "score" in h

    def test_weights_sum_to_one(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        for v in data["variants"]:
            if v["holdings"]:
                total = sum(h["weight"] for h in v["holdings"])
                assert abs(total - 1.0) < 0.01, f"{v['variant_type']}: weights sum to {total}"

    def test_construction_log_present(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        for v in data["variants"]:
            assert "construction_log" in v
            assert isinstance(v["construction_log"], list)
            # At minimum: filter, rank, select steps
            steps = {entry.get("step") for entry in v["construction_log"]}
            assert "filter" in steps
            assert "rank" in steps
            assert "select" in steps

    def test_skip_log_present(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        for v in data["variants"]:
            assert "skip_log" in v
            assert isinstance(v["skip_log"], list)

    def test_warnings_present(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        for v in data["variants"]:
            assert "warnings" in v

    def test_constraints_summary_present(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        for v in data["variants"]:
            assert "constraints_summary" in v
            cs = v["constraints_summary"]
            assert "actual_positions" in cs
            assert "violations" in cs

    def test_generation_method_present(self, seeded_client):
        data = seeded_client.post("/api/v1/builder/generate", json={}).json()
        for v in data["variants"]:
            assert v["generation_method"] in (
                "risk_parity_full",
                "risk_parity_relaxed_1",
                "risk_parity_relaxed_2",
                "risk_parity_relaxed_3",
                "equal_weight_fallback",
            )


# ---------------------------------------------------------------------------
# Test 6 — Watchlist source
# ---------------------------------------------------------------------------

class TestWatchlistSource:
    def test_empty_watchlist_returns_400(self, seeded_client):
        # No watchlist items seeded → builder should reject with 400
        resp = seeded_client.post(
            "/api/v1/builder/generate",
            json={"source_universe": "watchlist"},
        )
        assert resp.status_code == 400
        detail = resp.json()["detail"].lower()
        assert "watchlist" in detail
        assert "empty" in detail

    def test_watchlist_with_items_returns_200(self, seeded_client):
        # Add a few scored tickers to the watchlist first
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        seeded_client.post("/api/v1/watchlist", json={"ticker": "MSFT"})
        seeded_client.post("/api/v1/watchlist", json={"ticker": "SPY"})

        resp = seeded_client.post(
            "/api/v1/builder/generate",
            json={"source_universe": "watchlist"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["source_universe"] == "watchlist"
        assert len(data["variants"]) == 3

    def test_watchlist_asset_count_limited_to_watchlist(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        seeded_client.post("/api/v1/watchlist", json={"ticker": "MSFT"})

        data = seeded_client.post(
            "/api/v1/builder/generate",
            json={"source_universe": "watchlist"},
        ).json()
        assert data["asset_count_used"] == 2

    def test_unknown_source_returns_400(self, seeded_client):
        resp = seeded_client.post(
            "/api/v1/builder/generate",
            json={"source_universe": "unknown_source"},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Test 8 — No yfinance in builder module
# ---------------------------------------------------------------------------

class TestNoYFinance:
    def test_builder_module_does_not_import_yfinance(self):
        import inspect
        import app.api.builder as builder_mod

        source = inspect.getsource(builder_mod)
        # Check that yfinance is not imported (not an import statement, comments are ok)
        import_lines = [
            line.strip() for line in source.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]
        for line in import_lines:
            assert "yfinance" not in line, f"builder.py must not import yfinance: {line}"

    def test_builder_module_does_not_call_scoring(self):
        import inspect
        import app.api.builder as builder_mod

        source = inspect.getsource(builder_mod)
        # Must not call scoring service or recompute scores
        assert "ScoringService" not in source
        assert "score_universe" not in source
        assert "score_batch" not in source


# ---------------------------------------------------------------------------
# Test 10 — No portfolio writes after generation
# ---------------------------------------------------------------------------

class TestNoPersistence:
    def test_saved_portfolio_table_empty_after_generate(self, seeded_client):
        seeded_client.post("/api/v1/builder/generate", json={})
        # Access DB to verify nothing was written
        from app.db.session import get_db as _get_db
        db_gen = seeded_client.app.dependency_overrides[_get_db]()
        db = next(db_gen)
        count = db.query(SavedPortfolio).count()
        try:
            next(db_gen)
        except StopIteration:
            pass
        assert count == 0, "generate must not write to saved_portfolio"

    def test_max_positions_respected(self, seeded_client):
        resp = seeded_client.post(
            "/api/v1/builder/generate",
            json={"max_positions": 8},
        )
        assert resp.status_code == 200
        data = resp.json()
        for v in data["variants"]:
            assert len(v["holdings"]) <= 8


# ---------------------------------------------------------------------------
# Test 11 — No forbidden routes added
# ---------------------------------------------------------------------------

class TestNoForbiddenRoutes:
    def test_no_export_route(self, client):
        assert client.get("/api/v1/export").status_code == 404

    def test_no_scoring_recompute_route(self, client):
        assert client.post("/api/v1/scores/recompute").status_code == 404
