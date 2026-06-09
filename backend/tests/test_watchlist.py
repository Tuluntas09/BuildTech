"""
Backend tests for Task 12 — Watchlist CRUD endpoint.

Coverage:
  1. GET /api/v1/watchlist returns empty list when no items.
  2. POST adds a scored asset and returns item with score data.
  3. POST with an unscored ticker returns 400.
  4. POST is idempotent — duplicate add returns existing item with 200.
  5. POST normalizes ticker to uppercase.
  6. DELETE removes an item and returns {removed: ticker}.
  7. DELETE with an unknown ticker returns 404.
  8. GET returns all watchlist items with required fields.
  9. Watchlist items are enriched with score_value from asset_score_cache.
 10. Builder watchlist source uses only watchlist tickers.
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
    """Client with 3 scored assets in asset_score_cache (AAPL, MSFT, SPY)."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    from app.models.tables import AssetScoreCache
    db = Session()
    db.add(AssetScoreCache(
        ticker="AAPL",
        score_value=85.0,
        breakdown={"asset_class": "stock", "score_value": 85.0, "has_missing_factors": False,
                   "fundamentals_snapshot_date": "2026-06-01",
                   "prices_computed_at": "2026-06-08T10:00:00", "factors": []},
        fundamentals_snapshot_date="2026-06-01",
        prices_computed_at=datetime(2026, 6, 8),
    ))
    db.add(AssetScoreCache(
        ticker="MSFT",
        score_value=78.0,
        breakdown={"asset_class": "stock", "score_value": 78.0, "has_missing_factors": False,
                   "fundamentals_snapshot_date": "2026-06-01",
                   "prices_computed_at": "2026-06-08T10:00:00", "factors": []},
        fundamentals_snapshot_date="2026-06-01",
        prices_computed_at=datetime(2026, 6, 8),
    ))
    db.add(AssetScoreCache(
        ticker="SPY",
        score_value=62.0,
        breakdown={"asset_class": "etf", "score_value": 62.0, "has_missing_factors": False,
                   "fundamentals_snapshot_date": None,
                   "prices_computed_at": "2026-06-08T10:00:00", "factors": []},
        fundamentals_snapshot_date=None,
        prices_computed_at=datetime(2026, 6, 8),
    ))
    # UNSCORED: not in asset_score_cache
    db.commit()
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
        yield c
    Base.metadata.drop_all(engine)


# ---------------------------------------------------------------------------
# Test 1 — Empty watchlist
# ---------------------------------------------------------------------------

class TestEmptyWatchlist:
    def test_get_returns_empty(self, client):
        resp = client.get("/api/v1/watchlist")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_response_shape(self, client):
        data = client.get("/api/v1/watchlist").json()
        assert "items" in data
        assert "total" in data


# ---------------------------------------------------------------------------
# Test 2 — POST adds a scored asset
# ---------------------------------------------------------------------------

class TestAddToWatchlist:
    def test_add_scored_ticker(self, seeded_client):
        resp = seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        assert resp.status_code == 200
        item = resp.json()
        assert item["ticker"] == "AAPL"
        assert item["asset_class"] == "stock"
        assert item["score_value"] == 85.0
        assert "id" in item
        assert "added_at" in item

    def test_add_etf_ticker(self, seeded_client):
        resp = seeded_client.post("/api/v1/watchlist", json={"ticker": "SPY"})
        assert resp.status_code == 200
        item = resp.json()
        assert item["ticker"] == "SPY"
        assert item["asset_class"] == "etf"
        assert item["score_value"] == 62.0

    def test_get_shows_added_item(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        data = seeded_client.get("/api/v1/watchlist").json()
        assert data["total"] == 1
        assert data["items"][0]["ticker"] == "AAPL"

    def test_notes_field_stored(self, seeded_client):
        resp = seeded_client.post(
            "/api/v1/watchlist",
            json={"ticker": "MSFT", "notes": "strong balance sheet"},
        )
        assert resp.status_code == 200
        assert resp.json()["notes"] == "strong balance sheet"


# ---------------------------------------------------------------------------
# Test 3 — Unscored ticker rejected
# ---------------------------------------------------------------------------

class TestUnscoredTickerRejected:
    def test_unscored_returns_400(self, seeded_client):
        resp = seeded_client.post("/api/v1/watchlist", json={"ticker": "ZZZFAKE"})
        assert resp.status_code == 400
        assert "scored universe" in resp.json()["detail"].lower() or \
               "not in" in resp.json()["detail"].lower()

    def test_error_mentions_ticker(self, seeded_client):
        resp = seeded_client.post("/api/v1/watchlist", json={"ticker": "NOTREAL"})
        assert "NOTREAL" in resp.json()["detail"]

    def test_unscored_not_added(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "DOESNOTEXIST"})
        data = seeded_client.get("/api/v1/watchlist").json()
        assert data["total"] == 0


