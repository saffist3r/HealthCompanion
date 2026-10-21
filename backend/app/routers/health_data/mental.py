"""Stress logs, morning check-ins, and caffeine."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import (
    CaffeineLog,
    DayCheckIn,
    StressLog,
    User,
)
from app.routers.health_data.common import (
    ADHD_INTENSITIES,
    CAFFEINE_DRINKS,
    CAFFEINE_MG_DEFAULTS,
    FOCUS_LEVELS,
    MOOD_LEVELS,
    STRESS_LEVELS,
    TASK_INITIATIONS,
    WAKE_QUALITIES,
    _require_date,
    serialize_caffeine_log,
    serialize_day_check_in,
    serialize_stress_log,
)
from app.schemas import (
    CaffeineLogIn,
    DayCheckInIn,
    StressLogIn,
)

router = APIRouter()


@router.post("/stress-logs")
def create_stress_log(
    body: StressLogIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)
    if body.level not in STRESS_LEVELS:
        raise HTTPException(status_code=400, detail="invalid stress level")

    row = StressLog(
        id=str(uuid.uuid4()),
        device_id=device_id,
        date=body.date,
        time=body.time,
        level=body.level,
        score=body.score,
        source="manual",
        notes=(body.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "stressLog": serialize_stress_log(row)}


@router.get("/stress-logs")
def list_stress_logs(
    date: str | None = Query(None),
    limit: int = Query(50, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    if not ids:
        return {"stressLogs": []}
    q = db.query(StressLog).filter(StressLog.device_id.in_(ids))
    if date:
        q = q.filter(StressLog.date == date)
    rows = q.order_by(StressLog.date.desc(), StressLog.created_at.desc()).limit(limit).all()
    return {"stressLogs": [serialize_stress_log(r) for r in rows]}


@router.delete("/stress-logs/{log_id}")
def delete_stress_log(
    log_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db, user)
    row = (
        db.query(StressLog)
        .filter(StressLog.id == log_id, StressLog.device_id.in_(ids))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="stress log not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/day-checkins")
def upsert_day_check_in(
    body: DayCheckInIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)
    if body.mood not in MOOD_LEVELS:
        raise HTTPException(status_code=400, detail="invalid mood")
    if body.wakeQuality not in WAKE_QUALITIES:
        raise HTTPException(status_code=400, detail="invalid wakeQuality")
    if body.focus not in FOCUS_LEVELS:
        raise HTTPException(status_code=400, detail="invalid focus")
    if body.restlessness not in ADHD_INTENSITIES:
        raise HTTPException(status_code=400, detail="invalid restlessness")
    if body.overwhelm not in ADHD_INTENSITIES:
        raise HTTPException(status_code=400, detail="invalid overwhelm")
    if body.taskInitiation not in TASK_INITIATIONS:
        raise HTTPException(status_code=400, detail="invalid taskInitiation")
    if body.impulsivity not in ADHD_INTENSITIES:
        raise HTTPException(status_code=400, detail="invalid impulsivity")

    row = (
        db.query(DayCheckIn)
        .filter(DayCheckIn.device_id == device_id, DayCheckIn.date == body.date)
        .first()
    )
    notes = (body.notes or "").strip() or None
    if row:
        row.mood = body.mood
        row.wake_quality = body.wakeQuality
        row.focus = body.focus
        row.restlessness = body.restlessness
        row.overwhelm = body.overwhelm
        row.task_initiation = body.taskInitiation
        row.impulsivity = body.impulsivity
        row.medication_taken = body.medicationTaken
        row.hyperfocus = body.hyperfocus
        row.sleep_hours = body.sleepHours
        row.notes = notes
    else:
        row = DayCheckIn(
            id=str(uuid.uuid4()),
            device_id=device_id,
            date=body.date,
            mood=body.mood,
            wake_quality=body.wakeQuality,
            focus=body.focus,
            restlessness=body.restlessness,
            overwhelm=body.overwhelm,
            task_initiation=body.taskInitiation,
            impulsivity=body.impulsivity,
            medication_taken=body.medicationTaken,
            hyperfocus=body.hyperfocus,
            sleep_hours=body.sleepHours,
            notes=notes,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "dayCheckIn": serialize_day_check_in(row)}


@router.get("/day-checkins")
def list_day_check_ins(
    date: str | None = Query(None),
    limit: int = Query(50, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    if not ids:
        return {"dayCheckIns": [], "dayCheckIn": None}
    q = db.query(DayCheckIn).filter(DayCheckIn.device_id.in_(ids))
    if date:
        q = q.filter(DayCheckIn.date == date)
    rows = q.order_by(DayCheckIn.date.desc(), DayCheckIn.updated_at.desc()).limit(limit).all()
    serialized = [serialize_day_check_in(r) for r in rows]
    return {
        "dayCheckIns": serialized,
        "dayCheckIn": serialized[0] if date and serialized else None,
    }


@router.delete("/day-checkins/{check_in_id}")
def delete_day_check_in(
    check_in_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db, user)
    row = (
        db.query(DayCheckIn)
        .filter(DayCheckIn.id == check_in_id, DayCheckIn.device_id.in_(ids))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="day check-in not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/caffeine-logs")
def create_caffeine_log(
    body: CaffeineLogIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)
    if body.drink not in CAFFEINE_DRINKS:
        raise HTTPException(status_code=400, detail="invalid drink")
    mg = body.caffeineMg
    if mg is None:
        mg = CAFFEINE_MG_DEFAULTS.get(body.drink, 95)
    row = CaffeineLog(
        id=str(uuid.uuid4()),
        device_id=device_id,
        date=body.date,
        time=body.time,
        drink=body.drink,
        caffeine_mg=int(mg),
        notes=(body.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "caffeineLog": serialize_caffeine_log(row)}


@router.get("/caffeine-logs")
def list_caffeine_logs(
    date: str | None = Query(None),
    limit: int = Query(50, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    if not ids:
        return {"caffeineLogs": []}
    q = db.query(CaffeineLog).filter(CaffeineLog.device_id.in_(ids))
    if date:
        q = q.filter(CaffeineLog.date == date)
    rows = q.order_by(CaffeineLog.date.desc(), CaffeineLog.created_at.desc()).limit(limit).all()
    return {"caffeineLogs": [serialize_caffeine_log(r) for r in rows]}


@router.delete("/caffeine-logs/{log_id}")
def delete_caffeine_log(
    log_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db, user)
    row = (
        db.query(CaffeineLog)
        .filter(CaffeineLog.id == log_id, CaffeineLog.device_id.in_(ids))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="caffeine log not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
