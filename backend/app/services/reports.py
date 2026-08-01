from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from app.core.config import get_settings
from app.models import ActivityDay, CareVisit, GlucoseSample, Meal, PumpLogEvent, SportMatch, StressLog


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
PUMP_KIND_LABELS = {
    "insulin_delivered": "Insulin delivered",
    "high": "High glucose",
    "low": "Low glucose",
    "urgent_low": "Urgent low",
    "reservoir": "Reservoir",
    "battery": "Battery",
    "occlusion": "Occlusion",
    "sensor": "Sensor",
    "alert": "Alert",
    "other": "Pump event",
}


def to_date_key(dt: datetime) -> str:
    return dt.astimezone().strftime("%Y-%m-%d") if dt.tzinfo else dt.strftime("%Y-%m-%d")


def to_mg_dl(value: float, unit: str) -> float:
    return value if unit.lower() == "mg/dl" else value * 18.0182


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


def build_daily_report(
    *,
    date: str,
    meals: list[Meal],
    glucose: list[GlucoseSample],
    activity: ActivityDay | None,
    care_visits: list[CareVisit] | None = None,
    sport_matches: list[SportMatch] | None = None,
    stress_logs: list[StressLog] | None = None,
    pump_events: list[PumpLogEvent] | None = None,
    injuries: list[dict[str, Any]] | None = None,
    calorie_targets: dict[str, Any] | None = None,
    weight: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.services.body_calories import intake_vs_targets

    settings = get_settings()
    macros = _sum_meal_macros(meals)
    glucose_summary = _glucose_summary(date, glucose)
    care = [serialize_care_visit(v) for v in (care_visits or [])]
    matches = [serialize_sport_match(m) for m in (sport_matches or [])]
    stress = [serialize_stress_log(s) for s in (stress_logs or [])]
    pump = [serialize_pump_event(p) for p in (pump_events or [])]
    injury_list = list(injuries or [])
    activity_summary = None
    if activity:
        try:
            workouts = json.loads(activity.workouts_json or "[]")
        except json.JSONDecodeError:
            workouts = []
        activity_summary = {
            "date": activity.date,
            "steps": activity.steps,
            "activeMinutes": activity.active_minutes,
            "caloriesBurned": activity.calories_burned,
            "energyScore": activity.energy_score,
            "source": activity.source,
            "workouts": workouts,
            "syncedAt": int(activity.synced_at.timestamp() * 1000) if activity.synced_at else None,
        }

    calorie_balance = intake_vs_targets(macros.get("caloriesKcal") or 0, calorie_targets)

    insights: list[str] = []
    warnings: list[dict[str, str]] = []

    if not meals:
        insights.append("No meals logged this day.")
    else:
        insights.append(
            f"{len(meals)} meal(s): ~{int(macros['caloriesKcal'])} kcal, "
            f"{macros['carbsG']}g carbs, {macros['proteinG']}g protein."
        )

    if calorie_targets:
        insights.append(
            f"Targets: maintenance {calorie_targets['maintenanceKcal']} kcal · "
            f"deficit goal {calorie_targets['targetKcal']} kcal "
            f"(−{int(calorie_targets['deficitKcal'])})."
        )
        if calorie_balance:
            rem = calorie_balance["remainingToTarget"]
            if rem >= 0:
                insights.append(f"{rem} kcal left to stay under deficit target.")
            else:
                insights.append(f"{abs(rem)} kcal over deficit target today.")
                warnings.append(
                    {
                        "severity": "caution",
                        "title": "Over calorie target",
                        "message": (
                            f"Intake {calorie_balance['intakeKcal']} kcal vs target "
                            f"{calorie_balance['targetKcal']} kcal."
                        ),
                    }
                )

    if macros["carbsG"] > settings.daily_carb_target_g:
        warnings.append(
            {
                "severity": "caution",
                "title": "Above daily carb target",
                "message": (
                    f"Logged {macros['carbsG']}g carbs vs target {settings.daily_carb_target_g}g."
                ),
            }
        )

    if glucose_summary["timeInRangePct"] is not None:
        insights.append(f"Time in range (70–180): {glucose_summary['timeInRangePct']}%.")
        if glucose_summary["timeInRangePct"] < 50:
            warnings.append(
                {
                    "severity": "alert",
                    "title": "Low time in range",
                    "message": "Less than half of readings were in range today.",
                }
            )
    else:
        insights.append("No glucose samples synced for this day.")

    hypo_events = glucose_summary.get("hypoEvents") or []
    hypo_count = int(glucose_summary.get("hypoEventCount") or 0)
    if hypo_count > 0:
        first = hypo_events[0]
        start_ms = first.get("startedAt") or 0
        try:
            clock = datetime.fromtimestamp(start_ms / 1000).strftime("%H:%M")
        except (OSError, ValueError, OverflowError):
            clock = "—"
        insights.append(
            f"{hypo_count} hypoglycemia episode(s) (<70 mg/dL); "
            f"lowest {glucose_summary.get('minMgDl')} mg/dL · first ~{clock}."
        )
        warnings.append(
            {
                "severity": "alert",
                "title": "Hypoglycemia",
                "message": (
                    f"{hypo_count} episode(s) below 70 mg/dL today "
                    f"(min {glucose_summary.get('minMgDl')} mg/dL). "
                    "Treat per your care plan."
                ),
            }
        )
    elif (glucose_summary.get("lowCount") or 0) > 0:
        insights.append(
            f"{glucose_summary['lowCount']} reading(s) below 70 mg/dL."
        )
    if activity_summary:
        insights.append(f"{activity_summary['steps']:,} steps.")
        if activity_summary.get("energyScore") is not None:
            insights.append(f"Energy score: {int(round(activity_summary['energyScore']))}.")
        workouts = activity_summary.get("workouts") or []
        if workouts:
            mins = sum(int(w.get("durationMin") or 0) for w in workouts if isinstance(w, dict))
            insights.append(f"{len(workouts)} workout(s) · {mins} min total.")
        if activity_summary.get("caloriesBurned"):
            insights.append(f"~{int(activity_summary['caloriesBurned'])} active kcal.")

    for v in care:
        label = v.get("label") or v.get("kindLabel") or "Care visit"
        insights.append(f"Care: {label}.")

    for m in matches:
        sport = (m.get("sport") or "match")
        sport_label = sport if any(c.isupper() for c in sport) else sport.capitalize()
        result = m.get("result") or "?"
        score = m.get("score") or ""
        intensity = m.get("intensity")
        bits = [f"{sport_label}: {result}"]
        if score:
            bits.append(score)
        if intensity:
            bits.append(f"intensity {intensity}")
        if m.get("durationMin"):
            bits.append(f"{m['durationMin']} min")
        insights.append(" · ".join(bits) + ".")

    for s in stress:
        label = s.get("levelLabel") or s.get("level") or "stress"
        score = s.get("score")
        insights.append(
            f"Stress: {label}" + (f" ({score})" if score is not None else "") + "."
        )

    for inj in injury_list:
        area = inj.get("bodyAreaLabel") or inj.get("bodyArea") or "injury"
        title = inj.get("title") or inj.get("injuryTypeLabel") or "Injury"
        today_p = inj.get("todayPain")
        if today_p and today_p.get("painScore") is not None:
            insights.append(f"Injury pain: {title} ({area}) · {today_p['painScore']}/10.")
        elif inj.get("status") in ("active", "healing"):
            insights.append(f"Open injury: {title} ({area}) since {inj.get('startedOn')}.")

    insulin_total = sum(float(p.get("units") or 0) for p in pump if p.get("kind") == "insulin_delivered")
    if pump:
        insights.append(
            f"Pump log: {len(pump)} event(s)"
            + (f" · {round(insulin_total, 2)} U insulin delivered" if insulin_total else "")
            + "."
        )

    if weight:
        insights.append(f"Weight: {weight.get('weightKg')} kg" + (f" ({weight.get('date')})." if weight.get("date") else "."))

    meal_rows = [_serialize_meal_row(m) for m in meals]

    report: dict[str, Any] = {
        "date": date,
        "generatedAt": int(datetime.now().timestamp() * 1000),
        "nutrition": {"date": date, "mealCount": len(meals), "macros": macros},
        "meals": meal_rows,
        "glucose": glucose_summary,
        "activity": activity_summary,
        "careVisits": care,
        "sportMatches": matches,
        "stressLogs": stress,
        "injuries": injury_list,
        "pumpEvents": pump,
        "weight": weight,
        "calorieTargets": calorie_targets,
        "calorieBalance": calorie_balance,
        "insights": insights,
        "warnings": warnings,
    }
    report["agentPrompt"] = build_day_activity_prompt(report)
    return report


def build_day_activity_prompt(daily: dict[str, Any]) -> str:
    """Copy-paste briefing for an external AI agent covering the full day."""
    date = daily.get("date") or "unknown date"
    lines: list[str] = [
        f"You are my health companion AI agent. Below is a structured summary of my day ({date}).",
        "Please give me a concise debrief: what went well, risks to watch (especially glucose and insulin),",
        "and 2–3 practical adjustments for tomorrow. Keep it actionable and brief.",
        "",
        "## Glucose",
    ]
    g = daily.get("glucose") or {}
    if g.get("readingCount"):
        lines.append(
            f"- Readings: {g.get('readingCount')} · avg {g.get('avgMgDl')} mg/dL · "
            f"min {g.get('minMgDl')} · max {g.get('maxMgDl')}"
        )
        if g.get("timeInRangePct") is not None:
            lines.append(f"- Time in range (70–180): {g.get('timeInRangePct')}%")
        hypo = int(g.get("hypoEventCount") or 0)
        if hypo:
            lines.append(f"- Hypoglycemia episodes (<70): {hypo}")
        if g.get("lowCount"):
            lines.append(f"- Low readings: {g.get('lowCount')} · high readings: {g.get('highCount') or 0}")
    else:
        lines.append("- No glucose samples synced.")

    lines.append("")
    lines.append("## Nutrition")
    nut = daily.get("nutrition") or {}
    macros = nut.get("macros") or {}
    lines.append(
        f"- Meals: {nut.get('mealCount') or 0} · ~{int(macros.get('caloriesKcal') or 0)} kcal · "
        f"carbs {macros.get('carbsG') or 0}g · protein {macros.get('proteinG') or 0}g · "
        f"fat {macros.get('fatG') or 0}g"
    )
    targets = daily.get("calorieTargets") or {}
    balance = daily.get("calorieBalance") or {}
    if targets:
        lines.append(
            f"- Calorie targets: maintenance {targets.get('maintenanceKcal')} · "
            f"deficit goal {targets.get('targetKcal')}"
        )
    if balance:
        rem = balance.get("remainingToTarget")
        if rem is not None:
            if rem >= 0:
                lines.append(f"- Remaining to deficit target: {rem} kcal")
            else:
                lines.append(f"- Over deficit target by {abs(rem)} kcal")
    for meal in daily.get("meals") or []:
        clock = meal.get("time") or "—"
        mtype = meal.get("mealType") or "meal"
        mm = meal.get("macros") or {}
        summary = meal.get("aiSummary") or meal.get("notes") or ""
        bit = (
            f"- {clock} {mtype}: {int(mm.get('caloriesKcal') or 0)} kcal, "
            f"{mm.get('carbsG') or 0}g carbs"
        )
        if summary:
            bit += f" — {str(summary).strip()[:160]}"
        lines.append(bit)

    lines.append("")
    lines.append("## Activity & sport")
    act = daily.get("activity")
    if act:
        lines.append(f"- Steps: {act.get('steps') or 0:,}")
        if act.get("energyScore") is not None:
            lines.append(f"- Energy score: {int(round(act['energyScore']))}")
        if act.get("caloriesBurned"):
            lines.append(f"- Active kcal: ~{int(act['caloriesBurned'])}")
        for w in act.get("workouts") or []:
            if isinstance(w, dict):
                lines.append(
                    f"- Workout: {w.get('name') or 'Workout'} · {w.get('durationMin') or 0} min"
                    + (f" · {w.get('calories')} kcal" if w.get("calories") is not None else "")
                )
    else:
        lines.append("- No phone activity synced.")
    matches = daily.get("sportMatches") or []
    if matches:
        for m in matches:
            sport = m.get("sport") or "sport"
            bits = [str(sport), str(m.get("result") or "")]
            if m.get("score"):
                bits.append(str(m["score"]))
            if m.get("intensity"):
                bits.append(f"intensity {m['intensity']}")
            if m.get("durationMin") is not None:
                bits.append(f"{m['durationMin']} min")
            if m.get("time"):
                bits.append(str(m["time"]))
            if m.get("notes"):
                bits.append(str(m["notes"]))
            lines.append("- Sport: " + " · ".join(b for b in bits if b))
    else:
        lines.append("- No logged sport sessions.")

    lines.append("")
    lines.append("## Care & stress")
    care = daily.get("careVisits") or []
    if care:
        for v in care:
            label = v.get("label") or v.get("kindLabel") or v.get("kind") or "Care"
            note = f" — {v['notes']}" if v.get("notes") else ""
            lines.append(f"- Care: {label}{note}")
    else:
        lines.append("- No care visits.")
    stress = daily.get("stressLogs") or []
    if stress:
        for s in stress:
            label = s.get("levelLabel") or s.get("level") or "stress"
            score = f" ({s['score']})" if s.get("score") is not None else ""
            note = f" — {s['notes']}" if s.get("notes") else ""
            lines.append(f"- Stress: {label}{score}{note}")
    else:
        lines.append("- No stress check-ins.")

    lines.append("")
    lines.append("## Injuries & pain")
    injuries = daily.get("injuries") or []
    if injuries:
        for inj in injuries:
            title = inj.get("title") or inj.get("injuryTypeLabel") or "Injury"
            area = inj.get("bodyAreaLabel") or inj.get("bodyArea") or "?"
            status = inj.get("status") or "active"
            bits = [f"{title}", f"area {area}", f"since {inj.get('startedOn')}", f"status {status}"]
            tags = inj.get("relatedActivityLabels") or inj.get("relatedActivityKinds") or []
            if tags:
                bits.append("related to " + ", ".join(str(t) for t in tags))
            today_p = inj.get("todayPain")
            if today_p and today_p.get("painScore") is not None:
                bits.append(f"today pain {today_p['painScore']}/10")
                if today_p.get("relatedActivityLabel") or today_p.get("relatedActivityKind"):
                    bits.append(
                        f"after {today_p.get('relatedActivityLabel') or today_p.get('relatedActivityKind')}"
                    )
                if today_p.get("notes"):
                    bits.append(str(today_p["notes"]))
            lines.append("- " + " · ".join(str(b) for b in bits if b))
            if inj.get("exerciseNotes"):
                lines.append(f"  Exercises: {inj['exerciseNotes']}")
            if inj.get("notes"):
                lines.append(f"  Notes: {inj['notes']}")
    else:
        lines.append("- No open injuries or pain logs today.")

    lines.append("")
    lines.append("## Pump / insulin")
    pump = daily.get("pumpEvents") or []
    if pump:
        insulin = sum(float(p.get("units") or 0) for p in pump if p.get("kind") == "insulin_delivered")
        lines.append(f"- Events: {len(pump)}" + (f" · insulin delivered {round(insulin, 2)} U" if insulin else ""))
        for p in pump[:12]:
            clock = p.get("time") or "—"
            label = p.get("kindLabel") or p.get("kind") or "event"
            msg = p.get("message") or ""
            units = p.get("units")
            bit = f"- {clock} {label}"
            if units is not None:
                bit += f" · {units} U"
            elif msg and msg != label:
                bit += f" — {msg[:120]}"
            lines.append(bit)
    else:
        lines.append("- No pump events.")

    weight = daily.get("weight")
    if weight and weight.get("weightKg") is not None:
        lines.append("")
        lines.append("## Weight")
        lines.append(f"- {weight.get('weightKg')} kg" + (f" ({weight.get('date')})" if weight.get("date") else ""))

    warns = daily.get("warnings") or []
    if warns:
        lines.append("")
        lines.append("## Warnings")
        for w in warns:
            lines.append(f"- [{w.get('severity')}] {w.get('title')}: {w.get('message')}")

    return "\n".join(lines).strip() + "\n"


def build_weekly_report(*, week_start: str, week_end: str, days: list[dict[str, Any]]) -> dict[str, Any]:
    macros = {"carbsG": 0.0, "proteinG": 0.0, "fatG": 0.0, "fiberG": 0.0, "caloriesKcal": 0.0, "sugarG": 0.0}
    meal_count = 0
    total_steps = 0
    total_workout_min = 0
    total_workouts = 0
    total_active_kcal = 0.0
    total_care = 0
    total_matches = 0
    total_stress = 0
    stress_high = 0
    padel_wins = 0
    padel_losses = 0
    gym_sessions = 0
    gym_minutes = 0
    hypo_events_total = 0
    tir_values: list[float] = []
    avg_glucose: list[float] = []
    recent_workouts: list[dict[str, Any]] = []
    recent_care: list[dict[str, Any]] = []
    recent_matches: list[dict[str, Any]] = []
    recent_stress: list[dict[str, Any]] = []
    recent_hypos: list[dict[str, Any]] = []

    for d in days:
        meal_count += d["nutrition"]["mealCount"]
        act = d.get("activity") or {}
        total_steps += act.get("steps") or 0
        if act.get("caloriesBurned"):
            total_active_kcal += float(act["caloriesBurned"])
        workouts = act.get("workouts") or []
        for w in workouts:
            if not isinstance(w, dict):
                continue
            total_workouts += 1
            total_workout_min += int(w.get("durationMin") or 0)
            recent_workouts.append(
                {
                    "date": d["date"],
                    "name": w.get("name") or "Workout",
                    "durationMin": int(w.get("durationMin") or 0),
                    "calories": w.get("calories"),
                    "sportType": w.get("sportType"),
                }
            )
        for v in d.get("careVisits") or []:
            total_care += 1
            recent_care.append(v)
        for m in d.get("sportMatches") or []:
            total_matches += 1
            recent_matches.append(m)
            sport = (m.get("sport") or "").lower()
            if sport == "padel":
                if m.get("result") == "win":
                    padel_wins += 1
                elif m.get("result") == "loss":
                    padel_losses += 1
            elif sport == "gym":
                gym_sessions += 1
                gym_minutes += int(m.get("durationMin") or 0)
        for s in d.get("stressLogs") or []:
            total_stress += 1
            recent_stress.append(s)
            if s.get("level") == "high":
                stress_high += 1
        for h in d.get("glucose", {}).get("hypoEvents") or []:
            hypo_events_total += 1
            recent_hypos.append({**h, "date": d["date"]})
        m = d["nutrition"]["macros"]
        for k in macros:
            macros[k] += m.get(k) or 0
        if d["glucose"]["timeInRangePct"] is not None:
            tir_values.append(d["glucose"]["timeInRangePct"])
        if d["glucose"]["avgMgDl"] is not None:
            avg_glucose.append(d["glucose"]["avgMgDl"])

    for k in macros:
        macros[k] = round(macros[k] * 10) / 10

    insights = [
        f"{meal_count} meals logged across the week.",
        f"Total carbs ~{round(macros['carbsG'])}g.",
        f"Total steps: {total_steps:,}.",
    ]
    if total_workouts:
        insights.append(f"{total_workouts} workouts · {total_workout_min} min this week.")
    if total_care:
        insights.append(f"{total_care} care visit(s) this week.")
    if total_matches:
        insights.append(f"{total_matches} sport session(s) this week.")
        if padel_wins or padel_losses:
            insights.append(f"Padel: {padel_wins}W–{padel_losses}L.")
        if gym_sessions:
            insights.append(f"Gym: {gym_sessions} session(s) · {gym_minutes} min.")
    if hypo_events_total:
        insights.append(f"{hypo_events_total} hypoglycemia episode(s) this week.")
    if total_stress:
        insights.append(f"{total_stress} stress check-in(s)" + (f" · {stress_high} high" if stress_high else "") + ".")
    if tir_values:
        avg_tir = sum(tir_values) / len(tir_values)
        insights.append(f"Average time in range: {round(avg_tir * 10) / 10}%.")

    return {
        "weekStart": week_start,
        "weekEnd": week_end,
        "generatedAt": int(datetime.now().timestamp() * 1000),
        "days": days,
        "totals": {
            "macros": macros,
            "mealCount": meal_count,
            "avgGlucoseMgDl": _avg(avg_glucose),
            "avgTimeInRangePct": _avg(tir_values),
            "totalSteps": total_steps,
            "workoutCount": total_workouts,
            "workoutMinutes": total_workout_min,
            "activeCalories": round(total_active_kcal),
            "careVisitCount": total_care,
            "sportMatchCount": total_matches,
            "padelWins": padel_wins,
            "padelLosses": padel_losses,
            "gymSessionCount": gym_sessions,
            "gymMinutes": gym_minutes,
            "hypoEventCount": hypo_events_total,
            "stressLogCount": total_stress,
            "stressHighCount": stress_high,
        },
        "workouts": list(reversed(recent_workouts))[-20:],
        "careVisits": list(reversed(recent_care))[-20:],
        "sportMatches": list(reversed(recent_matches))[-20:],
        "stressLogs": list(reversed(recent_stress))[-20:],
        "hypoEvents": list(reversed(recent_hypos))[-30:],
        "insights": insights,
    }


def monday_of(date_key: str) -> str:
    d = datetime.strptime(date_key, "%Y-%m-%d")
    diff = d.weekday()  # Mon=0
    return (d - timedelta(days=diff)).strftime("%Y-%m-%d")


def list_date_keys(start: str, end: str) -> list[str]:
    cur = datetime.strptime(start, "%Y-%m-%d")
    last = datetime.strptime(end, "%Y-%m-%d")
    out: list[str] = []
    while cur <= last:
        out.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return out


def _serialize_meal_row(meal: Meal) -> dict[str, Any]:
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
        "photoUrl": f"/uploads/{meal.photo_path}" if meal.photo_path else None,
        "source": meal.source,
    }


