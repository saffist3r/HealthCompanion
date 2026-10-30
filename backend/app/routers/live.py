"""Live glucose view: a read-only, always-current page for family."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import household_device_ids, require_user
from app.models import LiveShare, User
from app.services.live_view import (
    build_live_view,
    create_live_share,
    get_valid_live_share,
    serialize_live_share,
)
from app.services.report_share import public_base_url

router = APIRouter(prefix="/live", tags=["live"])

GONE = "This link has expired or was turned off."


class LiveShareIn(BaseModel):
    label: str = Field(default="", max_length=120)
    # None = valid until turned off
    ttlDays: int | None = Field(default=None, ge=1, le=3650)


@router.get("/shares")
def list_shares(user: User = Depends(require_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(LiveShare)
        .filter(LiveShare.created_by_user_id == user.id)
        .order_by(LiveShare.created_at.desc())
        .limit(50)
        .all()
    )
    return [serialize_live_share(r, public_base_url()) for r in rows]


@router.post("/shares")
def create_share(
    body: LiveShareIn, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> dict:
    row = create_live_share(db, user_id=user.id, label=body.label, ttl_days=body.ttlDays)
    return serialize_live_share(row, public_base_url())


@router.delete("/shares/{token}")
def revoke_share(
    token: str, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> dict:
    row = db.get(LiveShare, token)
    if not row or row.created_by_user_id != user.id:
        raise HTTPException(status_code=404, detail="Link not found")
    row.revoked = True
    db.commit()
    return {"ok": True}


@router.get("/me")
def my_live_view(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    """What the live link shows, for the signed-in user."""
    return build_live_view(db, household_device_ids(db, user))


@router.get("/view/{token}")
def shared_live_view(token: str, response: Response, db: Session = Depends(get_db)) -> dict:
    """Public (token-only) live view."""
    response.headers["Cache-Control"] = "no-store"
    share = get_valid_live_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail=GONE)
    owner = db.get(User, share.created_by_user_id) if share.created_by_user_id else None
    if not owner or not owner.active:
        raise HTTPException(status_code=404, detail=GONE)
    return {
        **build_live_view(db, household_device_ids(db, owner)),
        "patient": {"displayName": owner.display_name or owner.email.split("@")[0]},
        "share": {"label": share.label},
    }
