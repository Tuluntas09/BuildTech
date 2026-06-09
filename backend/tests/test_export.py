"""
Backend tests for Task 14 — Portfolio JSON export.

Coverage:
  1. Export returns 404 for missing portfolio.
  2. Export schema_version = "1.0".
  3. Export source = "BuildTech".
  4. Export includes portfolio_name.
  5. Export includes risk_profile with level_id and level_name.
  6. Export includes variant_type.
  7. Export includes construction_context (source_universe, generation_method,
     correlation_relaxations_applied, constraints_applied, construction_log).
  8. Export includes data_freshness_at_export.
  9. Export includes holdings with ticker, asset_class, weight, score, score_breakdown.
 10. Export includes correlation_skips.
 11. Export metrics_snapshot is not_computed — no invented metrics.
 12. Export works for archived portfolio.
 13. Export works for draft portfolio.
 14. Export does not call yfinance.
 15. Export does not call scoring.
 16. Export does not call construction.
 17. Export does not write to database (saved_portfolio row count unchanged).
 18. Content-Disposition header present.
 19. Response is valid JSON.
"""

import json
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
from app.models.tables import PortfolioHolding, PortfolioSkipLog, SavedPortfolio


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override_get_db():
        db = Session()
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
    """Client with one saved portfolio pre-inserted (3 holdings, 1 skip entry)."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    db = Session()
    now = datetime(2026, 6, 8, 12, 0, 0)

    portfolio = SavedPortfolio(
        name="My Test Portfolio",
        variant_type="core",
        risk_level_snapshot=3,
        status="saved",
        source_universe="full_universe",
        generation_method="risk_parity_full",
        correlation_relaxations_applied=0,
        prices_freshness_at_save="cached",
        fundamentals_snapshot_date="2026-06-01",
        construction_log=[
            {"step": "filter", "assets_in": 12, "assets_out": 12},
            {"step": "rank", "top_n": 12},
            {"step": "select", "selected": 3},
        ],
        portfolio_metadata={
            "warnings": [],
            "constraints_summary": {
                "actual_positions": 3,
                "violations": [],
                "single_asset_max": 0.20,
                "min_positions": 8,
                "max_positions": 15,
            },
        },
        created_at=now,
        updated_at=now,
    )
    db.add(portfolio)
    db.flush()

    db.add(PortfolioHolding(
        portfolio_id=portfolio.id,
        ticker="AAPL",
        asset_class="stock",
        weight=0.12,
        score=85.0,
        score_breakdown={"asset_class": "stock", "factors": []},
    ))
    db.add(PortfolioHolding(
        portfolio_id=portfolio.id,
        ticker="MSFT",
        asset_class="stock",
        weight=0.10,
        score=78.0,
        score_breakdown={"asset_class": "stock", "factors": []},
    ))
    db.add(PortfolioHolding(
        portfolio_id=portfolio.id,
        ticker="SPY",
        asset_class="etf",
        weight=0.08,
        score=62.0,
        score_breakdown={"asset_class": "etf", "factors": []},
    ))

    db.add(PortfolioSkipLog(
        portfolio_id=portfolio.id,
        skipped_ticker="NVDA",
        skipped_asset_class="stock",
        reason="correlation_exceeded",
        threshold=0.75,
        actual_correlation=0.89,
        conflicts_with_ticker="AAPL",
        created_at=now,
    ))

    db.commit()
    portfolio_id = portfolio.id
    db.close()

    def override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app_instance = create_app()
    app_instance.dependency_overrides[get_db] = override_get_db
    with TestClient(app_instance) as c:
        yield c, portfolio_id
    Base.metadata.drop_all(engine)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _export(client_fixture, portfolio_id):
    return client_fixture.get(f"/api/v1/export/portfolios/{portfolio_id}")


# ---------------------------------------------------------------------------
# Test 1 — 404 for missing portfolio
# ---------------------------------------------------------------------------

class TestNotFound:
    def test_missing_portfolio_returns_404(self, client):
        resp = _export(client, 99999)
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Test 2–3 — schema_version and source
# ---------------------------------------------------------------------------

class TestTopLevelFields:
    def test_schema_version(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["schema_version"] == "1.0"

    def test_source_is_buildtech(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["source"] == "BuildTech"

    def test_exported_at_present(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert "exported_at" in doc
        assert "T" in doc["exported_at"]  # ISO8601 format

    def test_portfolio_id_present(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["portfolio_id"] == pid


# ---------------------------------------------------------------------------
# Test 4 — portfolio_name
# ---------------------------------------------------------------------------

class TestPortfolioName:
    def test_portfolio_name_correct(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["portfolio_name"] == "My Test Portfolio"

    def test_portfolio_status_present(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["portfolio_status"] == "saved"


# ---------------------------------------------------------------------------
# Test 5 — risk_profile
# ---------------------------------------------------------------------------

class TestRiskProfile:
    def test_risk_profile_level_id(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["risk_profile"]["level_id"] == 3

    def test_risk_profile_level_name(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["risk_profile"]["level_name"] == "Compass"

    def test_risk_profile_theme_null(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["risk_profile"]["theme"] is None

    def test_risk_name_mapping(self, seeded_client):
        c, pid = seeded_client
        # Level 3 → Compass is already tested; just verify the key exists
        doc = json.loads(_export(c, pid).content)
        assert "level_name" in doc["risk_profile"]


# ---------------------------------------------------------------------------
# Test 6 — variant_type
# ---------------------------------------------------------------------------

class TestVariantType:
    def test_variant_type_correct(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["variant_type"] == "core"


# ---------------------------------------------------------------------------
# Test 7 — construction_context
# ---------------------------------------------------------------------------

class TestConstructionContext:
    def test_construction_context_present(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        cc = doc["construction_context"]
        assert "source_universe" in cc
        assert "generation_method" in cc
        assert "correlation_relaxations_applied" in cc
        assert "constraints_applied" in cc
        assert "construction_log" in cc

    def test_source_universe(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["construction_context"]["source_universe"] == "full_universe"

    def test_generation_method(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["construction_context"]["generation_method"] == "risk_parity_full"

    def test_correlation_relaxations(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["construction_context"]["correlation_relaxations_applied"] == 0

    def test_construction_log_steps(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        log = doc["construction_context"]["construction_log"]
        assert isinstance(log, list)
        steps = {entry.get("step") for entry in log}
        assert "filter" in steps
        assert "rank" in steps
        assert "select" in steps

    def test_constraints_applied_from_metadata(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        ca = doc["construction_context"]["constraints_applied"]
        assert ca["single_asset_max"] == 0.20
        assert ca["min_positions"] == 8
        assert ca["max_positions"] == 15


# ---------------------------------------------------------------------------
# Test 8 — data_freshness_at_export
# ---------------------------------------------------------------------------

class TestDataFreshness:
    def test_data_freshness_present(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        df = doc["data_freshness_at_export"]
        assert "prices" in df
        assert "fundamentals_snapshot_date" in df

    def test_prices_freshness(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["data_freshness_at_export"]["prices"] == "cached"

    def test_fundamentals_snapshot_date(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert doc["data_freshness_at_export"]["fundamentals_snapshot_date"] == "2026-06-01"


# ---------------------------------------------------------------------------
# Test 9 — holdings
# ---------------------------------------------------------------------------

class TestHoldings:
    def test_holdings_count(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert len(doc["holdings"]) == 3

    def test_holdings_fields(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        for h in doc["holdings"]:
            assert "ticker" in h
            assert "asset_class" in h
            assert "weight" in h
            assert "score" in h
            assert "score_breakdown" in h

    def test_holdings_tickers(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        tickers = {h["ticker"] for h in doc["holdings"]}
        assert tickers == {"AAPL", "MSFT", "SPY"}

    def test_holdings_weights_preserved(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        weight_map = {h["ticker"]: h["weight"] for h in doc["holdings"]}
        assert abs(weight_map["AAPL"] - 0.12) < 1e-9

    def test_score_breakdown_present(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        aapl = next(h for h in doc["holdings"] if h["ticker"] == "AAPL")
        assert aapl["score_breakdown"]["asset_class"] == "stock"


# ---------------------------------------------------------------------------
# Test 10 — correlation_skips
# ---------------------------------------------------------------------------

class TestCorrelationSkips:
    def test_correlation_skips_count(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert len(doc["correlation_skips"]) == 1

    def test_correlation_skip_fields(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        skip = doc["correlation_skips"][0]
        assert skip["skipped_ticker"] == "NVDA"
        assert skip["reason"] == "correlation_exceeded"
        assert abs(skip["threshold"] - 0.75) < 1e-9
        assert abs(skip["actual_correlation"] - 0.89) < 1e-9
        assert skip["conflicts_with_ticker"] == "AAPL"

    def test_empty_skip_log(self, seeded_client):
        """A portfolio with no skips should export an empty list."""
        c, pid = seeded_client
        # Save a second portfolio with no skips
        resp = c.post("/api/v1/portfolios", json={
            "name": "No Skips Portfolio",
            "generation_method": "equal_weight_fallback",
            "holdings": [
                {"ticker": "SPY", "asset_class": "etf", "weight": 1.0, "score": 60.0},
            ],
            "skip_log": [],
        })
        assert resp.status_code == 201
        new_id = resp.json()["id"]
        doc = json.loads(c.get(f"/api/v1/export/portfolios/{new_id}").content)
        assert doc["correlation_skips"] == []


# ---------------------------------------------------------------------------
# Test 11 — metrics_snapshot not_computed
# ---------------------------------------------------------------------------

class TestMetricsSnapshot:
    def test_metrics_snapshot_present(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        assert "metrics_snapshot" in doc

    def test_metrics_not_invented(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        ms = doc["metrics_snapshot"]
        # Must be None OR {"status": "not_computed"} — no invented numbers
        assert ms is None or (isinstance(ms, dict) and ms.get("status") == "not_computed")

    def test_metrics_no_return_values(self, seeded_client):
        c, pid = seeded_client
        doc = json.loads(_export(c, pid).content)
        ms = doc["metrics_snapshot"]
        # Confirm no numeric metric fields were invented
        if isinstance(ms, dict):
            forbidden_keys = {
                "sharpe_ratio", "volatility", "max_drawdown",
                "cagr", "annualized_return", "total_return",
            }
            assert not (forbidden_keys & set(ms.keys()))


# ---------------------------------------------------------------------------
# Test 12 — Export works for archived portfolio
# ---------------------------------------------------------------------------

class TestArchivedExport:
    def test_archived_portfolio_exportable(self, seeded_client):
        c, pid = seeded_client
        # Archive the portfolio first
        c.patch(f"/api/v1/portfolios/{pid}", json={"status": "archived"})
        resp = c.get(f"/api/v1/export/portfolios/{pid}")
        assert resp.status_code == 200
        doc = json.loads(resp.content)
        assert doc["portfolio_status"] == "archived"
        assert len(doc["holdings"]) == 3

    def test_draft_portfolio_exportable(self, seeded_client):
        c, pid = seeded_client
        # Save a draft portfolio
        resp = c.post("/api/v1/portfolios", json={
            "name": "Draft Export Test",
            "status": "draft",
            "generation_method": "risk_parity_full",
            "holdings": [
                {"ticker": "AAPL", "asset_class": "stock", "weight": 1.0, "score": 85.0},
            ],
        })
        assert resp.status_code == 201
        draft_id = resp.json()["id"]
        resp2 = c.get(f"/api/v1/export/portfolios/{draft_id}")
        assert resp2.status_code == 200
        doc = json.loads(resp2.content)
        assert doc["portfolio_status"] == "draft"


# ---------------------------------------------------------------------------
# Test 13–16 — Module isolation
# ---------------------------------------------------------------------------

class TestModuleIsolation:
    def test_export_module_does_not_import_yfinance(self):
        import inspect
        import app.api.export as export_mod

        source = inspect.getsource(export_mod)
        import_lines = [
            line.strip()
            for line in source.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]
        for line in import_lines:
            assert "yfinance" not in line, f"export.py must not import yfinance: {line}"

    def test_export_module_does_not_import_scoring(self):
        import inspect
        import app.api.export as export_mod

        source = inspect.getsource(export_mod)
        import_lines = [
            line.strip()
            for line in source.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]
        for line in import_lines:
            assert "scoring" not in line, f"export.py must not import scoring: {line}"

    def test_export_module_does_not_import_construction(self):
        import inspect
        import app.api.export as export_mod

        source = inspect.getsource(export_mod)
        import_lines = [
            line.strip()
            for line in source.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]
        for line in import_lines:
            assert "construction" not in line, (
                f"export.py must not import construction: {line}"
            )

    def test_export_does_not_write_to_database(self, seeded_client):
        c, pid = seeded_client
        # Count saved_portfolio rows before and after export
        before_resp = c.get("/api/v1/portfolios?status=all&limit=100")
        before_count = before_resp.json()["total"]

        c.get(f"/api/v1/export/portfolios/{pid}")

        after_resp = c.get("/api/v1/portfolios?status=all&limit=100")
        after_count = after_resp.json()["total"]

        assert before_count == after_count, "Export must not write new rows"


# ---------------------------------------------------------------------------
# Test 17 — Response format
# ---------------------------------------------------------------------------

class TestResponseFormat:
    def test_content_type_is_json(self, seeded_client):
        c, pid = seeded_client
        resp = _export(c, pid)
        assert resp.status_code == 200
        assert "application/json" in resp.headers.get("content-type", "")

    def test_content_disposition_header(self, seeded_client):
        c, pid = seeded_client
        resp = _export(c, pid)
        disposition = resp.headers.get("content-disposition", "")
        assert "attachment" in disposition
        assert "buildtech_" in disposition
        assert ".json" in disposition

    def test_response_is_valid_json(self, seeded_client):
        c, pid = seeded_client
        resp = _export(c, pid)
        # Should not raise
        doc = json.loads(resp.content)
        assert isinstance(doc, dict)

    def test_no_export_route_in_builder(self, seeded_client):
        """Export action must NOT be reachable via builder routes."""
        c, _ = seeded_client
        # Builder has no export concept
        resp = c.get("/api/v1/builder/export")
        assert resp.status_code == 404