def _sum_meal_macros(meals: list[Meal]) -> dict[str, float]:
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


def _glucose_summary(date: str, samples: list[GlucoseSample]) -> dict[str, Any]:
    if not samples:
        return {
            "date": date,
            "readingCount": 0,
            "avgMgDl": None,
            "minMgDl": None,
            "maxMgDl": None,
            "timeInRangePct": None,
            "lowCount": 0,
            "highCount": 0,
            "hypoEventCount": 0,
            "hypoEvents": [],
        }
    ordered = sorted(samples, key=lambda s: s.timestamp or datetime.min)
    points = [
        {
            "mgDl": to_mg_dl(s.value, s.unit),
            "timestamp": int(s.timestamp.timestamp() * 1000) if s.timestamp else 0,
        }
        for s in ordered
    ]
    mg = [p["mgDl"] for p in points]
    in_range = [v for v in mg if 70 <= v <= 180]
    hypo_events = _hypo_events(points)
    return {
        "date": date,
        "readingCount": len(mg),
        "avgMgDl": round(sum(mg) / len(mg) * 10) / 10,
        "minMgDl": round(min(mg) * 10) / 10,
        "maxMgDl": round(max(mg) * 10) / 10,
        "timeInRangePct": round(len(in_range) / len(mg) * 1000) / 10,
        "lowCount": len([v for v in mg if v < 70]),
        "highCount": len([v for v in mg if v > 180]),
        "hypoEventCount": len(hypo_events),
        "hypoEvents": hypo_events,
    }


