"""
Backend tests for Task 9 — profile API.

Coverage:
  1. GET /api/v1/profile returns 404 when no profile exists.
  2. PUT /api/v1/profile creates a new profile.
  3. PUT /api/v1/profile updates an existing profile.
  4. Questionnaire responses are persisted and returned.
  5. Risk level is persisted and validated (1–5 range).
  6. suggested_risk_level is computed from questionnaire_responses.
  7. No unexpected API routes are exposed.
  8. risk_level_info is included in response.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.tables  # noqa: F401 — must be imported before Base.metadata.create_all
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.core.risk_profile import compute_suggested_level, RISK_LEVELS


# ---------------------------------------------------------------------------
# In-memory DB fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    # StaticPool forces all connections to reuse the same underlying SQLite
    # in-memory connection, so create_all and test requests share one database.
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override_get_db():
        db = TestingSession()
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
# Test 1 — GET returns 404 when no profile
# ---------------------------------------------------------------------------

class TestGetProfile:
    def test_404_when_no_profile(self, client):
        resp = client.get("/api/v1/profile")
        assert resp.status_code == 404
        assert "profile" in resp.json()["detail"].lower()

    def test_200_after_put(self, client):
        client.put("/api/v1/profile", json={"name": "Alice", "risk_level": 3})
        resp = client.get("/api/v1/profile")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Alice"
        assert data["risk_level"] == 3


# ---------------------------------------------------------------------------
# Test 2 & 3 — PUT creates and updates profile
# ---------------------------------------------------------------------------

class TestPutProfile:
    def test_creates_profile(self, client):
        resp = client.put("/api/v1/profile", json={"name": "Bob", "risk_level": 2})
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == 1
        assert data["name"] == "Bob"
        assert data["risk_level"] == 2

    def test_updates_existing_profile(self, client):
        client.put("/api/v1/profile", json={"name": "Initial", "risk_level": 1})
        resp = client.put("/api/v1/profile", json={"name": "Updated", "risk_level": 4})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Updated"
        assert data["risk_level"] == 4

    def test_partial_update_preserves_other_fields(self, client):
        client.put("/api/v1/profile", json={"name": "Charlie", "risk_level": 3})
        resp = client.put("/api/v1/profile", json={"name": "Charlie Updated"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["risk_level"] == 3  # unchanged
        assert data["name"] == "Charlie Updated"

    def test_invalid_risk_level_rejected(self, client):
        resp = client.put("/api/v1/profile", json={"risk_level": 6})
        assert resp.status_code == 422

    def test_all_five_valid_risk_levels_accepted(self, client):
        for lvl in (1, 2, 3, 4, 5):
            resp = client.put("/api/v1/profile", json={"risk_level": lvl})
            assert resp.status_code == 200
            assert resp.json()["risk_level"] == lvl


# ---------------------------------------------------------------------------
# Test 4 — Questionnaire responses persisted
# ---------------------------------------------------------------------------

class TestQuestionnaireResponses:
    def test_questionnaire_responses_persisted(self, client):
        responses = {f"q{i}": i % 5 for i in range(8)}
        resp = client.put(
            "/api/v1/profile",
            json={"questionnaire_responses": responses},
        )
        assert resp.status_code == 200
        assert resp.json()["questionnaire_responses"] == responses

    def test_questionnaire_responses_survive_get(self, client):
        responses = {"q0": 2, "q1": 3, "q2": 1, "q3": 2, "q4": 3, "q5": 2, "q6": 1, "q7": 2}
        client.put("/api/v1/profile", json={"questionnaire_responses": responses})
        data = client.get("/api/v1/profile").json()
        assert data["questionnaire_responses"] == responses


# ---------------------------------------------------------------------------
# Test 5 & 6 — Risk level persisted + suggested level computed
# ---------------------------------------------------------------------------

class TestRiskLevel:
    def test_risk_level_persisted(self, client):
        client.put("/api/v1/profile", json={"risk_level": 5})
        data = client.get("/api/v1/profile").json()
        assert data["risk_level"] == 5

    def test_suggested_risk_level_from_all_zero(self, client):
        # All 0 answers → avg=0 → level=1 (Citadel)
        responses = {f"q{i}": 0 for i in range(8)}
        resp = client.put("/api/v1/profile", json={"questionnaire_responses": responses})
        assert resp.json()["suggested_risk_level"] == 1

    def test_suggested_risk_level_from_all_four(self, client):
        # All 4 answers → avg=4 → level=5 (Frontier)
        responses = {f"q{i}": 4 for i in range(8)}
        resp = client.put("/api/v1/profile", json={"questionnaire_responses": responses})
        assert resp.json()["suggested_risk_level"] == 5

    def test_suggested_level_midpoint(self, client):
        # All 2 answers → avg=2 → level=3 (Compass)
        responses = {f"q{i}": 2 for i in range(8)}
        resp = client.put("/api/v1/profile", json={"questionnaire_responses": responses})
        assert resp.json()["suggested_risk_level"] == 3

    def test_no_questionnaire_no_suggested_level(self, client):
        resp = client.put("/api/v1/profile", json={"risk_level": 3})
        # No questionnaire_responses → suggested_risk_level is None
        assert resp.json()["suggested_risk_level"] is None


# ---------------------------------------------------------------------------
# Test 8 — risk_level_info included
# ---------------------------------------------------------------------------

class TestRiskLevelInfo:
    def test_risk_level_info_present_when_level_set(self, client):
        resp = client.put("/api/v1/profile", json={"risk_level": 3})
        info = resp.json()["risk_level_info"]
        assert info is not None
        assert info["name"] == "Compass"
        assert "stocks_range" in info
        assert "etf_range" in info

    def test_risk_level_info_none_when_no_level(self, client):
        resp = client.put("/api/v1/profile", json={"name": "NoLevel"})
        assert resp.json()["risk_level_info"] is None


# ---------------------------------------------------------------------------
# Test 7 — No unexpected routes
# ---------------------------------------------------------------------------

class TestNoExtraRoutes:
    def test_no_export_route(self, client):
        assert client.get("/api/v1/export").status_code == 404

    def test_health_still_works(self, client):
        assert client.get("/api/v1/health").status_code == 200


# ---------------------------------------------------------------------------
# Unit tests for risk_profile.py (pure logic, no DB)
# ---------------------------------------------------------------------------

class TestComputeSuggestedLevel:
    def test_empty_returns_default(self):
        assert compute_suggested_level({}) == 2

    def test_all_zero(self):
        assert compute_suggested_level({f"q{i}": 0 for i in range(8)}) == 1

    def test_all_four(self):
        assert compute_suggested_level({f"q{i}": 4 for i in range(8)}) == 5

    def test_clamped_upper(self):
        # Even if somehow avg > 4, must stay at 5
        assert compute_suggested_level({"q": 100}) == 5

    def test_clamped_lower(self):
        # Negative values → must stay at 1
        assert compute_suggested_level({"q": -10}) == 1

    def test_risk_levels_catalogue_complete(self):
        assert set(RISK_LEVELS.keys()) == {1, 2, 3, 4, 5}
        for lvl, info in RISK_LEVELS.items():
            assert "name" in info
            assert "target_vol" in info
            assert "stocks_range" in info
            assert "etf_range" in info
