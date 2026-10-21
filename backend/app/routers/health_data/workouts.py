"""AI-drafted and saved workout plans."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import (
    User,
    WorkoutPlan,
)
from app.schemas import (
    WorkoutGenerateIn,
    WorkoutPlanIn,
)
from app.services.gemini_errors import http_exc_from_gemini
from app.services.gemini_workout import generate_workout_plan
from app.services.workouts import build_workout_context, serialize_workout_plan

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/workouts/generate")
async def generate_workout(
    body: WorkoutGenerateIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db, user)
    if not ids:
        raise HTTPException(status_code=400, detail="No household devices")
    context = build_workout_context(db, device_ids=ids, user_note=body.notes)
    try:
        draft = await asyncio.to_thread(generate_workout_plan, context)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Workout plan generation failed")
        raise http_exc_from_gemini(exc) from exc
    return {"plan": draft.model_dump(), "contextSummary": context.get("basedOnSummary")}


@router.post("/workouts")
def save_workout(
    body: WorkoutPlanIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    if not body.exercises:
        raise HTTPException(status_code=400, detail="At least one exercise required")
    ctx = {"basedOnSummary": body.basedOn} if body.basedOn else {}
    row = WorkoutPlan(
        id=str(uuid.uuid4()),
        device_id=device_id,
        title=(body.title or "Workout")[:255],
        focus=(body.focus or "").strip()[:128] or None,
        duration_min=body.durationMin,
        summary=(body.summary or "").strip() or None,
        exercises_json=json.dumps([e.model_dump() for e in body.exercises]),
        prompt_context_json=json.dumps(ctx),
        notes=(body.notes or "").strip() or None,
        source=(body.source or "gemini")[:32],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "workoutPlan": serialize_workout_plan(row)}


@router.get("/workouts")
def list_workouts(
    limit: int = Query(20, le=100),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    if not ids:
        return {"workoutPlans": []}
    rows = (
        db.query(WorkoutPlan)
        .filter(WorkoutPlan.device_id.in_(ids))
        .order_by(WorkoutPlan.created_at.desc())
        .limit(limit)
        .all()
    )
    return {"workoutPlans": [serialize_workout_plan(r) for r in rows]}


@router.delete("/workouts/{plan_id}")
def delete_workout(
    plan_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db, user)
    row = db.query(WorkoutPlan).filter(WorkoutPlan.id == plan_id, WorkoutPlan.device_id.in_(ids)).first()
    if not row:
        raise HTTPException(status_code=404, detail="workout plan not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
