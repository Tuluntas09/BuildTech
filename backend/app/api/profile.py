"""
Profile API — GET /api/v1/profile and PUT /api/v1/profile.

Single-user design: all operations work on the first (and only) row in
user_profile.  GET returns 404 when no profile exists yet, prompting the
frontend to display the onboarding questionnaire.  PUT is an upsert.

Only profile-related endpoints are implemented here.  No builder,
universe, watchlist, portfolio, export, or scoring endpoints.
"""

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.risk_profile import RISK_LEVELS, compute_suggested_level
from app.db.session import get_db
from app.models.tables import UserProfile

router = APIRouter(tags=["profile"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ProfileResponse(BaseModel):
    """Serialized user profile returned by GET and PUT."""

    id: int
    name: Optional[str]
    risk_level: Optional[int]
    questionnaire_responses: Optional[dict[str, Any]]
    asset_class_prefs: Optional[dict[str, Any]]
    theme: Optional[str]
    # Derived: suggested level computed from questionnaire_responses
    suggested_risk_level: Optional[int]
    # Convenience: risk level metadata from RISK_LEVELS catalogue
    risk_level_info: Optional[dict[str, Any]]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ProfileUpdateRequest(BaseModel):
    """Accepted fields for PUT /api/v1/profile."""

    name: Optional[str] = None
    risk_level: Optional[int] = None
    questionnaire_responses: Optional[dict[str, Any]] = None
    asset_class_prefs: Optional[dict[str, Any]] = None
    theme: Optional[str] = None


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _build_response(profile: UserProfile) -> ProfileResponse:
    suggested: Optional[int] = None
    if profile.questionnaire_responses:
        suggested = compute_suggested_level(profile.questionnaire_responses)

    return ProfileResponse(
        id=profile.id,
        name=profile.name,
        risk_level=profile.risk_level,
        questionnaire_responses=profile.questionnaire_responses,
        asset_class_prefs=profile.asset_class_prefs,
        theme=profile.theme,
        suggested_risk_level=suggested,
        risk_level_info=(
            RISK_LEVELS.get(profile.risk_level) if profile.risk_level else None
        ),
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/profile", response_model=ProfileResponse)
async def get_profile(db: Session = Depends(get_db)) -> ProfileResponse:
    """Return the current user profile.

    Returns 404 when no profile has been saved yet — the frontend uses
    this signal to redirect to the onboarding questionnaire.
    """
    profile = db.query(UserProfile).first()
    if profile is None:
        raise HTTPException(
            status_code=404,
            detail="No profile found. Complete onboarding to create one.",
        )
    return _build_response(profile)


@router.put("/profile", response_model=ProfileResponse)
async def upsert_profile(
    body: ProfileUpdateRequest,
    db: Session = Depends(get_db),
) -> ProfileResponse:
    """Create or update the user profile (upsert).

    Applies only the fields provided in the request body; omitted fields
    are left unchanged on an existing profile.
    """
    profile = db.query(UserProfile).first()

    if profile is None:
        profile = UserProfile()
        db.add(profile)

    if body.name is not None:
        profile.name = body.name
    if body.risk_level is not None:
        if body.risk_level not in RISK_LEVELS:
            raise HTTPException(
                status_code=422,
                detail=f"risk_level must be 1–5; got {body.risk_level!r}",
            )
        profile.risk_level = body.risk_level
    if body.questionnaire_responses is not None:
        profile.questionnaire_responses = body.questionnaire_responses
    if body.asset_class_prefs is not None:
        profile.asset_class_prefs = body.asset_class_prefs
    if body.theme is not None:
        profile.theme = body.theme

    db.commit()
    db.refresh(profile)
    return _build_response(profile)
