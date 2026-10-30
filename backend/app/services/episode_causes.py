"""Likely contributors to each hypo and high, from what was logged around it.

Every contributor carries the evidence it rests on (times, doses, carbs), so the care team can
judge it. When nothing logged explains an episode, it says so and lists what to check, instead
of guessing. Rules follow common type 1 guidance: exercise lowers glucose for up to ~24 h,
rapid insulin acts for ~3–4 h, a meal bolus belongs before the meal.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")

MIN = 60_000
HOUR = 60 * MIN

# Hypo windows
SPORT_ACUTE_H = 4  # exercise ended within this → acute effect
SPORT_DELAYED_H = 24  # up to this → delayed (often overnight) effect
INSULIN_ACTION_MS = 4 * HOUR
STACK_WINDOW_MS = 3 * HOUR
CORRECTION_GAP_MS = 45 * MIN  # bolus with no meal this close = correction
OVERCORRECTION_LOOKBACK_MS = 5 * HOUR
FAST_FALL_RATE = -2.0  # mg/dL per min

# High windows
MEAL_LOOKBACK_MS = 3 * HOUR
BOLUS_BEFORE_MEAL_MS = 30 * MIN  # a bolus up to 30 min before eating counts for the meal
BOLUS_AFTER_MEAL_MS = 90 * MIN
LATE_BOLUS_MIN = 15  # bolus this many minutes after eating = late
LARGE_MEAL_G = 80
RATIO_FACTOR = 1.4  # dose vs usual carb ratio
PUMP_ALERT_LOOKBACK_MS = 6 * HOUR
REBOUND_MS = 3 * HOUR
OLD_SET_HOURS = 72
HIGH_EPISODE_MIN = 60  # above target this long
DELIVERY_ALERTS = {"occlusion", "reservoir", "battery"}


def _local(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(PARIS)


def _ts(date: str, time: str | None) -> int | None:
    if not time:
        return None
    try:
        hh, mm = (int(x) for x in time.split(":")[:2])
        d = datetime.strptime(date, "%Y-%m-%d").replace(hour=hh, minute=mm, tzinfo=PARIS)
        return int(d.timestamp() * 1000)
    except (ValueError, TypeError):
        return None


def _cause(code: str, weight: float, **params: Any) -> dict[str, Any]:
    return {"code": code, "weight": round(weight, 2), "params": params}


# ----------------------------------------------------------------------- inputs


def exercise_sessions(sports: list[Any], activity: list[Any]) -> list[dict[str, Any]]:
    """Logged sport (with a time) and synced workouts (with a start time when the phone sent one)."""
    out: list[dict[str, Any]] = []
    for s in sports:
        start = _ts(s.date, s.time)
        dur = int(s.duration_min or 60)
        out.append(
            {
                "name": s.sport,
                "date": s.date,
                "start": start,
                "end": start + dur * MIN if start else None,
                "durationMin": dur,
                "intensity": s.intensity,
            }
        )
    for a in activity:
        try:
            workouts = json.loads(a.workouts_json or "[]")
        except (json.JSONDecodeError, TypeError):
            workouts = []
        for w in workouts if isinstance(workouts, list) else []:
            if not isinstance(w, dict):
                continue
            dur = int(w.get("durationMin") or 0)
            if dur < 15:
                continue
            start = None
            if w.get("startTime"):
                try:
                    start = int(datetime.fromisoformat(str(w["startTime"]).replace("Z", "+00:00")).timestamp() * 1000)
                except ValueError:
                    start = None
            out.append(
                {
                    "name": w.get("name") or "Workout",
                    "date": a.date,
                    "start": start,
                    "end": start + dur * MIN if start else None,
                    "durationMin": dur,
                    "intensity": None,
                }
            )
    return out


def usual_carb_ratio(meals: list[dict[str, Any]], boluses: list[dict[str, Any]]) -> float | None:
    """Median grams of carbs per unit over meals with exactly one matching bolus."""
    ratios = []
    for m in meals:
        if m["carbs"] < 10:
            continue
        matched = [b for b in boluses if m["ts"] - BOLUS_BEFORE_MEAL_MS <= b["ts"] <= m["ts"] + BOLUS_AFTER_MEAL_MS]
        if len(matched) == 1 and matched[0]["units"] > 0:
            ratios.append(m["carbs"] / matched[0]["units"])
    return round(median(ratios), 1) if len(ratios) >= 3 else None


def meal_bolus_timing(meals: list[dict[str, Any]], boluses: list[dict[str, Any]]) -> dict[str, Any]:
    """How meals were bolused: before, late (and by how much), or not at all."""
    on_time = late = missed = 0
    delays: list[int] = []
    for m in meals:
        if m["carbs"] < 15:
            continue
        matched = [b for b in boluses if m["ts"] - BOLUS_BEFORE_MEAL_MS <= b["ts"] <= m["ts"] + BOLUS_AFTER_MEAL_MS]
        if not matched:
            missed += 1
            continue
        delay = round((matched[0]["ts"] - m["ts"]) / MIN)
        if delay > LATE_BOLUS_MIN:
            late += 1
            delays.append(delay)
        else:
            on_time += 1
    total = on_time + late + missed
    return {
        "mealsChecked": total,
        "onTime": on_time,
        "late": late,
        "missed": missed,
        "avgLateMin": round(sum(delays) / len(delays)) if delays else None,
    }


# ----------------------------------------------------------------------- episodes


def find_high_episodes(points: list[dict[str, Any]], high: float) -> list[dict[str, Any]]:
    """Stretches above target lasting at least an hour (gaps over 30 min split them)."""
    out: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    for p in points:
        above = p["mgDl"] > high
        if cur and (not above or p["timestamp"] - cur["endedAt"] > 30 * MIN):
            if cur["endedAt"] - cur["startedAt"] >= HIGH_EPISODE_MIN * MIN:
                out.append(cur)
            cur = None
        if above:
            if not cur:
                cur = {"startedAt": p["timestamp"], "endedAt": p["timestamp"], "peakMgDl": p["mgDl"], "peakAt": p["timestamp"]}
            cur["endedAt"] = p["timestamp"]
            if p["mgDl"] > cur["peakMgDl"]:
                cur["peakMgDl"], cur["peakAt"] = p["mgDl"], p["timestamp"]
    if cur and cur["endedAt"] - cur["startedAt"] >= HIGH_EPISODE_MIN * MIN:
        out.append(cur)
    for e in out:
        e["durationMin"] = round((e["endedAt"] - e["startedAt"]) / MIN)
        e["peakMgDl"] = round(e["peakMgDl"])
    return out


def _fall_rate(points: list[dict[str, Any]], t0: int) -> float | None:
    before = [p for p in points if t0 - 20 * MIN <= p["timestamp"] <= t0]
    if len(before) < 2 or before[-1]["timestamp"] == before[0]["timestamp"]:
        return None
    return (before[-1]["mgDl"] - before[0]["mgDl"]) / ((before[-1]["timestamp"] - before[0]["timestamp"]) / MIN)


def hypo_causes(
    hypo: dict[str, Any],
    *,
    points: list[dict[str, Any]],
    meals: list[dict[str, Any]],
    boluses: list[dict[str, Any]],
    alerts: list[dict[str, Any]],
    sessions: list[dict[str, Any]],
    highs: list[dict[str, Any]],
    ratio: float | None,
    steps_by_day: dict[str, int],
    usual_steps: float | None,
) -> list[dict[str, Any]]:
    t0 = hypo["startedAt"]
    local = _local(t0)
    day = local.strftime("%Y-%m-%d")
    prev_day = (local - timedelta(days=1)).strftime("%Y-%m-%d")
    causes: list[dict[str, Any]] = []

    # Exercise: acute (within 4 h) or delayed (up to 24 h, often overnight)
    for s in sessions:
        if s["end"] is not None:
            hours = (t0 - s["end"]) / HOUR
            if 0 <= hours <= SPORT_ACUTE_H:
                causes.append(_cause("sportRecent", 0.9, sport=s["name"], durationMin=s["durationMin"], hoursBefore=round(hours, 1)))
            elif SPORT_ACUTE_H < hours <= SPORT_DELAYED_H:
                w = 0.75 if local.hour < 7 else 0.55
                causes.append(_cause("sportDelayed", w, sport=s["name"], durationMin=s["durationMin"], hoursBefore=round(hours)))
        elif s["date"] in (day, prev_day):
            causes.append(_cause("sportSameDay" if s["date"] == day else "sportDayBefore", 0.45, sport=s["name"], durationMin=s["durationMin"]))

    steps = steps_by_day.get(day)
    if steps and usual_steps and steps >= 1.5 * usual_steps and steps >= 10_000:
        causes.append(_cause("activeDay", 0.35, steps=steps, usualSteps=round(usual_steps)))

    # Insulin in the 4 hours before
    recent = [b for b in boluses if t0 - INSULIN_ACTION_MS <= b["ts"] <= t0]
    stacked = [b for b in recent if b["ts"] >= t0 - STACK_WINDOW_MS]
    if len(stacked) >= 2:
        span = round((stacked[-1]["ts"] - stacked[0]["ts"]) / MIN)
        causes.append(_cause("insulinStacking", 0.85, count=len(stacked), units=round(sum(b["units"] for b in stacked), 1), withinMin=span))

    for b in recent:
        near_meal = [m for m in meals if abs(m["ts"] - b["ts"]) <= CORRECTION_GAP_MS]
        mins = round((t0 - b["ts"]) / MIN)
        if not near_meal:
            after_high = next(
                (h for h in highs if b["ts"] - OVERCORRECTION_LOOKBACK_MS <= h["endedAt"] <= b["ts"] + 30 * MIN), None
            )
            if after_high:
                causes.append(_cause("overcorrection", 0.85, units=b["units"], peakMgDl=after_high["peakMgDl"], minutesBefore=mins))
            else:
                causes.append(_cause("bolusNoMeal", 0.8, units=b["units"], minutesBefore=mins))
        elif ratio:
            carbs = sum(m["carbs"] for m in near_meal)
            expected = carbs / ratio if carbs else 0
            if expected and b["units"] > expected * RATIO_FACTOR:
                causes.append(
                    _cause("doseAboveRatio", 0.75, units=b["units"], carbs=round(carbs), expectedUnits=round(expected, 1), minutesBefore=mins)
                )

    # Long gap without food, only when meals were being logged (otherwise it's just missing data)
    if not recent and 6 <= local.hour <= 22:
        last_meal = next((m for m in reversed(meals) if m["ts"] <= t0), None)
        if last_meal and 6 * HOUR <= t0 - last_meal["ts"] <= 16 * HOUR:
            causes.append(_cause("longFast", 0.3, hoursSinceMeal=round((t0 - last_meal["ts"]) / HOUR)))

    rate = _fall_rate(points, t0)
    if rate is not None and rate <= FAST_FALL_RATE:
        causes.append(_cause("fastFall", 0.4, ratePerMin=round(rate, 1)))

    sensor = [a for a in alerts if a["kind"] == "sensor" and t0 - 2 * HOUR <= a["ts"] <= hypo["endedAt"] + 30 * MIN]
    if sensor or (local.hour < 6 and hypo.get("readingCount", 99) <= 4 and hypo["minMgDl"] >= 50):
        causes.append(_cause("sensorCheck", 0.3 if not sensor else 0.5, overnight=local.hour < 6, sensorAlert=bool(sensor)))

    return _finish(causes, "noLoggedCauseHypo")


def high_causes(
    high: dict[str, Any],
    *,
    meals: list[dict[str, Any]],
    boluses: list[dict[str, Any]],
    alerts: list[dict[str, Any]],
    hypos: list[dict[str, Any]],
    stress: list[dict[str, Any]],
    ratio: float | None,
    set_changed_at: int | None,
) -> list[dict[str, Any]]:
    t0 = high["startedAt"]
    local = _local(t0)
    causes: list[dict[str, Any]] = []

    recent_meals = [m for m in meals if t0 - MEAL_LOOKBACK_MS <= m["ts"] <= t0 + 15 * MIN]
    for m in recent_meals:
        matched = [b for b in boluses if m["ts"] - BOLUS_BEFORE_MEAL_MS <= b["ts"] <= m["ts"] + BOLUS_AFTER_MEAL_MS]
        if not matched:
            if m["carbs"] >= 15:
                causes.append(_cause("missedBolus", 0.95, mealType=m["type"], carbs=round(m["carbs"])))
            continue
        delay = round((matched[0]["ts"] - m["ts"]) / MIN)
        if delay > LATE_BOLUS_MIN:
            causes.append(_cause("lateBolus", 0.85, mealType=m["type"], carbs=round(m["carbs"]), minutesLate=delay))
        units = sum(b["units"] for b in matched)
        if ratio and m["carbs"] >= 15 and units:
            expected = m["carbs"] / ratio
            if units * RATIO_FACTOR < expected:
                causes.append(
                    _cause("doseBelowRatio", 0.75, mealType=m["type"], carbs=round(m["carbs"]), units=round(units, 1), expectedUnits=round(expected, 1))
                )
        if m["carbs"] >= LARGE_MEAL_G:
            causes.append(_cause("largeMeal", 0.55, mealType=m["type"], carbs=round(m["carbs"])))

    delivery = [a for a in alerts if a["kind"] in DELIVERY_ALERTS and t0 - PUMP_ALERT_LOOKBACK_MS <= a["ts"] <= high["endedAt"]]
    for a in delivery[:2]:
        causes.append(_cause("pumpAlert", 0.9, kind=a["kind"], title=a["title"], minutesBefore=round((t0 - a["ts"]) / MIN)))

    rebound = next((h for h in hypos if t0 - REBOUND_MS <= h["endedAt"] <= t0), None)
    if rebound:
        causes.append(_cause("reboundAfterHypo", 0.7, lowMgDl=round(rebound["minMgDl"]), minutesAfter=round((t0 - rebound["endedAt"]) / MIN)))

    if not recent_meals and 3 <= local.hour < 9:
        causes.append(_cause("dawn", 0.5))

    if set_changed_at and set_changed_at <= t0:
        hours = (t0 - set_changed_at) / HOUR
        if hours >= OLD_SET_HOURS:
            causes.append(_cause("oldInfusionSet", 0.5, days=round(hours / 24, 1)))

    day = local.strftime("%Y-%m-%d")
    if any(s["date"] == day and s["level"] == "high" for s in stress):
        causes.append(_cause("stress", 0.35))

    if not recent_meals and not delivery and not rebound:
        last_bolus = next((b for b in reversed(boluses) if b["ts"] <= t0), None)
        if last_bolus is None or t0 - last_bolus["ts"] > 5 * HOUR:
            causes.append(_cause("noRecentInsulin", 0.4, hoursSince=round((t0 - last_bolus["ts"]) / HOUR) if last_bolus else None))

    return _finish(causes, "noLoggedCauseHigh")


def _finish(causes: list[dict[str, Any]], fallback: str) -> list[dict[str, Any]]:
    """Strongest first, one per kind; if nothing logged explains it, say so."""
    seen: set[str] = set()
    out = []
    for c in sorted(causes, key=lambda c: -c["weight"]):
        if c["code"] in seen:
            continue
        seen.add(c["code"])
        out.append(c)
    return out[:4] if out else [_cause(fallback, 0.0)]


def pattern_summary(episodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """How often each contributor shows up across episodes, most common first."""
    counts: dict[str, int] = {}
    for e in episodes:
        for c in e["causes"]:
            counts[c["code"]] = counts.get(c["code"], 0) + 1
    total = len(episodes)
    return [
        {"code": code, "count": n, "of": total}
        for code, n in sorted(counts.items(), key=lambda kv: -kv[1])
        if total
    ]
