"""Body profile, pump/sensor device care, and weight."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_user
from app.models import (
    User,
    WeightEntry,
)
from app.routers.health_data.common import (
    _require_date,
)
from app.schemas import (
    BodyProfileIn,
    DeviceCareIn,
    WeightIn,
)
from app.services.body_profile import (
    compute_targets_for_day,
    ensure_body_defaults,
    latest_weight,
    serialize_profile,
    serialize_weight,
)
from app.services.reports import to_date_key

router = APIRouter()


@router.get("/body-profile")
def get_body_profile(
    user: User = Depends(require_user),
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
    user: User = Depends(require_user),
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
    user: User = Depends(require_user),
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
    user: User = Depends(require_user),
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
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ensure_body_defaults(db)
    rows = db.query(WeightEntry).order_by(WeightEntry.date.desc()).limit(limit).all()
    return {"weights": [serialize_weight(r) for r in rows]}
