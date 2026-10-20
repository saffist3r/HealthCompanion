"""Constants and serializers shared by the /health-data routers."""

from __future__ import annotations

import json
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    ActivityDay,
    CaffeineLog,
    CareVisit,
    DayCheckIn,
    SportMatch,
    StressLog,
)

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
