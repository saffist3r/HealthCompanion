"""Row → dict serializers used when building daily/weekly reports."""

from __future__ import annotations

import json
from typing import Any

from app.models import (
    CaffeineLog,
    CareVisit,
    DayCheckIn,
    Meal,
    PumpLogEvent,
    SportMatch,
    StressLog,
)
from app.services.labels import (
    ADHD_INTENSITY_LABELS,
    CAFFEINE_DRINK_LABELS,
    CARE_LABELS,
    FOCUS_LABELS,
    MOOD_LABELS,
    PUMP_KIND_LABELS,
    STRESS_LABELS,
    STRESS_SOURCE_LABELS,
    TASK_INITIATION_LABELS,
    WAKE_LABELS,
)
from app.services.upload_urls import signed_upload_url


def serialize_care_visit(row: CareVisit) -> dict[str, Any]:
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


def serialize_sport_match(row: SportMatch) -> dict[str, Any]:
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


def serialize_stress_log(row: StressLog) -> dict[str, Any]:
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


def serialize_day_check_in(row: DayCheckIn) -> dict[str, Any]:
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


def serialize_caffeine_log(row: CaffeineLog) -> dict[str, Any]:
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


def serialize_pump_event(row: PumpLogEvent) -> dict[str, Any]:
    import re

    ts = row.timestamp
    kind = row.kind or "other"
    units = row.units
    label = PUMP_KIND_LABELS.get(kind, (kind or "other").replace("_", " ").title())
    message = (row.message or "").strip()
    blob = f"{message} {row.raw_text or ''} {row.title or ''}"
    if units is None and kind == "insulin_delivered":
        m = re.search(r"(?i)(?:delivered\s+)?(\d+[.,]\d+|\d+)\s*(?:U|IU|units?)\b", blob)
        if m:
            try:
                units = float(m.group(1).replace(",", "."))
            except ValueError:
                units = None
    # Prefer a clean insulin summary when units are known (old rows had Android junk text).
    if kind == "insulin_delivered" and units is not None:
        u = int(units) if float(units).is_integer() else units
        message = f"Delivered {u} U of insulin"
    elif "android.app.Notification" in message or "NotificationCompat" in message or "com.camdiab" in message:
        message = label
    return {
        "id": row.id,
        "kind": kind,
        "kindLabel": label,
        "title": label,
        "message": message,
        "units": units,
        "timestamp": int(ts.timestamp() * 1000) if ts else None,
        "time": ts.strftime("%H:%M") if ts else None,
        "date": ts.strftime("%Y-%m-%d") if ts else None,
    }


def serialize_meal_row(meal: Meal) -> dict[str, Any]:
    from app.services.warnings import resolved_calories_kcal

    try:
        macros = json.loads(meal.macros_json or "{}")
    except json.JSONDecodeError:
        macros = {}
    try:
        items = json.loads(meal.items_json or "[]")
    except json.JSONDecodeError:
        items = []
    if not isinstance(macros, dict):
        macros = {}
    macros["caloriesKcal"] = resolved_calories_kcal(macros)
    eaten = meal.eaten_at
    return {
        "id": meal.id,
        "mealType": meal.meal_type or "other",
        "eatenAt": int(eaten.timestamp() * 1000) if eaten else None,
        "time": eaten.strftime("%H:%M") if eaten else None,
        "macros": macros,
        "notes": meal.notes,
        "aiSummary": meal.ai_summary,
        "items": items if isinstance(items, list) else [],
        "photoPath": meal.photo_path,
        "photoUrl": signed_upload_url(meal.photo_path),
        "photos": _meal_photos_for_report(meal),
        "source": meal.source,
    }


def _meal_photos_for_report(meal: Meal) -> list[dict[str, Any]]:
    try:
        raw = json.loads(getattr(meal, "photos_json", None) or "[]")
        if not isinstance(raw, list):
            raw = []
    except json.JSONDecodeError:
        raw = []
    out: list[dict[str, Any]] = []
    for e in raw:
        if not isinstance(e, dict) or not e.get("path"):
            continue
        path = str(e["path"])
        out.append(
            {
                "path": path,
                "url": signed_upload_url(path),
                "role": e.get("role") or "other",
                "label": e.get("label"),
            }
        )
    if not out and meal.photo_path:
        out.append(
            {
                "path": meal.photo_path,
                "url": signed_upload_url(meal.photo_path),
                "role": "main",
                "label": None,
            }
        )
    return out


def sum_meal_macros(meals: list[Meal]) -> dict[str, float]:
    from app.services.warnings import resolved_calories_kcal

    macros = {"carbsG": 0.0, "proteinG": 0.0, "fatG": 0.0, "fiberG": 0.0, "caloriesKcal": 0.0, "sugarG": 0.0}
    for meal in meals:
        try:
            m = json.loads(meal.macros_json or "{}")
        except json.JSONDecodeError:
            continue
        for k in macros:
            if k == "caloriesKcal":
                macros[k] += resolved_calories_kcal(m)
            else:
                macros[k] += float(m.get(k) or 0)
    return {k: round(v * 10) / 10 for k, v in macros.items()}
