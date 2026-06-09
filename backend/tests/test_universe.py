"""
Backend tests for Task 10 — Universe Explorer endpoint.

Coverage:
  1. GET /api/v1/universe returns empty list when cache is empty.
  2. Returns cached scored assets.
  3. Search by ticker works (case-insensitive substring).
  4. Asset class filter works (extracted from breakdown JSON).
  5. Sorting by score works (desc and asc).
  6. Sorting by ticker works.
  7. Pagination (limit/offset) works.
  8. Breakdown JSON is returned in each item.
  9. has_missing_factors flag is derived from breakdown.
 10. Endpoint does not expose scoring/construction/yfinance routes.
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
# Fixture
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
# Helpers — seed cache rows
# ---------------------------------------------------------------------------

def _make_breakdown(
    asset_class: str,
    score_value: float,
    has_missing: bool = False,
    factor_name: str = "momentum",
    factor_source: str = "prices",
) -> dict:
    return {
        "asset_class": asset_class,
        "score_value": score_value,
        "has_missing_factors": has_missing,
        "fundamentals_snapshot_date": "2026-06-01",
        "prices_computed_at": "2026-06-08T10:00:00",
        "factors": [
            {
                "name": factor_name,
                "weight": 1.0,
                "effective_weight": 1.0,
                "score": score_value,
                "is_na": False,
                "na_reason": None,
                "source": factor_source,
                "sub_factors": {},
            }
        ],
    }


def _seed(client_fixture, rows: list[dict]) -> None:
    """Insert raw rows into asset_score_cache via the test DB session."""
    # Access the engine through the override
    from app.models.tables import AssetScoreCache

    # Use the dependency override to get a session
    app_instance = client_fixture.app
    db_gen = app_instance.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        for row in rows:
            db.add(AssetScoreCache(**row))
        db.commit()
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


# Simpler seed approach using a separate engine fixture
@pytest.fixture()
def populated_client():
    """Client fixture pre-seeded with 5 scored assets."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    # Seed data
    from app.models.tables import AssetScoreCache
    db = Session()
    db.add(AssetScoreCache(
        ticker="AAPL",
        score_value=85.0,
        breakdown=_make_breakdown("stock", 85.0),
        fundamentals_snapshot_date="2026-06-01",
        prices_computed_at=datetime(2026, 6, 8),
    ))
    db.add(AssetScoreCache(
        ticker="MSFT",
        score_value=78.0,
        breakdown=_make_breakdown("stock", 78.0),
        fundamentals_snapshot_date="2026-06-01",
        prices_computed_at=datetime(2026, 6, 8),
    ))
    db.add(AssetScoreCache(
        ticker="SPY",
        score_value=62.0,
        breakdown=_make_breakdown("etf", 62.0),
        fundamentals_snapshot_date=None,
        prices_computed_at=datetime(2026, 6, 8),
    ))
    db.add(AssetScoreCache(
        ticker="QQQ",
        score_value=70.0,
        breakdown=_make_breakdown("etf", 70.0, has_missing=True),
        fundamentals_snapshot_date=None,
        prices_computed_at=datetime(2026, 6, 8),
    ))
    db.add(AssetScoreCache(
        ticker="GOOGL",
        score_value=None,
        breakdown=None,
        fundamentals_snapshot_date=None,
        prices_computed_at=None,
    ))
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
# Test 1 — Empty cache
# ---------------------------------------------------------------------------

class TestEmptyCache:
    def test_returns_empty_list(self, client):
        resp = client.get("/api/v1/universe")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_empty_respects_limit_offset_shape(self, client):
        resp = client.get("/api/v1/universe?limit=10&offset=0")
        assert resp.status_code == 200
        data = resp.json()
        assert "limit" in data
        assert "offset" in data
        assert data["limit"] == 10
        assert data["offset"] == 0


# ---------------------------------------------------------------------------
# Test 2 — Returns cached scored assets
# ---------------------------------------------------------------------------

class TestCachedAssets:
    def test_returns_all_rows(self, populated_client):
        resp = populated_client.get("/api/v1/universe?limit=100")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        tickers = {item["ticker"] for item in data["items"]}
        assert tickers == {"AAPL", "MSFT", "SPY", "QQQ", "GOOGL"}

    def test_item_shape(self, populated_client):
        resp = populated_client.get("/api/v1/universe?search=AAPL")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["ticker"] == "AAPL"
        assert item["score_value"] == 85.0
        assert item["asset_class"] == "stock"
        assert "breakdown" in item
        assert "fundamentals_snapshot_date" in item
        assert "prices_computed_at" in item

    def test_null_score_row_included(self, populated_client):
        resp = populated_client.get("/api/v1/universe?search=GOOGL")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["ticker"] == "GOOGL"
        assert item["score_value"] is None
        assert item["asset_class"] is None
        assert item["breakdown"] is None


# ---------------------------------------------------------------------------
# Test 3 — Search by ticker
# ---------------------------------------------------------------------------

class TestTickerSearch:
    def test_exact_match(self, populated_client):
        resp = populated_client.get("/api/v1/universe?search=SPY")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["ticker"] == "SPY"

    def test_case_insensitive(self, populated_client):
        resp = populated_client.get("/api/v1/universe?search=aapl")
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_substring_match(self, populated_client):
        # "OO" matches both "GOOGL" and "QQQ" — wait, actually only GOOGL
        resp = populated_client.get("/api/v1/universe?search=OO")
        assert resp.status_code == 200
        tickers = {i["ticker"] for i in resp.json()["items"]}
        assert "GOOGL" in tickers

    def test_no_match_returns_empty(self, populated_client):
        resp = populated_client.get("/api/v1/universe?search=ZZZNOTREAL")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    def test_multi_match(self, populated_client):
        # "Q" matches QQQ
        resp = populated_client.get("/api/v1/universe?search=Q")
        assert resp.status_code == 200
        tickers = {i["ticker"] for i in resp.json()["items"]}
        assert "QQQ" in tickers


