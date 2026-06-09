"""
Backend tests for Task 13 — Portfolio persistence and lifecycle.

Coverage:
  1. POST /api/v1/portfolios creates saved_portfolio row.
  2. POST creates portfolio_holding rows.
  3. POST creates portfolio_skip_log rows.
  4. Missing/empty holdings rejected with 400.
  5. Invalid status rejected.
  6. GET /api/v1/portfolios defaults to saved portfolios only.
  7. GET supports status filter: archived, draft, all.
  8. GET /api/v1/portfolios/{id} returns holdings and logs.
  9. PATCH archives a saved portfolio (saved → archived).
 10. PATCH unarchives back to saved (archived → saved).
 11. Archived portfolio remains readable (GET still works).
 12. Invalid lifecycle transition rejected (e.g. draft → archived).
 13. 404 for unknown portfolio.
 14. Save endpoint module does not import scoring.
 15. Save endpoint module does not import yfinance.
 16. Save endpoint module does not import construction module.
 17. Builder generate does not write to saved_portfolio.
 18. Pagination: limit/offset work correctly.
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
from app.models.tables import SavedPortfolio, PortfolioHolding, PortfolioSkipLog


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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MINIMAL_SAVE = {
    "name": "Test Portfolio",
    "variant_type": "core",
    "risk_level_snapshot": 3,
    "source_universe": "full_universe",
    "generation_method": "risk_parity_full",
    "correlation_relaxations_applied": 0,
    "prices_freshness_at_save": "cached",
    "fundamentals_snapshot_date": "2026-06-01",
    "construction_log": [
        {"step": "filter", "assets_in": 12, "assets_out": 12},
        {"step": "rank", "top_n": 12},
        {"step": "select", "selected": 10},
    ],
    "holdings": [
        {"ticker": "AAPL", "asset_class": "stock", "weight": 0.12, "score": 85.0,
         "score_breakdown": {"asset_class": "stock", "factors": []}},
        {"ticker": "MSFT", "asset_class": "stock", "weight": 0.10, "score": 78.0,
         "score_breakdown": {"asset_class": "stock", "factors": []}},
        {"ticker": "SPY", "asset_class": "etf", "weight": 0.08, "score": 62.0,
         "score_breakdown": {"asset_class": "etf", "factors": []}},
    ],
    "skip_log": [
        {
            "skipped_ticker": "NVDA",
            "skipped_asset_class": "stock",
            "reason": "correlation_exceeded",
            "threshold": 0.75,
            "actual_correlation": 0.89,
            "conflicts_with_ticker": "AAPL",
        }
    ],
}


def _save(client_fixture, overrides=None):
    body = {**_MINIMAL_SAVE, **(overrides or {})}
    return client_fixture.post("/api/v1/portfolios", json=body)


# ---------------------------------------------------------------------------
# Test 1 — POST creates saved_portfolio
# ---------------------------------------------------------------------------

class TestSavePortfolio:
    def test_returns_201(self, client):
        resp = _save(client)
        assert resp.status_code == 201

    def test_response_shape(self, client):
        data = _save(client).json()
        assert "id" in data
        assert data["name"] == "Test Portfolio"
        assert data["variant_type"] == "core"
        assert data["status"] == "saved"
        assert data["generation_method"] == "risk_parity_full"
        assert data["holding_count"] == 3

    def test_portfolio_row_created(self, client):
        data = _save(client).json()
        portfolio_id = data["id"]
        resp = client.get(f"/api/v1/portfolios/{portfolio_id}")
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["name"] == "Test Portfolio"
        assert detail["risk_level_snapshot"] == 3
        assert detail["source_universe"] == "full_universe"
        assert detail["generation_method"] == "risk_parity_full"

    def test_prices_freshness_defaults_to_cached(self, client):
        body = {**_MINIMAL_SAVE}
        del body["prices_freshness_at_save"]
        resp = client.post("/api/v1/portfolios", json=body)
        assert resp.status_code == 201
        assert resp.json()["prices_freshness_at_save"] == "cached"


# ---------------------------------------------------------------------------
# Test 2 — POST creates portfolio_holding rows
# ---------------------------------------------------------------------------

class TestHoldingsPersistence:
    def test_holdings_in_detail(self, client):
        data = _save(client).json()
        detail = client.get(f"/api/v1/portfolios/{data['id']}").json()
        assert len(detail["holdings"]) == 3

    def test_holding_fields(self, client):
        data = _save(client).json()
        detail = client.get(f"/api/v1/portfolios/{data['id']}").json()
        tickers = {h["ticker"] for h in detail["holdings"]}
        assert tickers == {"AAPL", "MSFT", "SPY"}
        for h in detail["holdings"]:
            assert "weight" in h
            assert "score" in h
            assert "asset_class" in h
            assert "score_breakdown" in h

    def test_weights_preserved(self, client):
        data = _save(client).json()
        detail = client.get(f"/api/v1/portfolios/{data['id']}").json()
        weight_map = {h["ticker"]: h["weight"] for h in detail["holdings"]}
        assert abs(weight_map["AAPL"] - 0.12) < 1e-9
        assert abs(weight_map["MSFT"] - 0.10) < 1e-9

    def test_score_breakdown_preserved(self, client):
        data = _save(client).json()
        detail = client.get(f"/api/v1/portfolios/{data['id']}").json()
        aapl = next(h for h in detail["holdings"] if h["ticker"] == "AAPL")
        assert aapl["score_breakdown"]["asset_class"] == "stock"


# ---------------------------------------------------------------------------
# Test 3 — POST creates portfolio_skip_log rows
# ---------------------------------------------------------------------------

class TestSkipLogPersistence:
    def test_skip_log_in_detail(self, client):
        data = _save(client).json()
        detail = client.get(f"/api/v1/portfolios/{data['id']}").json()
        assert len(detail["skip_log"]) == 1

    def test_skip_log_fields(self, client):
        data = _save(client).json()
        detail = client.get(f"/api/v1/portfolios/{data['id']}").json()
        entry = detail["skip_log"][0]
        assert entry["skipped_ticker"] == "NVDA"
        assert entry["reason"] == "correlation_exceeded"
        assert abs(entry["threshold"] - 0.75) < 1e-9
        assert abs(entry["actual_correlation"] - 0.89) < 1e-9
        assert entry["conflicts_with_ticker"] == "AAPL"

    def test_no_skip_log_when_empty(self, client):
        body = {**_MINIMAL_SAVE, "skip_log": []}
        data = client.post("/api/v1/portfolios", json=body).json()
        detail = client.get(f"/api/v1/portfolios/{data['id']}").json()
        assert detail["skip_log"] == []


# ---------------------------------------------------------------------------
# Test 4 — Validation: empty holdings rejected
# ---------------------------------------------------------------------------

class TestHoldingsValidation:
    def test_empty_holdings_returns_400(self, client):
        resp = _save(client, {"holdings": []})
        assert resp.status_code == 400
        assert "holding" in resp.json()["detail"].lower()

    def test_missing_holdings_returns_422(self, client):
        body = {**_MINIMAL_SAVE}
        del body["holdings"]
        resp = client.post("/api/v1/portfolios", json=body)
        # Pydantic will default to empty list, then our validator catches it
        # OR raise 422 if holdings is required — depends on field default
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Test 5 — Validation: invalid status
# ---------------------------------------------------------------------------

class TestStatusValidation:
    def test_invalid_status_returns_400(self, client):
        resp = _save(client, {"status": "unknown"})
        assert resp.status_code == 400

    def test_draft_status_accepted(self, client):
        resp = _save(client, {"status": "draft"})
        assert resp.status_code == 201
        assert resp.json()["status"] == "draft"


# ---------------------------------------------------------------------------
# Test 6 — GET /api/v1/portfolios defaults to saved
# ---------------------------------------------------------------------------

class TestListPortfolios:
    def test_default_returns_saved_only(self, client):
        _save(client, {"status": "saved", "name": "Saved One"})
        _save(client, {"status": "draft", "name": "Draft One"})
        resp = client.get("/api/v1/portfolios")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Saved One"

    def test_response_shape(self, client):
        _save(client)
        data = client.get("/api/v1/portfolios").json()
        assert "items" in data
        assert "total" in data
        assert "limit" in data
        assert "offset" in data

    def test_empty_list(self, client):
        data = client.get("/api/v1/portfolios").json()
        assert data["items"] == []
        assert data["total"] == 0


# ---------------------------------------------------------------------------
# Test 7 — GET with status filter
# ---------------------------------------------------------------------------

class TestListStatusFilter:
    def test_filter_archived(self, client):
        save_resp = _save(client, {"name": "ToArchive"})
        portfolio_id = save_resp.json()["id"]
        client.patch(f"/api/v1/portfolios/{portfolio_id}", json={"status": "archived"})

        data = client.get("/api/v1/portfolios?status=archived").json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "ToArchive"

    def test_filter_draft(self, client):
        _save(client, {"status": "draft", "name": "Draft Portfolio"})
        data = client.get("/api/v1/portfolios?status=draft").json()
        assert data["total"] == 1

    def test_filter_all(self, client):
        _save(client, {"status": "saved", "name": "S1"})
        _save(client, {"status": "draft", "name": "D1"})
        save_resp = _save(client, {"name": "ToArchive"})
        client.patch(f"/api/v1/portfolios/{save_resp.json()['id']}", json={"status": "archived"})

        data = client.get("/api/v1/portfolios?status=all").json()
        assert data["total"] == 3

    def test_invalid_status_filter_returns_400(self, client):
        resp = client.get("/api/v1/portfolios?status=invalid")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Test 8 — GET /api/v1/portfolios/{id} detail
# ---------------------------------------------------------------------------

class TestPortfolioDetail:
    def test_returns_full_detail(self, client):
        data = _save(client).json()
        detail = client.get(f"/api/v1/portfolios/{data['id']}").json()
        assert detail["id"] == data["id"]
        assert "holdings" in detail
        assert "skip_log" in detail
        assert "construction_log" in detail

    def test_construction_log_preserved(self, client):
        data = _save(client).json()
        detail = client.get(f"/api/v1/portfolios/{data['id']}").json()
        steps = {entry.get("step") for entry in detail["construction_log"]}
        assert "filter" in steps
        assert "rank" in steps
        assert "select" in steps

    def test_404_for_unknown(self, client):
        resp = client.get("/api/v1/portfolios/99999")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test 9 & 10 — Archive and unarchive
# ---------------------------------------------------------------------------

class TestLifecycle:
    def test_archive_changes_status(self, client):
        save_resp = _save(client)
        portfolio_id = save_resp.json()["id"]
        resp = client.patch(
            f"/api/v1/portfolios/{portfolio_id}", json={"status": "archived"}
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "archived"

    def test_unarchive_changes_status_to_saved(self, client):
        save_resp = _save(client)
        portfolio_id = save_resp.json()["id"]
        client.patch(f"/api/v1/portfolios/{portfolio_id}", json={"status": "archived"})
        resp = client.patch(
            f"/api/v1/portfolios/{portfolio_id}", json={"status": "saved"}
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "saved"

    def test_draft_to_saved(self, client):
        save_resp = _save(client, {"status": "draft"})
        portfolio_id = save_resp.json()["id"]
        resp = client.patch(
            f"/api/v1/portfolios/{portfolio_id}", json={"status": "saved"}
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "saved"


# ---------------------------------------------------------------------------
# Test 11 — Archived portfolio remains readable
# ---------------------------------------------------------------------------

class TestArchivedReadable:
    def test_archived_portfolio_accessible_via_get(self, client):
        save_resp = _save(client)
        portfolio_id = save_resp.json()["id"]
        client.patch(f"/api/v1/portfolios/{portfolio_id}", json={"status": "archived"})

        detail = client.get(f"/api/v1/portfolios/{portfolio_id}").json()
        assert detail["status"] == "archived"
        assert len(detail["holdings"]) == 3

    def test_archived_appears_in_all_filter(self, client):
        save_resp = _save(client)
        client.patch(
            f"/api/v1/portfolios/{save_resp.json()['id']}", json={"status": "archived"}
        )
        data = client.get("/api/v1/portfolios?status=all").json()
        statuses = {item["status"] for item in data["items"]}
        assert "archived" in statuses


# ---------------------------------------------------------------------------
# Test 12 — Invalid lifecycle transitions
# ---------------------------------------------------------------------------

class TestInvalidTransitions:
    def test_draft_to_archived_rejected(self, client):
        save_resp = _save(client, {"status": "draft"})
        portfolio_id = save_resp.json()["id"]
        resp = client.patch(
            f"/api/v1/portfolios/{portfolio_id}", json={"status": "archived"}
        )
        assert resp.status_code == 400

    def test_saved_to_draft_rejected(self, client):
        save_resp = _save(client)
        portfolio_id = save_resp.json()["id"]
        resp = client.patch(
            f"/api/v1/portfolios/{portfolio_id}", json={"status": "draft"}
        )
        assert resp.status_code == 400

    def test_patch_unknown_portfolio_returns_404(self, client):
        resp = client.patch("/api/v1/portfolios/99999", json={"status": "archived"})
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test 13 — Module isolation (no scoring, construction, yfinance)
# ---------------------------------------------------------------------------

class TestModuleIsolation:
    def test_portfolios_module_does_not_import_yfinance(self):
        import inspect
        import app.api.portfolios as portfolios_mod

        source = inspect.getsource(portfolios_mod)
        import_lines = [
            line.strip()
            for line in source.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]
        for line in import_lines:
            assert "yfinance" not in line, f"portfolios.py must not import yfinance: {line}"

    def test_portfolios_module_does_not_import_scoring(self):
        import inspect
        import app.api.portfolios as portfolios_mod

        source = inspect.getsource(portfolios_mod)
        import_lines = [
            line.strip()
            for line in source.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]
        for line in import_lines:
            assert "scoring" not in line, f"portfolios.py must not import scoring: {line}"

    def test_portfolios_module_does_not_import_construction(self):
        import inspect
        import app.api.portfolios as portfolios_mod

        source = inspect.getsource(portfolios_mod)
        import_lines = [
            line.strip()
            for line in source.splitlines()
            if line.strip().startswith("import ") or line.strip().startswith("from ")
        ]
        for line in import_lines:
            assert "construction" not in line, (
                f"portfolios.py must not import construction: {line}"
            )


# ---------------------------------------------------------------------------
# Test 14 — Builder generate does NOT write to saved_portfolio
# ---------------------------------------------------------------------------

class TestBuilderDoesNotPersist:
    def test_builder_generate_does_not_write_portfolio(self, client):
        """Generating portfolios must not auto-persist to saved_portfolio."""
        from app.models.tables import AssetScoreCache, UserProfile

        db_gen = client.app.dependency_overrides[get_db]()
        db = next(db_gen)
        db.add(UserProfile(risk_level=3, name="Test"))

        stock_tickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "JPM", "JNJ"]
        for i, ticker in enumerate(stock_tickers):
            score = 80.0 - i * 3.0
            db.add(AssetScoreCache(
                ticker=ticker,
                score_value=score,
                breakdown={
                    "asset_class": "stock", "score_value": score,
                    "has_missing_factors": False,
                    "fundamentals_snapshot_date": "2026-06-01",
                    "prices_computed_at": "2026-06-08T10:00:00",
                    "factors": [],
                },
                fundamentals_snapshot_date="2026-06-01",
                prices_computed_at=datetime(2026, 6, 8),
            ))
        for i, ticker in enumerate(["SPY", "QQQ", "IVV", "VTI"]):
            score = 70.0 - i * 2.0
            db.add(AssetScoreCache(
                ticker=ticker,
                score_value=score,
                breakdown={
                    "asset_class": "etf", "score_value": score,
                    "has_missing_factors": False,
                    "fundamentals_snapshot_date": None,
                    "prices_computed_at": "2026-06-08T10:00:00",
                    "factors": [],
                },
                fundamentals_snapshot_date=None,
                prices_computed_at=datetime(2026, 6, 8),
            ))
        db.commit()
        try:
            next(db_gen)
        except StopIteration:
            pass

        client.post("/api/v1/builder/generate", json={})

        db_gen2 = client.app.dependency_overrides[get_db]()
        db2 = next(db_gen2)
        count = db2.query(SavedPortfolio).count()
        try:
            next(db_gen2)
        except StopIteration:
            pass

        assert count == 0, "Builder generate must not auto-write to saved_portfolio"


# ---------------------------------------------------------------------------
# Test 15 — Pagination
# ---------------------------------------------------------------------------

class TestPagination:
    def test_limit(self, client):
        for i in range(5):
            _save(client, {"name": f"Portfolio {i}"})

        data = client.get("/api/v1/portfolios?limit=2&status=saved").json()
        assert len(data["items"]) == 2
        assert data["total"] == 5

    def test_offset(self, client):
        for i in range(5):
            _save(client, {"name": f"Portfolio {i}"})

        page1 = client.get("/api/v1/portfolios?limit=2&offset=0&status=saved").json()
        page2 = client.get("/api/v1/portfolios?limit=2&offset=2&status=saved").json()
        ids1 = {item["id"] for item in page1["items"]}
        ids2 = {item["id"] for item in page2["items"]}
        assert len(ids1 & ids2) == 0
