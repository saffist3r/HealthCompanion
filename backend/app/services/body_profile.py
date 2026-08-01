"""Load / update body profile & weight history."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import BodyProfile, WeightEntry
from app.services.body_calories import calorie_targets
from app.services.reports import to_date_key

DEFAULT_PROFILE = {
    "id": "default",
    "height_cm": 178.0,
    "sex": "male",
    "age_years": 30,
    "activity": "light",
    "deficit_kcal": 500.0,
}
DEFAULT_WEIGHT_KG = 101.4


def ensure_body_defaults(db: Session) -> BodyProfile:
    profile = db.query(BodyProfile).filter(BodyProfile.id == "default").first()
    if not profile:
        profile = BodyProfile(**DEFAULT_PROFILE)
        db.add(profile)
        db.commit()
        db.refresh(profile)

    today = to_date_key(datetime.now())
    if db.query(WeightEntry).count() == 0:
        db.add(
            WeightEntry(
                id=str(uuid.uuid4()),
                date=today,
                weight_kg=DEFAULT_WEIGHT_KG,
                notes="Starting weight",
            )
        )
        db.commit()
    return profile


def latest_weight(db: Session, on_or_before: str | None = None) -> WeightEntry | None:
    q = db.query(WeightEntry)
    if on_or_before:
        q = q.filter(WeightEntry.date <= on_or_before)
    return q.order_by(WeightEntry.date.desc()).first()


def serialize_weight(row: WeightEntry) -> dict[str, Any]:
    return {
        "id": row.id,
        "date": row.date,
        "weightKg": row.weight_kg,
        "notes": row.notes,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


def serialize_profile(profile: BodyProfile) -> dict[str, Any]:
    return {
        "heightCm": profile.height_cm,
        "sex": profile.sex,
        "ageYears": profile.age_years,
        "activity": profile.activity,
        "deficitKcal": profile.deficit_kcal,
        "updatedAt": int(profile.updated_at.timestamp() * 1000) if profile.updated_at else None,
    }


def compute_targets_for_day(db: Session, date: str) -> dict[str, Any] | None:
    profile = ensure_body_defaults(db)
    weight = latest_weight(db, on_or_before=date)
    if not weight:
        return None
    targets = calorie_targets(
        weight_kg=weight.weight_kg,
        height_cm=profile.height_cm,
        age_years=profile.age_years,
        sex=profile.sex,
        activity=profile.activity,
        deficit_kcal=profile.deficit_kcal,
    )
    targets["weightDate"] = weight.date
    targets["profile"] = serialize_profile(profile)
    return targets