HYPO_THRESHOLD_MGDL = 70.0
# Gap between low readings that starts a new episode (ms)
HYPO_GAP_MS = 30 * 60 * 1000


def _hypo_events(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse contiguous readings < 70 mg/dL into hypoglycemia episodes."""
    events: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def close() -> None:
        nonlocal current
        if not current:
            return
        start = int(current["startedAt"])
        end = int(current["endedAt"])
        duration = max(0, round((end - start) / 60000))
        events.append(
            {
                "startedAt": start,
                "endedAt": end,
                "minMgDl": round(float(current["minMgDl"]) * 10) / 10,
                "readingCount": int(current["readingCount"]),
                "durationMin": duration,
            }
        )
        current = None

    for p in points:
        mg = float(p["mgDl"])
        ts = int(p["timestamp"] or 0)
        if mg < HYPO_THRESHOLD_MGDL:
            if current is None:
                current = {
                    "startedAt": ts,
                    "endedAt": ts,
                    "minMgDl": mg,
                    "readingCount": 1,
                }
            elif ts - int(current["endedAt"]) > HYPO_GAP_MS:
                close()
                current = {
                    "startedAt": ts,
                    "endedAt": ts,
                    "minMgDl": mg,
                    "readingCount": 1,
                }
            else:
                current["endedAt"] = ts
                current["minMgDl"] = min(float(current["minMgDl"]), mg)
                current["readingCount"] = int(current["readingCount"]) + 1
        else:
            close()
    close()
    return events


def _avg(nums: list[float]) -> float | None:
    if not nums:
        return None
    return round(sum(nums) / len(nums) * 10) / 10
