from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import (
    ActivityDay,
    CareVisit,
    CaffeineLog,
    DayCheckIn,
    Injury,
    InjuryPainLog,
    SportMatch,
    StressLog,
    User,
    WeightEntry,
    WorkoutPlan,
)
from app.schemas import (
    ActivityIn,
    BodyProfileIn,
    CareVisitIn,
    CaffeineLogIn,
    DayCheckInIn,
    DeviceCareIn,
    InjuryIn,
    InjuryPainLogIn,
    InjuryUpdate,
    SportMatchIn,
    StressLogIn,
    WeightIn,
    WorkoutGenerateIn,
    WorkoutPlanIn,
)
from app.services.body_profile import (
    compute_targets_for_day,
    ensure_body_defaults,
    latest_weight,
    serialize_profile,
    serialize_weight,
)
from app.services.gemini_errors import http_exc_from_gemini
from app.services.gemini_workout import generate_workout_plan
from app.services.injuries import (
    ACTIVITY_KINDS,
    BODY_AREAS,
    INJURY_STATUSES,
    INJURY_TYPES,
    serialize_injury,
    serialize_pain_log,
)
from app.services.reports import to_date_key
from app.services.workouts import build_workout_context, serialize_workout_plan

router = APIRouter(prefix="/health-data", tags=["health-data"])

CARE_KINDS = {"kine", "osteo", "podologue", "other"}
SPORT_RESULTS = {"win", "loss", "draw", "completed"}
STRESS_LEVELS = {"calm", "ok", "high"}
MOOD_LEVELS = {"terrible", "low", "ok", "good", "great"}
WAKE_QUALITIES = {"rough", "groggy", "ok", "fresh", "energized"}
FOCUS_LEVELS = {"terrible", "low", "ok", "good", "great"}
ADHD_INTENSITIES = {"low", "ok", "high"}
TASK_INITIATIONS = {"stuck", "slow", "ok", "easy"}
CAFFEINE_DRINKS = {
    "espresso",
    "double_espresso",
    "coffee",
    "iced_coffee",
    "green_tea",
    "black_tea",
}
CAFFEINE_MG_DEFAULTS = {
    "espresso": 63,
    "double_espresso": 125,
    "coffee": 95,
    "iced_coffee": 150,
    "green_tea": 28,
    "black_tea": 47,
}
CARE_LABELS = {
    "kine": "Kiné",
    "osteo": "Ostéo",
    "podologue": "Podologue",
    "other": "Other",
}
STRESS_LABELS = {
    "calm": "Calm",
    "ok": "OK",
    "high": "High",
}
MOOD_LABELS = {
    "terrible": "Terrible",
    "low": "Low",
    "ok": "OK",
    "good": "Good",
    "great": "Great",
}
WAKE_LABELS = {
    "rough": "Rough",
    "groggy": "Groggy",
    "ok": "OK",
    "fresh": "Fresh",
    "energized": "Energized",
}
FOCUS_LABELS = MOOD_LABELS
ADHD_INTENSITY_LABELS = {
    "low": "Low",
    "ok": "OK",
    "high": "High",
}
TASK_INITIATION_LABELS = {
    "stuck": "Stuck",
    "slow": "Slow",
    "ok": "OK",
    "easy": "Easy",
}
CAFFEINE_DRINK_LABELS = {
    "espresso": "Espresso",
    "double_espresso": "Double espresso",
    "coffee": "Coffee",
    "iced_coffee": "Iced coffee",
    "green_tea": "Green tea",
    "black_tea": "Black tea",
}
STRESS_SOURCE_LABELS = {
    "manual": "Manual",
    "samsung_energy": "Samsung Energy Score",
}


def serialize_activity(row: ActivityDay) -> dict:
    try:
        workouts = json.loads(row.workouts_json or "[]")
    except json.JSONDecodeError:
        workouts = []
    return {
        "id": row.id,
        "date": row.date,
        "steps": row.steps,
        "activeMinutes": row.active_minutes,
        "caloriesBurned": row.calories_burned,
        "energyScore": row.energy_score,
        "workouts": workouts,
        "syncedAt": int(row.synced_at.timestamp() * 1000) if row.synced_at else None,
        "source": row.source,
    }


