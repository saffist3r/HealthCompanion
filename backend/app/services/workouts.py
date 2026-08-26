"""Workout plan serialization and context for Gemini."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models import ActivityDay, BodyProfile, Injury, InjuryPainLog, SportMatch, WorkoutPlan
from app.services.injuries import body_area_label
from app.services.reports import to_date_key


def serialize_workout_plan(row: WorkoutPlan) -> dict[str, Any]:
    try:
        exercises = json.loads(row.exercises_json or "[]")
    except json.JSONDecodeError:
        exercises = []
    based_on = None
    try:
        ctx = json.loads(row.prompt_context_json or "{}")
        based_on = ctx.get("basedOnSummary") or ctx.get("basedOn")
    except json.JSONDecodeError:
        pass
    return {
        "id": row.id,
        "title": row.title,
        "focus": row.focus,
        "durationMin": row.duration_min,
        "summary": row.summary,
        "exercises": exercises if isinstance(exercises, list) else [],
        "source": row.source,
        "notes": row.notes,
        "basedOn": based_on,
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


def build_workout_context(
    db: Session,
    *,
    device_ids: list[str],
    user_note: str | None = None,
) -> dict[str, Any]:
    today = to_date_key(datetime.now())
    start = to_date_key(datetime.now() - timedelta(days=7))

    sport_rows = (
        db.query(SportMatch)
        .filter(SportMatch.device_id.in_(device_ids), SportMatch.date >= start)
        .order_by(SportMatch.date.desc(), SportMatch.created_at.desc())
        .limit(20)
        .all()
    )
    activity_rows = (
        db.query(ActivityDay)
        .filter(ActivityDay.device_id.in_(device_ids), ActivityDay.date >= start)
        .order_by(ActivityDay.date.desc())
        .limit(7)
        .all()
    )
    injury_rows = (
        db.query(Injury)
        .filter(Injury.device_id.in_(device_ids), Injury.status.in_(("active", "healing")))
        .order_by(Injury.started_on.desc())
        .limit(10)
        .all()
    )

    injuries: list[dict[str, Any]] = []
    for inj in injury_rows:
        latest = (
            db.query(InjuryPainLog)
            .filter(InjuryPainLog.injury_id == inj.id)
            .order_by(InjuryPainLog.date.desc())
            .first()
        )
        injuries.append(
            {
                "title": inj.title,
                "type": inj.injury_type,
                "bodyArea": body_area_label(inj.body_area, inj.body_area_other),
                "status": inj.status,
                "startedOn": inj.started_on,
                "latestPain": latest.pain_score if latest else None,
                "exerciseNotes": inj.exercise_notes,
            }
        )

    sport = [
        {
            "date": r.date,
            "sport": r.sport,
            "result": r.result,
            "durationMin": r.duration_min,
            "intensity": r.intensity,
            "notes": r.notes,
        }
        for r in sport_rows
    ]

    activity_days: list[dict[str, Any]] = []
    synced_workouts: list[dict[str, Any]] = []
    for row in activity_rows:
        try:
            workouts = json.loads(row.workouts_json or "[]")
        except json.JSONDecodeError:
            workouts = []
        activity_days.append(
            {
                "date": row.date,
                "steps": row.steps,
                "activeMinutes": row.active_minutes,
                "energyScore": row.energy_score,
            }
        )
        if isinstance(workouts, list):
            for w in workouts[:5]:
                if isinstance(w, dict):
                    synced_workouts.append(
                        {
                            "date": row.date,
                            "name": w.get("name"),
                            "durationMin": w.get("durationMin"),
                            "sportType": w.get("sportType"),
                        }
                    )

    profile = db.query(BodyProfile).filter(BodyProfile.id == "default").first()
    activity_level = profile.activity if profile else "light"

    summary_bits: list[str] = []
    if sport:
        summary_bits.append(f"{len(sport)} sport session(s) in the last 7 days")
    if synced_workouts:
        summary_bits.append(f"{len(synced_workouts)} synced workout(s)")
    if injuries:
        summary_bits.append(f"{len(injuries)} open injury case(s)")
    if user_note:
        summary_bits.append(f"user request: {user_note.strip()[:120]}")
    based_on_summary = "; ".join(summary_bits) if summary_bits else "general fitness session"

    return {
        "today": today,
        "activityLevel": activity_level,
        "userNote": (user_note or "").strip() or None,
        "sportSessions": sport,
        "activityDays": activity_days,
        "syncedWorkouts": synced_workouts[:15],
        "openInjuries": injuries,
        "basedOnSummary": based_on_summary,
    }