# ---------------------------------------------------------------------------
# Test 4 — Asset class filter
# ---------------------------------------------------------------------------

class TestAssetClassFilter:
    def test_filter_stock(self, populated_client):
        resp = populated_client.get("/api/v1/universe?asset_class=stock&limit=100")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        tickers = {i["ticker"] for i in data["items"]}
        assert tickers == {"AAPL", "MSFT"}

    def test_filter_etf(self, populated_client):
        resp = populated_client.get("/api/v1/universe?asset_class=etf&limit=100")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        tickers = {i["ticker"] for i in data["items"]}
        assert tickers == {"SPY", "QQQ"}

    def test_filter_unknown_class_returns_empty(self, populated_client):
        resp = populated_client.get("/api/v1/universe?asset_class=crypto")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    def test_no_filter_returns_all(self, populated_client):
        resp = populated_client.get("/api/v1/universe?limit=100")
        assert resp.status_code == 200
        assert resp.json()["total"] == 5


# ---------------------------------------------------------------------------
# Test 5 & 6 — Sorting
# ---------------------------------------------------------------------------

class TestSorting:
    def test_sort_score_desc(self, populated_client):
        resp = populated_client.get(
            "/api/v1/universe?sort_by=score&sort_dir=desc&limit=100"
        )
        assert resp.status_code == 200
        items = resp.json()["items"]
        scores = [i["score_value"] for i in items if i["score_value"] is not None]
        assert scores == sorted(scores, reverse=True)

    def test_sort_score_asc(self, populated_client):
        resp = populated_client.get(
            "/api/v1/universe?sort_by=score&sort_dir=asc&limit=100"
        )
        assert resp.status_code == 200
        items = resp.json()["items"]
        scores = [i["score_value"] for i in items if i["score_value"] is not None]
        assert scores == sorted(scores)

    def test_sort_ticker_asc(self, populated_client):
        resp = populated_client.get(
            "/api/v1/universe?sort_by=ticker&sort_dir=asc&limit=100"
        )
        assert resp.status_code == 200
        tickers = [i["ticker"] for i in resp.json()["items"]]
        assert tickers == sorted(tickers)

    def test_sort_ticker_desc(self, populated_client):
        resp = populated_client.get(
            "/api/v1/universe?sort_by=ticker&sort_dir=desc&limit=100"
        )
        assert resp.status_code == 200
        tickers = [i["ticker"] for i in resp.json()["items"]]
        assert tickers == sorted(tickers, reverse=True)


# ---------------------------------------------------------------------------
# Test 7 — Pagination
# ---------------------------------------------------------------------------

class TestPagination:
    def test_limit(self, populated_client):
        resp = populated_client.get("/api/v1/universe?limit=2&sort_by=ticker&sort_dir=asc")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["total"] == 5
        assert data["limit"] == 2
        assert data["offset"] == 0

    def test_offset(self, populated_client):
        resp1 = populated_client.get(
            "/api/v1/universe?limit=2&offset=0&sort_by=ticker&sort_dir=asc"
        )
        resp2 = populated_client.get(
            "/api/v1/universe?limit=2&offset=2&sort_by=ticker&sort_dir=asc"
        )
        page1 = [i["ticker"] for i in resp1.json()["items"]]
        page2 = [i["ticker"] for i in resp2.json()["items"]]
        assert len(set(page1) & set(page2)) == 0  # no overlap

    def test_offset_beyond_total_returns_empty_items(self, populated_client):
        resp = populated_client.get("/api/v1/universe?limit=10&offset=100")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 5  # total still reflects full filtered count


# ---------------------------------------------------------------------------
# Test 8 — Breakdown JSON
# ---------------------------------------------------------------------------

class TestBreakdown:
    def test_breakdown_structure(self, populated_client):
        resp = populated_client.get("/api/v1/universe?search=AAPL")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        bd = item["breakdown"]
        assert bd is not None
        assert "factors" in bd
        assert "asset_class" in bd
        assert isinstance(bd["factors"], list)
        assert len(bd["factors"]) == 1
        factor = bd["factors"][0]
        assert "name" in factor
        assert "source" in factor
        assert "score" in factor
        assert "is_na" in factor
        assert "weight" in factor
        assert "effective_weight" in factor

    def test_breakdown_null_when_no_scores(self, populated_client):
        resp = populated_client.get("/api/v1/universe?search=GOOGL")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["breakdown"] is None

    def test_has_missing_factors_flag(self, populated_client):
        resp = populated_client.get("/api/v1/universe?search=QQQ")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["has_missing_factors"] is True

    def test_has_missing_factors_false_when_complete(self, populated_client):
        resp = populated_client.get("/api/v1/universe?search=AAPL")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["has_missing_factors"] is False


# ---------------------------------------------------------------------------
# Test 10 — No forbidden routes
# ---------------------------------------------------------------------------

class TestNoForbiddenRoutes:
    def test_no_scoring_recompute_route(self, client):
        assert client.post("/api/v1/scores/recompute").status_code == 404

    def test_no_export_route(self, client):
        assert client.get("/api/v1/export").status_code == 404

    def test_no_refresh_route(self, client):
        assert client.post("/api/v1/refresh").status_code == 404