def serialize_care_visit(row: CareVisit) -> dict:
    return {
        "id": row.id,
        "date": row.date,
        "time": row.time,
        "kind": row.kind,
        "kindLabel": CARE_LABELS.get(row.kind, row.kind),
        "label": row.label,
        "notes": row.notes,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


def serialize_sport_match(row: SportMatch) -> dict:
    return {
        "id": row.id,
        "date": row.date,
        "time": row.time,
        "sport": row.sport,
        "result": row.result,
        "score": row.score,
        "durationMin": row.duration_min,
        "opponent": row.opponent,
        "intensity": getattr(row, "intensity", None),
        "notes": row.notes,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


def serialize_stress_log(row: StressLog) -> dict:
    source = getattr(row, "source", None) or "manual"
    return {
        "id": row.id,
        "date": row.date,
        "time": row.time,
        "level": row.level,
        "levelLabel": STRESS_LABELS.get(row.level, row.level),
        "score": row.score,
        "source": source,
        "sourceLabel": STRESS_SOURCE_LABELS.get(source, source),
        "notes": row.notes,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


def serialize_day_check_in(row: DayCheckIn) -> dict:
    focus = getattr(row, "focus", None) or "ok"
    restlessness = getattr(row, "restlessness", None) or "ok"
    overwhelm = getattr(row, "overwhelm", None) or "ok"
    task_initiation = getattr(row, "task_initiation", None) or "ok"
    impulsivity = getattr(row, "impulsivity", None) or "ok"
    return {
        "id": row.id,
        "date": row.date,
        "mood": row.mood,
        "moodLabel": MOOD_LABELS.get(row.mood, row.mood),
        "wakeQuality": row.wake_quality,
        "wakeQualityLabel": WAKE_LABELS.get(row.wake_quality, row.wake_quality),
        "focus": focus,
        "focusLabel": FOCUS_LABELS.get(focus, focus),
        "restlessness": restlessness,
        "restlessnessLabel": ADHD_INTENSITY_LABELS.get(restlessness, restlessness),
        "overwhelm": overwhelm,
        "overwhelmLabel": ADHD_INTENSITY_LABELS.get(overwhelm, overwhelm),
        "taskInitiation": task_initiation,
        "taskInitiationLabel": TASK_INITIATION_LABELS.get(task_initiation, task_initiation),
        "impulsivity": impulsivity,
        "impulsivityLabel": ADHD_INTENSITY_LABELS.get(impulsivity, impulsivity),
        "medicationTaken": bool(getattr(row, "medication_taken", False)),
        "hyperfocus": bool(getattr(row, "hyperfocus", False)),
        "sleepHours": getattr(row, "sleep_hours", None),
        "notes": row.notes,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
        "updatedAt": int(row.updated_at.timestamp() * 1000) if row.updated_at else None,
    }


def serialize_caffeine_log(row: CaffeineLog) -> dict:
    return {
        "id": row.id,
        "date": row.date,
        "time": row.time,
        "drink": row.drink,
        "drinkLabel": CAFFEINE_DRINK_LABELS.get(row.drink, row.drink),
        "caffeineMg": row.caffeine_mg,
        "notes": row.notes,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


def _energy_to_stress_level(score: int) -> str:
    if score >= 70:
        return "calm"
    if score >= 40:
        return "ok"
    return "high"


def _upsert_samsung_energy_stress(
    db: Session, *, device_id: str, date: str, energy_score: float
) -> None:
    """Map Samsung Energy Score into stress_logs (continuous stress isn't available to 3P apps)."""
    score = int(round(energy_score))
    score = max(0, min(100, score))
    level = _energy_to_stress_level(score)
    row = (
        db.query(StressLog)
        .filter(
            StressLog.device_id == device_id,
            StressLog.date == date,
            StressLog.source == "samsung_energy",
        )
        .first()
    )
    if row:
        row.level = level
        row.score = score
        row.notes = "Samsung Health Energy Score"
    else:
        db.add(
            StressLog(
                id=str(uuid.uuid4()),
                device_id=device_id,
                date=date,
                level=level,
                score=score,
                source="samsung_energy",
                notes="Samsung Health Energy Score",
            )
        )


def _require_date(date: str) -> None:
    if not date or len(date) != 10:
        raise HTTPException(status_code=400, detail="date (YYYY-MM-DD) required")


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

    # Prefer higher totals so a partial sync cannot wipe a fuller Samsung read.
    incoming_steps = int(body.steps or 0)
    row.steps = max(incoming_steps, int(row.steps or 0))

    if body.activeMinutes is not None:
        row.active_minutes = max(int(body.activeMinutes or 0), int(row.active_minutes or 0))

    if body.caloriesBurned is not None:
        prev_cal = float(row.calories_burned or 0)
        row.calories_burned = max(float(body.caloriesBurned), prev_cal)

    if body.energyScore is not None:
        row.energy_score = body.energyScore
        _upsert_samsung_energy_stress(
            db, device_id=device_id, date=body.date, energy_score=body.energyScore
        )

    incoming_workouts = body.workouts or []
    try:
        existing_workouts = json.loads(row.workouts_json or "[]")
        if not isinstance(existing_workouts, list):
            existing_workouts = []
    except Exception:
        existing_workouts = []

    def _workout_minutes(items: list) -> int:
        total = 0
        for w in items:
            if isinstance(w, dict):
                try:
                    total += int(w.get("durationMin") or 0)
                except Exception:
                    pass
        return total

    if incoming_workouts:
        if _workout_minutes(incoming_workouts) >= _workout_minutes(existing_workouts):
            row.workouts_json = json.dumps(incoming_workouts)
    elif not existing_workouts:
        row.workouts_json = json.dumps([])

    row.synced_at = datetime.now().astimezone()
    row.source = body.source
    db.commit()
    db.refresh(row)
    return {"ok": True, "activity": serialize_activity(row)}


@router.get("/activity")
def list_activity(
    date: str | None = Query(None),
    limit: int = Query(30, le=90),
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
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


@router.post("/care-visits")
def create_care_visit(
    body: CareVisitIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)
    if body.kind not in CARE_KINDS:
        raise HTTPException(status_code=400, detail="invalid care kind")

    row = CareVisit(
        id=str(uuid.uuid4()),
        device_id=device_id,
        date=body.date,
        time=body.time,
        kind=body.kind,
        label=(body.label or "").strip() or None,
        notes=(body.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "careVisit": serialize_care_visit(row)}


@router.get("/care-visits")
def list_care_visits(
    date: str | None = Query(None),
    limit: int = Query(50, le=200),
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
    if not ids:
        return {"careVisits": []}
    q = db.query(CareVisit).filter(CareVisit.device_id.in_(ids))
    if date:
        q = q.filter(CareVisit.date == date)
    rows = q.order_by(CareVisit.date.desc(), CareVisit.created_at.desc()).limit(limit).all()
    return {"careVisits": [serialize_care_visit(r) for r in rows]}


@router.delete("/care-visits/{visit_id}")
def delete_care_visit(
    visit_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db)
    row = (
        db.query(CareVisit)
        .filter(CareVisit.id == visit_id, CareVisit.device_id.in_(ids))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="care visit not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/sport-matches")
def create_sport_match(
    body: SportMatchIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)
    if body.result not in SPORT_RESULTS:
        raise HTTPException(status_code=400, detail="invalid result")

    sport_raw = (body.sport or "padel").strip() or "padel"
    known = {"padel", "gym", "running", "cycling", "swimming", "walking", "other"}
    sport = sport_raw.lower() if sport_raw.lower() in known else sport_raw[:64]

    row = SportMatch(
        id=str(uuid.uuid4()),
        device_id=device_id,
        date=body.date,
        time=body.time,
        sport=sport,
        result=body.result,
        score=(body.score or "").strip(),
        duration_min=body.durationMin,
        opponent=(body.opponent or "").strip() or None,
        intensity=(body.intensity or None),
        notes=(body.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "sportMatch": serialize_sport_match(row)}


@router.get("/sport-matches")
def list_sport_matches(
    date: str | None = Query(None),
    limit: int = Query(50, le=200),
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
    if not ids:
        return {"sportMatches": []}
    q = db.query(SportMatch).filter(SportMatch.device_id.in_(ids))
    if date:
        q = q.filter(SportMatch.date == date)
    rows = q.order_by(SportMatch.date.desc(), SportMatch.created_at.desc()).limit(limit).all()
    return {"sportMatches": [serialize_sport_match(r) for r in rows]}


@router.delete("/sport-matches/{match_id}")
def delete_sport_match(
    match_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db)
    row = (
        db.query(SportMatch)
        .filter(SportMatch.id == match_id, SportMatch.device_id.in_(ids))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="sport match not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


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
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
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
    ids = household_device_ids(db)
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
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
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
    ids = household_device_ids(db)
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
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
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
    ids = household_device_ids(db)
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


@router.get("/body-profile")
def get_body_profile(
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    profile = ensure_body_defaults(db)
    weight = latest_weight(db)
    targets = compute_targets_for_day(db, to_date_key(datetime.now()))
    return {
        "profile": serialize_profile(profile),
        "latestWeight": serialize_weight(weight) if weight else None,
        "targets": targets,
    }


@router.put("/body-profile")
def update_body_profile(
    body: BodyProfileIn,
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    profile = ensure_body_defaults(db)
    profile.height_cm = body.heightCm
    profile.sex = body.sex
    profile.age_years = body.ageYears
    profile.activity = body.activity
    profile.deficit_kcal = body.deficitKcal
    if body.locale is not None:
        profile.locale = body.locale if body.locale in ("en", "fr") else "en"
    if body.tirLowMgDl is not None:
        profile.tir_low_mgdl = float(body.tirLowMgDl)
    if body.tirHighMgDl is not None:
        profile.tir_high_mgdl = float(body.tirHighMgDl)
    if body.tirGoalPct is not None:
        profile.tir_goal_pct = float(body.tirGoalPct)
    if body.dailyCarbTargetG is not None:
        profile.daily_carb_target_g = float(body.dailyCarbTargetG)
    if body.markCannulaChanged:
        profile.cannula_changed_at = datetime.now().astimezone()
    elif body.cannulaChangedAt is not None:
        profile.cannula_changed_at = datetime.fromtimestamp(
            body.cannulaChangedAt / 1000, tz=timezone.utc
        )
    if body.markSensorStarted:
        profile.sensor_started_at = datetime.now().astimezone()
    elif body.sensorStartedAt is not None:
        profile.sensor_started_at = datetime.fromtimestamp(
            body.sensorStartedAt / 1000, tz=timezone.utc
        )
    # Keep a valid range
    if float(profile.tir_high_mgdl or 180) <= float(profile.tir_low_mgdl or 70):
        profile.tir_high_mgdl = float(profile.tir_low_mgdl or 70) + 40
    db.commit()
    db.refresh(profile)
    targets = compute_targets_for_day(db, to_date_key(datetime.now()))
    return {"ok": True, "profile": serialize_profile(profile), "targets": targets}


@router.post("/body-profile/device-care")
def mark_device_care(
    body: DeviceCareIn,
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Mark cannula site change and/or sensor start without rewriting full body profile."""
    profile = ensure_body_defaults(db)
    now = datetime.now().astimezone()
    if body.markCannulaChanged:
        profile.cannula_changed_at = now
    if body.markSensorStarted:
        profile.sensor_started_at = now
    if body.cannulaChangedAt is not None:
        profile.cannula_changed_at = datetime.fromtimestamp(
            body.cannulaChangedAt / 1000, tz=timezone.utc
        )
    if body.sensorStartedAt is not None:
        profile.sensor_started_at = datetime.fromtimestamp(
            body.sensorStartedAt / 1000, tz=timezone.utc
        )
    db.commit()
    db.refresh(profile)
    return {"ok": True, "profile": serialize_profile(profile)}


@router.post("/weight")
def upsert_weight(
    body: WeightIn,
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_date(body.date)
    ensure_body_defaults(db)
    row = db.query(WeightEntry).filter(WeightEntry.date == body.date).first()
    if row:
        row.weight_kg = body.weightKg
        row.notes = (body.notes or "").strip() or None
    else:
        row = WeightEntry(
            id=str(uuid.uuid4()),
            date=body.date,
            weight_kg=body.weightKg,
            notes=(body.notes or "").strip() or None,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    targets = compute_targets_for_day(db, body.date)
    return {"ok": True, "weight": serialize_weight(row), "targets": targets}


@router.get("/weight")
def list_weight(
    limit: int = Query(60, le=365),
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ensure_body_defaults(db)
    rows = db.query(WeightEntry).order_by(WeightEntry.date.desc()).limit(limit).all()
    return {"weights": [serialize_weight(r) for r in rows]}


def _default_injury_title(body: InjuryIn) -> str:
    type_label = body.injuryType.replace("_", " ").title()
    if body.bodyArea == "other" and body.bodyAreaOther:
        area = body.bodyAreaOther.strip()
    else:
        area = body.bodyArea.replace("_", " ")
    return f"{type_label} · {area}".strip(" ·")


@router.post("/injuries")
def create_injury(
    body: InjuryIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.startedOn)
    if body.injuryType not in INJURY_TYPES:
        raise HTTPException(status_code=400, detail="invalid injury type")
    if body.bodyArea not in BODY_AREAS:
        raise HTTPException(status_code=400, detail="invalid body area")
    if body.status not in INJURY_STATUSES:
        raise HTTPException(status_code=400, detail="invalid status")
    kinds = [k for k in (body.relatedActivityKinds or []) if k in ACTIVITY_KINDS]
    title = (body.title or "").strip() or _default_injury_title(body)
    row = Injury(
        id=str(uuid.uuid4()),
        device_id=device_id,
        title=title[:255],
        injury_type=body.injuryType,
        body_area=body.bodyArea,
        body_area_other=(body.bodyAreaOther or "").strip() or None,
        started_on=body.startedOn,
        status=body.status,
        healed_on=None,
        related_activity_kinds_json=json.dumps(kinds),
        exercise_notes=(body.exerciseNotes or "").strip() or None,
        notes=(body.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "injury": serialize_injury(row)}


@router.get("/injuries")
def list_injuries(
    status: str = Query("active"),
    limit: int = Query(50, le=200),
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
    if not ids:
        return {"injuries": []}
    q = db.query(Injury).filter(Injury.device_id.in_(ids))
    if status and status != "all":
        if status == "open":
            q = q.filter(Injury.status.in_(("active", "healing")))
        else:
            q = q.filter(Injury.status == status)
    rows = q.order_by(Injury.started_on.desc(), Injury.created_at.desc()).limit(limit).all()
    today = to_date_key(datetime.now())
    out = []
    for row in rows:
        latest = (
            db.query(InjuryPainLog)
            .filter(InjuryPainLog.injury_id == row.id)
            .order_by(InjuryPainLog.date.desc())
            .first()
        )
        today_pain = (
            db.query(InjuryPainLog)
            .filter(InjuryPainLog.injury_id == row.id, InjuryPainLog.date == today)
            .first()
        )
        recent = (
            db.query(InjuryPainLog)
            .filter(InjuryPainLog.injury_id == row.id)
            .order_by(InjuryPainLog.date.desc())
            .limit(7)
            .all()
        )
        out.append(
            serialize_injury(
                row,
                latest_pain=latest,
                today_pain=today_pain,
                include_recent_pain=list(reversed(recent)),
            )
        )
    return {"injuries": out}


@router.patch("/injuries/{injury_id}")
def update_injury(
    injury_id: str,
    body: InjuryUpdate,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db)
    row = db.query(Injury).filter(Injury.id == injury_id, Injury.device_id.in_(ids)).first()
    if not row:
        raise HTTPException(status_code=404, detail="injury not found")

    if body.title is not None:
        row.title = body.title.strip()[:255] or row.title
    if body.injuryType is not None:
        if body.injuryType not in INJURY_TYPES:
            raise HTTPException(status_code=400, detail="invalid injury type")
        row.injury_type = body.injuryType
    if body.bodyArea is not None:
        if body.bodyArea not in BODY_AREAS:
            raise HTTPException(status_code=400, detail="invalid body area")
        row.body_area = body.bodyArea
    if body.bodyAreaOther is not None:
        row.body_area_other = body.bodyAreaOther.strip() or None
    if body.startedOn is not None:
        _require_date(body.startedOn)
        row.started_on = body.startedOn
    if body.status is not None:
        if body.status not in INJURY_STATUSES:
            raise HTTPException(status_code=400, detail="invalid status")
        row.status = body.status
        if body.status == "healed" and not row.healed_on:
            row.healed_on = body.healedOn or to_date_key(datetime.now())
        if body.status != "healed":
            row.healed_on = body.healedOn
    if body.healedOn is not None:
        if body.healedOn:
            _require_date(body.healedOn)
        row.healed_on = body.healedOn or None
    if body.relatedActivityKinds is not None:
        kinds = [k for k in body.relatedActivityKinds if k in ACTIVITY_KINDS]
        row.related_activity_kinds_json = json.dumps(kinds)
    if body.exerciseNotes is not None:
        row.exercise_notes = body.exerciseNotes.strip() or None
    if body.notes is not None:
        row.notes = body.notes.strip() or None

    db.commit()
    db.refresh(row)
    return {"ok": True, "injury": serialize_injury(row)}


@router.delete("/injuries/{injury_id}")
def delete_injury(
    injury_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db)
    row = db.query(Injury).filter(Injury.id == injury_id, Injury.device_id.in_(ids)).first()
    if not row:
        raise HTTPException(status_code=404, detail="injury not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/injuries/{injury_id}/pain")
def upsert_injury_pain(
    injury_id: str,
    body: InjuryPainLogIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)
    ids = household_device_ids(db)
    injury = db.query(Injury).filter(Injury.id == injury_id, Injury.device_id.in_(ids)).first()
    if not injury:
        raise HTTPException(status_code=404, detail="injury not found")
    kind = body.relatedActivityKind
    if kind is not None and kind not in ACTIVITY_KINDS:
        raise HTTPException(status_code=400, detail="invalid activity kind")

    row = (
        db.query(InjuryPainLog)
        .filter(InjuryPainLog.injury_id == injury_id, InjuryPainLog.date == body.date)
        .first()
    )
    if row:
        row.pain_score = body.painScore
        row.related_activity_kind = kind
        row.notes = (body.notes or "").strip() or None
    else:
        row = InjuryPainLog(
            id=str(uuid.uuid4()),
            injury_id=injury_id,
            device_id=device_id,
            date=body.date,
            pain_score=body.painScore,
            related_activity_kind=kind,
            notes=(body.notes or "").strip() or None,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "painLog": serialize_pain_log(row), "injury": serialize_injury(injury, today_pain=row)}


@router.get("/injuries/{injury_id}/pain")
def list_injury_pain(
    injury_id: str,
    limit: int = Query(60, le=365),
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
    injury = db.query(Injury).filter(Injury.id == injury_id, Injury.device_id.in_(ids)).first()
    if not injury:
        raise HTTPException(status_code=404, detail="injury not found")
    rows = (
        db.query(InjuryPainLog)
        .filter(InjuryPainLog.injury_id == injury_id)
        .order_by(InjuryPainLog.date.desc())
        .limit(limit)
        .all()
    )
    return {"painLogs": [serialize_pain_log(r) for r in rows]}


@router.get("/injury-pain")
def list_injury_pain_for_day(
    date: str | None = Query(None),
    limit: int = Query(100, le=500),
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
    if not ids:
        return {"painLogs": []}
    day = date or to_date_key(datetime.now())
    if date:
        _require_date(date)
    rows = (
        db.query(InjuryPainLog)
        .filter(InjuryPainLog.device_id.in_(ids), InjuryPainLog.date == day)
        .order_by(InjuryPainLog.created_at.asc())
        .limit(limit)
        .all()
    )
    return {"painLogs": [serialize_pain_log(r) for r in rows], "date": day}


@router.post("/workouts/generate")
async def generate_workout(
    body: WorkoutGenerateIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db)
    if not ids:
        raise HTTPException(status_code=400, detail="No household devices")
    context = build_workout_context(db, device_ids=ids, user_note=body.notes)
    try:
        draft = await asyncio.to_thread(generate_workout_plan, context)
    except Exception as exc:  # noqa: BLE001
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
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
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
    ids = household_device_ids(db)
    row = db.query(WorkoutPlan).filter(WorkoutPlan.id == plan_id, WorkoutPlan.device_id.in_(ids)).first()
    if not row:
        raise HTTPException(status_code=404, detail="workout plan not found")
    db.delete(row)
    db.commit()
    return {"ok": True}

