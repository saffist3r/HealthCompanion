"""Injury cases and daily pain logs — shared serialize helpers."""

from __future__ import annotations

import json
from typing import Any

from app.models import Injury, InjuryPainLog

INJURY_TYPE_LABELS = {
    "sprain": "Sprain",
    "tendinitis": "Tendinitis",
    "muscle_strain": "Muscle strain",
    "bruise": "Bruise",
    "fracture": "Fracture",
    "other": "Other",
}

BODY_AREA_LABELS = {
    "knee_left": "Left knee",
    "knee_right": "Right knee",
    "ankle_left": "Left ankle",
    "ankle_right": "Right ankle",
    "shoulder_left": "Left shoulder",
    "shoulder_right": "Right shoulder",
    "elbow_left": "Left elbow",
    "elbow_right": "Right elbow",
    "wrist_left": "Left wrist",
    "wrist_right": "Right wrist",
    "hip_left": "Left hip",
    "hip_right": "Right hip",
    "lower_back": "Lower back",
    "upper_back": "Upper back",
    "neck": "Neck",
    "foot_left": "Left foot",
    "foot_right": "Right foot",
    "hamstring_left": "Left hamstring",
    "hamstring_right": "Right hamstring",
    "calf_left": "Left calf",
    "calf_right": "Right calf",
    "other": "Other",
}

ACTIVITY_KIND_LABELS = {
    "sport": "Sport",
    "kine": "Kiné",
    "osteo": "Ostéo",
    "podologue": "Podologue",
    "gym": "Gym",
    "other": "Other",
}

INJURY_TYPES = set(INJURY_TYPE_LABELS)
BODY_AREAS = set(BODY_AREA_LABELS)
ACTIVITY_KINDS = set(ACTIVITY_KIND_LABELS)
INJURY_STATUSES = {"active", "healing", "healed"}


def parse_activity_kinds(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out: list[str] = []
    for item in data:
        k = str(item).strip().lower()
        if k in ACTIVITY_KINDS and k not in out:
            out.append(k)
    return out


def body_area_label(area: str, other: str | None = None) -> str:
    if area == "other" and other:
        return other.strip()
    return BODY_AREA_LABELS.get(area, area.replace("_", " ").title())


def serialize_pain_log(row: InjuryPainLog) -> dict[str, Any]:
    kind = row.related_activity_kind
    return {
        "id": row.id,
        "injuryId": row.injury_id,
        "date": row.date,
        "painScore": int(row.pain_score),
        "relatedActivityKind": kind,
        "relatedActivityLabel": ACTIVITY_KIND_LABELS.get(kind or "", kind) if kind else None,
        "notes": row.notes,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


def serialize_injury(
    row: Injury,
    *,
    latest_pain: InjuryPainLog | None = None,
    today_pain: InjuryPainLog | None = None,
    include_recent_pain: list[InjuryPainLog] | None = None,
) -> dict[str, Any]:
    kinds = parse_activity_kinds(row.related_activity_kinds_json)
    return {
        "id": row.id,
        "title": row.title or "",
        "injuryType": row.injury_type,
        "injuryTypeLabel": INJURY_TYPE_LABELS.get(row.injury_type, row.injury_type),
        "bodyArea": row.body_area,
        "bodyAreaOther": row.body_area_other,
        "bodyAreaLabel": body_area_label(row.body_area, row.body_area_other),
        "startedOn": row.started_on,
        "status": row.status,
        "healedOn": row.healed_on,
        "relatedActivityKinds": kinds,
        "relatedActivityLabels": [ACTIVITY_KIND_LABELS.get(k, k) for k in kinds],
        "exerciseNotes": row.exercise_notes,
        "notes": row.notes,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
        "latestPain": serialize_pain_log(latest_pain) if latest_pain else None,
        "todayPain": serialize_pain_log(today_pain) if today_pain else None,
        "recentPain": [serialize_pain_log(p) for p in (include_recent_pain or [])],
    }
