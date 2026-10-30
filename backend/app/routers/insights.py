"""Personal insights for the phone: timely watch-outs drawn from the user's own patterns."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import household_device_ids, require_user
from app.models import User
from app.services.watchouts import build_watchouts

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/watchouts")
def watchouts(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    return {"watchouts": build_watchouts(db, household_device_ids(db, user))}