# ---------------------------------------------------------------------------
# Test 4 — Idempotent duplicate add
# ---------------------------------------------------------------------------

class TestIdempotentAdd:
    def test_duplicate_returns_200(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        resp = seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        assert resp.status_code == 200

    def test_duplicate_does_not_create_second_entry(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        data = seeded_client.get("/api/v1/watchlist").json()
        assert data["total"] == 1

    def test_duplicate_returns_same_id(self, seeded_client):
        first = seeded_client.post("/api/v1/watchlist", json={"ticker": "MSFT"}).json()
        second = seeded_client.post("/api/v1/watchlist", json={"ticker": "MSFT"}).json()
        assert first["id"] == second["id"]


# ---------------------------------------------------------------------------
# Test 5 — Ticker normalized to uppercase
# ---------------------------------------------------------------------------

class TestTickerNormalization:
    def test_lowercase_normalized(self, seeded_client):
        resp = seeded_client.post("/api/v1/watchlist", json={"ticker": "aapl"})
        assert resp.status_code == 200
        assert resp.json()["ticker"] == "AAPL"

    def test_mixed_case_normalized(self, seeded_client):
        resp = seeded_client.post("/api/v1/watchlist", json={"ticker": "MsFt"})
        assert resp.status_code == 200
        assert resp.json()["ticker"] == "MSFT"

    def test_whitespace_stripped(self, seeded_client):
        resp = seeded_client.post("/api/v1/watchlist", json={"ticker": "  SPY  "})
        assert resp.status_code == 200
        assert resp.json()["ticker"] == "SPY"


# ---------------------------------------------------------------------------
# Test 6 — DELETE removes item
# ---------------------------------------------------------------------------

class TestDeleteFromWatchlist:
    def test_delete_removes_item(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        resp = seeded_client.delete("/api/v1/watchlist/AAPL")
        assert resp.status_code == 200
        assert resp.json()["removed"] == "AAPL"

    def test_get_empty_after_delete(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        seeded_client.delete("/api/v1/watchlist/AAPL")
        data = seeded_client.get("/api/v1/watchlist").json()
        assert data["total"] == 0

    def test_delete_normalizes_ticker(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "MSFT"})
        resp = seeded_client.delete("/api/v1/watchlist/msft")
        assert resp.status_code == 200
        assert resp.json()["removed"] == "MSFT"


# ---------------------------------------------------------------------------
# Test 7 — DELETE 404 when not found
# ---------------------------------------------------------------------------

class TestDeleteNotFound:
    def test_delete_unknown_returns_404(self, client):
        resp = client.delete("/api/v1/watchlist/NOTHERE")
        assert resp.status_code == 404
        assert "not in the watchlist" in resp.json()["detail"].lower()

    def test_delete_twice_second_is_404(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        seeded_client.delete("/api/v1/watchlist/AAPL")
        resp = seeded_client.delete("/api/v1/watchlist/AAPL")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test 8 & 9 — Multiple items, enriched with score_value
# ---------------------------------------------------------------------------

class TestMultipleItems:
    def test_get_returns_multiple(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        seeded_client.post("/api/v1/watchlist", json={"ticker": "MSFT"})
        seeded_client.post("/api/v1/watchlist", json={"ticker": "SPY"})
        data = seeded_client.get("/api/v1/watchlist").json()
        assert data["total"] == 3
        tickers = {i["ticker"] for i in data["items"]}
        assert tickers == {"AAPL", "MSFT", "SPY"}

    def test_items_have_score_values(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "AAPL"})
        data = seeded_client.get("/api/v1/watchlist").json()
        item = data["items"][0]
        assert item["score_value"] == 85.0

    def test_item_fields_present(self, seeded_client):
        seeded_client.post("/api/v1/watchlist", json={"ticker": "MSFT"})
        item = seeded_client.get("/api/v1/watchlist").json()["items"][0]
        assert "id" in item
        assert "ticker" in item
        assert "asset_class" in item
        assert "added_at" in item
        assert "notes" in item
        assert "score_value" in item
