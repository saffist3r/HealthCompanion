"""Daily and weekly report builders (nutrition, glucose, activity, mental, care)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.core.config import get_settings
from app.models import (
    ActivityDay,
    CaffeineLog,
    CareVisit,
    DayCheckIn,
    GlucoseSample,
    Meal,
    PumpLogEvent,
    SportMatch,
    StressLog,
)
from app.services.glucose_stats import (
    avg,
    overnight_from_samples,
    summarize_glucose,
)
from app.services.report_prompt import (
    build_day_activity_prompt,
)
from app.services.report_serializers import (
    serialize_caffeine_log,
    serialize_care_visit,
    serialize_day_check_in,
    serialize_meal_row,
    serialize_pump_event,
    serialize_sport_match,
    serialize_stress_log,
    sum_meal_macros,
)

PARIS = ZoneInfo("Europe/Paris")


def to_date_key(dt: datetime) -> str:
    return dt.astimezone().strftime("%Y-%m-%d") if dt.tzinfo else dt.strftime("%Y-%m-%d")


def paris_date_key(dt: datetime | None = None) -> str:
    """Calendar date in Europe/Paris (household timezone)."""
    now = dt or datetime.now(tz=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(PARIS).strftime("%Y-%m-%d")


def paris_yesterday_key(dt: datetime | None = None) -> str:
    """Completed report day: yesterday in Europe/Paris."""
    now = dt or datetime.now(tz=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    local = now.astimezone(PARIS) - timedelta(days=1)
    return local.strftime("%Y-%m-%d")


def paris_day_bounds(date: str) -> tuple[datetime, datetime]:
    """UTC [start, end) covering one Europe/Paris calendar day.

    Meals/glucose are stored as timestamptz UTC; naive midnight–midnight UTC
    shifts Tunisian evenings onto the wrong report day.
    """
    local_start = datetime.strptime(date, "%Y-%m-%d").replace(
        hour=0, minute=0, second=0, microsecond=0, tzinfo=PARIS
    )
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)


def build_daily_report(
    *,
    date: str,
    meals: list[Meal],
    glucose: list[GlucoseSample],
    activity: ActivityDay | None,
    care_visits: list[CareVisit] | None = None,
    sport_matches: list[SportMatch] | None = None,
    stress_logs: list[StressLog] | None = None,
    day_check_in: DayCheckIn | None = None,
    caffeine_logs: list[CaffeineLog] | None = None,
    pump_events: list[PumpLogEvent] | None = None,
    injuries: list[dict[str, Any]] | None = None,
    workout_plans: list[dict[str, Any]] | None = None,
    calorie_targets: dict[str, Any] | None = None,
    weight: dict[str, Any] | None = None,
    glucose_targets: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.services.body_calories import intake_vs_targets
    from app.services.body_profile import (
        DEFAULT_CARB_TARGET_G,
        DEFAULT_TIR_GOAL_PCT,
        DEFAULT_TIR_HIGH,
        DEFAULT_TIR_LOW,
        glucose_targets_from_profile,
    )

    settings = get_settings()
    targets = glucose_targets or glucose_targets_from_profile(None)
    tir_low = float(targets.get("tirLowMgDl") or DEFAULT_TIR_LOW)
    tir_high = float(targets.get("tirHighMgDl") or DEFAULT_TIR_HIGH)
    tir_goal = float(targets.get("tirGoalPct") or DEFAULT_TIR_GOAL_PCT)
    carb_target = float(targets.get("dailyCarbTargetG") or settings.daily_carb_target_g or DEFAULT_CARB_TARGET_G)
    macros = sum_meal_macros(meals)
    glucose_summary = summarize_glucose(date, glucose, tir_low=tir_low, tir_high=tir_high)
    care = [serialize_care_visit(v) for v in (care_visits or [])]
    matches = [serialize_sport_match(m) for m in (sport_matches or [])]
    stress = [serialize_stress_log(s) for s in (stress_logs or [])]
    check_in = serialize_day_check_in(day_check_in) if day_check_in else None
    caffeine = [serialize_caffeine_log(c) for c in (caffeine_logs or [])]
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

    if macros["carbsG"] > carb_target:
        warnings.append(
            {
                "severity": "caution",
                "title": "Above daily carb target",
                "message": (
                    f"Logged {macros['carbsG']}g carbs vs target {carb_target:g}g."
                ),
            }
        )

    range_label = f"{tir_low:g}–{tir_high:g}"
    if glucose_summary["timeInRangePct"] is not None:
        insights.append(
            f"Time in range ({range_label}): {glucose_summary['timeInRangePct']}% "
            f"(goal ≥{tir_goal:g}%)."
        )
        if glucose_summary["timeInRangePct"] < tir_goal:
            warnings.append(
                {
                    "severity": "alert" if glucose_summary["timeInRangePct"] < max(40.0, tir_goal * 0.7) else "caution",
                    "title": "Below TIR goal",
                    "message": (
                        f"Time in range {glucose_summary['timeInRangePct']}% "
                        f"vs personal goal {tir_goal:g}% ({range_label} mg/dL)."
                    ),
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
            f"{hypo_count} hypoglycemia episode(s) (<{tir_low:g} mg/dL); "
            f"lowest {glucose_summary.get('minMgDl')} mg/dL · first ~{clock}."
        )
        warnings.append(
            {
                "severity": "alert",
                "title": "Hypoglycemia",
                "message": (
                    f"{hypo_count} episode(s) below {tir_low:g} mg/dL today "
                    f"(min {glucose_summary.get('minMgDl')} mg/dL). "
                    "Treat per your care plan."
                ),
            }
        )
    elif (glucose_summary.get("lowCount") or 0) > 0:
        insights.append(
            f"{glucose_summary['lowCount']} reading(s) below {tir_low:g} mg/dL."
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
        src = s.get("sourceLabel") or s.get("source")
        bit = f"Stress: {label}"
        if score is not None:
            bit += f" ({score})"
        if src and s.get("source") == "samsung_energy":
            bit += " · Samsung Energy"
        insights.append(bit + ".")

    if check_in:
        mood = check_in.get("moodLabel") or check_in.get("mood") or "mood"
        wake = check_in.get("wakeQualityLabel") or check_in.get("wakeQuality") or "wake"
        focus = check_in.get("focusLabel") or check_in.get("focus")
        bits = [f"mood {mood}", f"woke {wake}"]
        if focus:
            bits.append(f"focus {focus}")
        if check_in.get("overwhelm") == "high":
            bits.append("high overwhelm")
        if check_in.get("medicationTaken"):
            bits.append("meds taken")
        if check_in.get("hyperfocus"):
            bits.append("hyperfocus")
        if check_in.get("sleepHours") is not None:
            bits.append(f"sleep {check_in['sleepHours']}h")
        insights.append("Check-in: " + " · ".join(bits) + ".")

    if caffeine:
        total_mg = sum(int(c.get("caffeineMg") or 0) for c in caffeine)
        drinks = ", ".join(
            (c.get("drinkLabel") or c.get("drink") or "drink") for c in caffeine[:4]
        )
        more = f" +{len(caffeine) - 4}" if len(caffeine) > 4 else ""
        insights.append(f"Caffeine: {total_mg} mg · {drinks}{more}.")

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

    meal_rows = [serialize_meal_row(m) for m in meals]

    overnight = overnight_from_samples(date, glucose)
    for h in glucose_summary.get("hypoEvents") or []:
        h["kind"] = "hypo"
    for h in glucose_summary.get("hyperEvents") or []:
        h["kind"] = "hyper"
    if overnight.get("blurb"):
        insights.insert(0, overnight["blurb"])

    report: dict[str, Any] = {
        "date": date,
        "generatedAt": int(datetime.now().timestamp() * 1000),
        "nutrition": {"date": date, "mealCount": len(meals), "macros": macros},
        "meals": meal_rows,
        "glucose": glucose_summary,
        "overnight": overnight,
        "activity": activity_summary,
        "careVisits": care,
        "sportMatches": matches,
        "stressLogs": stress,
        "dayCheckIn": check_in,
        "caffeineLogs": caffeine,
        "injuries": injury_list,
        "workoutPlans": list(workout_plans or []),
        "pumpEvents": pump,
        "weight": weight,
        "calorieTargets": calorie_targets,
        "calorieBalance": calorie_balance,
        "glucoseTargets": {
            "tirLowMgDl": tir_low,
            "tirHighMgDl": tir_high,
            "tirGoalPct": tir_goal,
            "dailyCarbTargetG": carb_target,
        },
        "insights": insights,
        "warnings": warnings,
    }
    report["agentPrompt"] = build_day_activity_prompt(report)
    return report


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
    total_checkins = 0
    mood_low = 0
    wake_rough = 0
    focus_low = 0
    overwhelm_high = 0
    total_caffeine_mg = 0
    total_caffeine_drinks = 0
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
    recent_checkins: list[dict[str, Any]] = []
    recent_caffeine: list[dict[str, Any]] = []
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
        check_in = d.get("dayCheckIn")
        if check_in:
            total_checkins += 1
            recent_checkins.append(check_in)
            if check_in.get("mood") in ("terrible", "low"):
                mood_low += 1
            if check_in.get("wakeQuality") in ("rough", "groggy"):
                wake_rough += 1
            if check_in.get("focus") in ("terrible", "low"):
                focus_low += 1
            if check_in.get("overwhelm") == "high":
                overwhelm_high += 1
        for c in d.get("caffeineLogs") or []:
            total_caffeine_drinks += 1
            total_caffeine_mg += int(c.get("caffeineMg") or 0)
            recent_caffeine.append(c)
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
    if total_checkins:
        bits = [f"{total_checkins} mood/ADHD check-in(s)"]
        if mood_low:
            bits.append(f"{mood_low} low mood")
        if wake_rough:
            bits.append(f"{wake_rough} rough wake")
        if focus_low:
            bits.append(f"{focus_low} low focus")
        if overwhelm_high:
            bits.append(f"{overwhelm_high} high overwhelm")
        insights.append(" · ".join(bits) + ".")
    if total_caffeine_drinks:
        insights.append(
            f"{total_caffeine_drinks} caffeine drink(s) · {total_caffeine_mg} mg this week."
        )
    if tir_values:
        avg_tir = sum(tir_values) / len(tir_values)
        insights.append(f"Average time in range: {round(avg_tir * 10) / 10}%.")

    weekly = {
        "weekStart": week_start,
        "weekEnd": week_end,
        "generatedAt": int(datetime.now().timestamp() * 1000),
        "days": days,
        "totals": {
            "macros": macros,
            "mealCount": meal_count,
            "avgGlucoseMgDl": avg(avg_glucose),
            "avgTimeInRangePct": avg(tir_values),
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
            "stressHigh": stress_high,
            "dayCheckInCount": total_checkins,
            "moodLowCount": mood_low,
            "wakeRoughCount": wake_rough,
            "focusLowCount": focus_low,
            "overwhelmHighCount": overwhelm_high,
            "caffeineDrinkCount": total_caffeine_drinks,
            "caffeineMgTotal": total_caffeine_mg,
            "caffeineMg": total_caffeine_mg,
        },
        "glucose": {"avgTimeInRangePct": avg(tir_values)},
        "nutrition": {"mealCount": meal_count},
        "workouts": list(reversed(recent_workouts))[-20:],
        "careVisits": list(reversed(recent_care))[-20:],
        "sportMatches": list(reversed(recent_matches))[-20:],
        "stressLogs": list(reversed(recent_stress))[-20:],
        "dayCheckIns": list(reversed(recent_checkins))[-20:],
        "caffeineLogs": list(reversed(recent_caffeine))[-30:],
        "hypoEvents": list(reversed(recent_hypos))[-30:],
        "insights": insights,
    }
    from app.services.diabetes_insights import weekly_plot_twists

    weekly["plotTwists"] = weekly_plot_twists(weekly, days)
    return weekly


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
