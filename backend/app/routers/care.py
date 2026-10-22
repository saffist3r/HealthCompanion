"""Care-team view: a read-only multi-day summary for the nurse or doctor."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import household_device_ids, require_user
from app.models import CareShare, User
from app.services.care_summary import (
    ALLOWED_DAYS,
    build_care_summary,
    create_care_share,
    get_valid_care_share,
    serialize_care_share,
)
from app.services.report_share import public_base_url

router = APIRouter(prefix="/care", tags=["care"])


class CareShareIn(BaseModel):
    days: int = 14
    ttlDays: int = Field(default=30, ge=1, le=180)
    label: str = Field(default="", max_length=120)
    note: str | None = Field(default=None, max_length=4000)


def _check_days(days: int) -> int:
    if days not in ALLOWED_DAYS:
        raise HTTPException(status_code=400, detail=f"days must be one of {list(ALLOWED_DAYS)}")
    return days


@router.get("/summary")
def my_summary(
    days: int = Query(default=14),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Preview of what the care team sees, for the signed-in user."""
    return build_care_summary(db, household_device_ids(db, user), days=_check_days(days))


@router.get("/shares")
def list_shares(user: User = Depends(require_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(CareShare)
        .filter(CareShare.created_by_user_id == user.id)
        .order_by(CareShare.created_at.desc())
        .limit(50)
        .all()
    )
    return [serialize_care_share(r, public_base_url()) for r in rows]


@router.post("/shares")
def create_share(
    body: CareShareIn, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> dict:
    row = create_care_share(
        db,
        user_id=user.id,
        days=_check_days(body.days),
        ttl_days=body.ttlDays,
        label=body.label,
        note=body.note,
    )
    return serialize_care_share(row, public_base_url())


@router.delete("/shares/{token}")
def revoke_share(
    token: str, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> dict:
    row = db.get(CareShare, token)
    if not row or row.created_by_user_id != user.id:
        raise HTTPException(status_code=404, detail="Link not found")
    row.revoked = True
    db.commit()
    return {"ok": True}


@router.get("/view/{token}")
def shared_view(token: str, db: Session = Depends(get_db)) -> dict:
    """Public (token-only) summary for the care team."""
    share = get_valid_care_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link has expired or was turned off.")
    owner = db.get(User, share.created_by_user_id) if share.created_by_user_id else None
    if not owner or not owner.active:
        raise HTTPException(status_code=404, detail="This link has expired or was turned off.")
    summary = build_care_summary(db, household_device_ids(db, owner), days=share.days)
    return {
        **summary,
        "patient": {"displayName": owner.display_name or owner.email.split("@")[0]},
        "share": {"label": share.label, "note": share.note, "expiresAt": serialize_care_share(share, "")["expiresAt"]},
    }
