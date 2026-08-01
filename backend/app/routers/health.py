from __future__ import annotations

import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import (
    ActivityDay,
    CareVisit,
    Injury,
    InjuryPainLog,
    SportMatch,
    StressLog,
    User,
    WeightEntry,
)
from app.schemas import (
    ActivityIn,
    BodyProfileIn,
    CareVisitIn,
    InjuryIn,
    InjuryPainLogIn,
    InjuryUpdate,
    SportMatchIn,
    StressLogIn,
    WeightIn,
)
from app.services.body_profile import (
    compute_targets_for_day,
    ensure_body_defaults,
    latest_weight,
    serialize_profile,
    serialize_weight,
)
from app.services.injuries import (
    ACTIVITY_KINDS,
    BODY_AREAS,
    INJURY_STATUSES,
    INJURY_TYPES,
    serialize_injury,
    serialize_pain_log,
)
from app.services.reports import to_date_key

router = APIRouter(prefix="/health-data", tags=["health-data"])

CARE_KINDS = {"kine", "osteo", "podologue", "other"}
SPORT_RESULTS = {"win", "loss", "draw", "completed"}
STRESS_LEVELS = {"calm", "ok", "high"}
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
    return {
        "id": row.id,
        "date": row.date,
        "time": row.time,
        "level": row.level,
        "levelLabel": STRESS_LABELS.get(row.level, row.level),
        "score": row.score,
        "notes": row.notes,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


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

    row.steps = body.steps
    row.active_minutes = body.activeMinutes
    row.calories_burned = body.caloriesBurned
    if body.energyScore is not None:
        row.energy_score = body.energyScore
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
    db.commit()
    db.refresh(profile)
    targets = compute_targets_for_day(db, to_date_key(datetime.now()))
    return {"ok": True, "profile": serialize_profile(profile), "targets": targets}


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
