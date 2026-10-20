"""Daily activity (steps, Energy Score, workouts) synced from the phone."""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import (
    ActivityDay,
    User,
)
from app.routers.health_data.common import (
    _require_date,
    _upsert_samsung_energy_stress,
    serialize_activity,
)
from app.schemas import (
    ActivityIn,
)

router = APIRouter()


@router.post("/activity")
def upsert_activity(
    body: ActivityIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)

    row = (
        db.query(ActivityDay)
        .filter(ActivityDay.device_id == device_id, ActivityDay.date == body.date)
        .first()
    )
    if not row:
        row = ActivityDay(id=str(uuid.uuid4()), device_id=device_id, date=body.date)
        db.add(row)

    row.steps = body.steps
    row.active_minutes = body.activeMinutes
    row.calories_burned = body.caloriesBurned
    if body.energyScore is not None:
        row.energy_score = body.energyScore
        _upsert_samsung_energy_stress(
            db, device_id=device_id, date=body.date, energy_score=body.energyScore
        )
    row.workouts_json = json.dumps(body.workouts or [])
    row.synced_at = datetime.now().astimezone()
    row.source = body.source
    db.commit()
    db.refresh(row)
    return {"ok": True, "activity": serialize_activity(row)}


@router.get("/activity")
def list_activity(
    date: str | None = Query(None),
    limit: int = Query(30, le=90),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    if date:
        if not ids:
            return {"activity": None}
        rows = (
            db.query(ActivityDay)
            .filter(ActivityDay.date == date, ActivityDay.device_id.in_(ids))
            .all()
        )
        best = max(rows, key=lambda r: (r.steps or 0, r.calories_burned or 0), default=None)
        return {"activity": serialize_activity(best) if best else None}

    q = db.query(ActivityDay)
    if ids:
        q = q.filter(ActivityDay.device_id.in_(ids))
    rows = q.order_by(ActivityDay.date.desc()).limit(limit * 3).all()
    by_date: dict[str, ActivityDay] = {}
    for row in rows:
        cur = by_date.get(row.date)
        if not cur or (row.steps or 0) >= (cur.steps or 0):
            by_date[row.date] = row
    ordered = sorted(by_date.values(), key=lambda r: r.date, reverse=True)[:limit]
    return {"activity": [serialize_activity(r) for r in ordered]}
