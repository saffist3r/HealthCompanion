"""Diabetic engagement helpers: post-meal stories, food memory, episodes, streaks, twists."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    BodyProfile,
    CaffeineLog,
    GlucoseSample,
    Meal,
    PumpLogEvent,
    SportMatch,
    StressLog,
)
from app.services.glucose_stats import find_hypo_events
from app.services.reports import to_date_key


def _mgdl(value: float, unit: str) -> float:
    u = (unit or "mg/dL").lower()
    if "mmol" in u:
        return float(value) * 18.0
    return float(value)


def _tir_bounds(db: Session) -> tuple[float, float]:
    row = db.query(BodyProfile).filter(BodyProfile.id == "default").first()
    low = float(row.tir_low_mgdl) if row and row.tir_low_mgdl else 70.0
    high = float(row.tir_high_mgdl) if row and row.tir_high_mgdl else 180.0
    return low, high


def _readings_between(
    db: Session, device_ids: list[str], start_ms: int, end_ms: int
) -> list[dict[str, Any]]:
    start = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
    end = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc)
    q = db.query(GlucoseSample).filter(
        GlucoseSample.timestamp >= start, GlucoseSample.timestamp <= end
    )
    if device_ids:
        q = q.filter(GlucoseSample.device_id.in_(device_ids))
    rows = q.order_by(GlucoseSample.timestamp.asc()).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        ts = int(r.timestamp.timestamp() * 1000)
        mg = _mgdl(r.value, r.unit)
        out.append({"timestamp": ts, "mgDl": round(mg * 10) / 10, "value": r.value, "unit": r.unit})
    return out


def post_meal_story(
    db: Session,
    *,
    device_ids: list[str],
    eaten_at_ms: int,
    window_hours: float = 3.0,
) -> dict[str, Any]:
    low, high = _tir_bounds(db)
    end_ms = eaten_at_ms + int(window_hours * 3600 * 1000)
    points = _readings_between(db, device_ids, eaten_at_ms - 10 * 60 * 1000, end_ms)
    in_window = [p for p in points if p["timestamp"] >= eaten_at_ms]
    if not in_window:
        return {
            "ready": False,
            "reason": "waiting_for_glucose",
            "windowHours": window_hours,
            "tirLowMgDl": low,
            "tirHighMgDl": high,
        }

    baseline = min(points, key=lambda p: abs(p["timestamp"] - eaten_at_ms)) if points else in_window[0]
    peak = max(in_window, key=lambda p: p["mgDl"])
    time_to_peak_min = max(0, round((peak["timestamp"] - eaten_at_ms) / 60000))
    delta = round((peak["mgDl"] - baseline["mgDl"]) * 10) / 10

    return_to_range_min: int | None = None
    for p in in_window:
        if p["timestamp"] < peak["timestamp"]:
            continue
        if low <= p["mgDl"] <= high:
            return_to_range_min = max(0, round((p["timestamp"] - eaten_at_ms) / 60000))
            break

    still_high = peak["mgDl"] > high and return_to_range_min is None
    blurb = _story_blurb(delta, time_to_peak_min, return_to_range_min, still_high)

    return {
        "ready": True,
        "windowHours": window_hours,
        "tirLowMgDl": low,
        "tirHighMgDl": high,
        "baselineMgDl": baseline["mgDl"],
        "peakMgDl": peak["mgDl"],
        "deltaMgDl": delta,
        "timeToPeakMin": time_to_peak_min,
        "returnToRangeMin": return_to_range_min,
        "stillAboveRange": still_high,
        "readingCount": len(in_window),
        "blurb": blurb,
    }


def _story_blurb(
    delta: float, time_to_peak: int, return_min: int | None, still_high: bool
) -> str:
    if delta < 20:
        return f"Chill arc: +{delta:.0f} mg/dL, peak around {time_to_peak} min. Pasta behaved (mostly)."
    if still_high:
        return f"Plot thickening: +{delta:.0f} by {time_to_peak} min and still above range. Worth a glance."
    if return_min is not None:
        return (
            f"Classic sequel: +{delta:.0f} at {time_to_peak} min, back in range by {return_min} min."
        )
    return f"Rise of +{delta:.0f} peaking at {time_to_peak} min — ending still writing itself."


def _item_tokens(meal: Meal) -> set[str]:
    try:
        items = json.loads(meal.items_json or "[]")
    except json.JSONDecodeError:
        items = []
    tokens: set[str] = set()
    for it in items:
        if isinstance(it, dict):
            name = str(it.get("name") or it.get("label") or "").lower()
        else:
            name = str(it).lower()
        for part in re.split(r"[^a-z0-9]+", name):
            if len(part) >= 3:
                tokens.add(part)
    return tokens


def _carbs(meal: Meal) -> float:
    try:
        m = json.loads(meal.macros_json or "{}")
        return float(m.get("carbsG") or 0)
    except (json.JSONDecodeError, TypeError, ValueError):
        return 0.0


def similar_meals(
    db: Session,
    *,
    device_ids: list[str],
    meal: Meal,
    limit: int = 5,
) -> list[dict[str, Any]]:
    carbs = _carbs(meal)
    tokens = _item_tokens(meal)
    q = db.query(Meal).filter(Meal.id != meal.id)
    if device_ids:
        q = q.filter(Meal.device_id.in_(device_ids))
    candidates = q.order_by(Meal.eaten_at.desc()).limit(120).all()

    scored: list[tuple[float, Meal, dict[str, Any]]] = []
    for other in candidates:
        oc = _carbs(other)
        carb_score = max(0.0, 1.0 - abs(oc - carbs) / 40.0)
        ot = _item_tokens(other)
        if tokens and ot:
            jacc = len(tokens & ot) / max(1, len(tokens | ot))
        else:
            jacc = 0.15 if abs(oc - carbs) <= 15 else 0.0
        type_bonus = 0.15 if other.meal_type == meal.meal_type else 0.0
        rating_bonus = 0.1 if (getattr(other, "would_again", None) or 0) > 0 else 0.0
        score = carb_score * 0.55 + jacc * 0.35 + type_bonus + rating_bonus
        if score < 0.25:
            continue
        story = post_meal_story(
            db,
            device_ids=device_ids,
            eaten_at_ms=int(other.eaten_at.timestamp() * 1000),
        )
        scored.append(
            (
                score,
                other,
                {
                    "id": other.id,
                    "eatenAt": int(other.eaten_at.timestamp() * 1000),
                    "date": to_date_key(other.eaten_at),
                    "mealType": other.meal_type,
                    "carbsG": oc,
                    "score": round(score, 3),
                    "wouldAgain": getattr(other, "would_again", None),
                    "aiSummary": other.ai_summary,
                    "glucoseStory": story if story.get("ready") else None,
                },
            )
        )
    scored.sort(key=lambda x: x[0], reverse=True)
    return [s[2] for s in scored[:limit]]


def _hyper_events(points: list[dict[str, Any]], *, threshold: float) -> list[dict[str, Any]]:
    inverted = [
        {"timestamp": p["timestamp"], "mgDl": threshold - (p["mgDl"] - threshold)} for p in points
    ]
    raw = find_hypo_events(inverted, threshold=threshold)
    out: list[dict[str, Any]] = []
    for ev in raw:
        window = [p for p in points if ev["startedAt"] <= p["timestamp"] <= ev["endedAt"]]
        max_mg = max((p["mgDl"] for p in window), default=threshold)
        out.append(
            {
                "startedAt": ev["startedAt"],
                "endedAt": ev["endedAt"],
                "maxMgDl": round(max_mg * 10) / 10,
                "readingCount": ev["readingCount"],
                "durationMin": ev["durationMin"],
                "kind": "hyper",
            }
        )
    return out


def _combine_dt(date_s: str, time_s: str | None) -> int | None:
    try:
        if time_s and re.match(r"^\d{1,2}:\d{2}", time_s.strip()):
            dt = datetime.strptime(f"{date_s} {time_s.strip()[:5]}", "%Y-%m-%d %H:%M")
        else:
            dt = datetime.strptime(f"{date_s} 12:00", "%Y-%m-%d %H:%M")
        return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)
    except ValueError:
        return None


def episode_context(
    db: Session,
    *,
    device_ids: list[str],
    started_at_ms: int,
    ended_at_ms: int,
    pad_hours: float = 2.5,
) -> dict[str, Any]:
    start = started_at_ms - int(pad_hours * 3600 * 1000)
    end = ended_at_ms + int(pad_hours * 3600 * 1000)
    start_dt = datetime.fromtimestamp(start / 1000, tz=timezone.utc)
    end_dt = datetime.fromtimestamp(end / 1000, tz=timezone.utc)
    day_keys: set[str] = set()
    cur = start_dt
    while cur <= end_dt + timedelta(days=1):
        day_keys.add(to_date_key(cur))
        cur += timedelta(days=1)

    meals_q = db.query(Meal).filter(Meal.eaten_at >= start_dt, Meal.eaten_at <= end_dt)
    if device_ids:
        meals_q = meals_q.filter(Meal.device_id.in_(device_ids))
    meals = [
        {
            "id": m.id,
            "eatenAt": int(m.eaten_at.timestamp() * 1000),
            "mealType": m.meal_type,
            "carbsG": _carbs(m),
            "summary": m.ai_summary,
        }
        for m in meals_q.order_by(Meal.eaten_at.asc()).all()
    ]

    def scoped(model):
        q = db.query(model).filter(model.date.in_(list(day_keys)))
        if device_ids and hasattr(model, "device_id"):
            q = q.filter(model.device_id.in_(device_ids))
        return q.all()

    caffeine = []
    for c in scoped(CaffeineLog):
        ts = _combine_dt(c.date, c.time)
        if ts is None or not (start <= ts <= end):
            continue
        caffeine.append(
            {"date": c.date, "time": c.time, "drink": c.drink, "caffeineMg": c.caffeine_mg, "at": ts}
        )

    sports = []
    for s in scoped(SportMatch):
        ts = _combine_dt(s.date, s.time)
        if ts is None or not (start <= ts <= end):
            continue
        sports.append(
            {
                "date": s.date,
                "time": s.time,
                "sport": s.sport,
                "durationMin": s.duration_min,
                "at": ts,
            }
        )

    stress = []
    for s in scoped(StressLog):
        ts = _combine_dt(s.date, s.time)
        if ts is None or not (start <= ts <= end):
            continue
        stress.append({"date": s.date, "time": s.time, "level": s.level, "score": s.score, "at": ts})

    pump_q = db.query(PumpLogEvent).filter(
        PumpLogEvent.timestamp >= start_dt, PumpLogEvent.timestamp <= end_dt
    )
    if device_ids:
        pump_q = pump_q.filter(PumpLogEvent.device_id.in_(device_ids))
    pump = [
        {
            "kind": p.kind,
            "units": p.units,
            "message": p.message,
            "at": int(p.timestamp.timestamp() * 1000),
        }
        for p in pump_q.order_by(PumpLogEvent.timestamp.asc()).all()
    ]

    return {"meals": meals, "caffeine": caffeine, "sports": sports, "stress": stress, "pump": pump}


def enrich_glucose_episodes(
    db: Session, device_ids: list[str], points: list[dict[str, Any]]
) -> dict[str, Any]:
    low, high = _tir_bounds(db)
    hypos = find_hypo_events(points, threshold=low)
    hypers = _hyper_events(points, threshold=high)
    for h in hypos:
        h["kind"] = "hypo"
        h["context"] = episode_context(
            db, device_ids=device_ids, started_at_ms=h["startedAt"], ended_at_ms=h["endedAt"]
        )
    for h in hypers:
        h["context"] = episode_context(
            db, device_ids=device_ids, started_at_ms=h["startedAt"], ended_at_ms=h["endedAt"]
        )
    return {"hypoEvents": hypos, "hyperEvents": hypers, "tirLowMgDl": low, "tirHighMgDl": high}


def overnight_blurb(db: Session, device_ids: list[str], date: str) -> dict[str, Any]:
    from app.services.reports import PARIS, paris_day_bounds

    day_start, day_end = paris_day_bounds(date)
    # Overnight window: Paris local 00:00–06:00 within that calendar day
    local_midnight = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=PARIS)
    overnight_end = (local_midnight + timedelta(hours=6)).astimezone(timezone.utc)
    start = day_start
    end = min(overnight_end, day_end)
    points = _readings_between(
        db, device_ids, int(start.timestamp() * 1000), int(end.timestamp() * 1000)
    )
    if len(points) < 3:
        return {
            "ready": False,
            "blurb": "Overnight plot TBD — not enough CGM tea yet.",
            "readingCount": len(points),
        }
    vals = [p["mgDl"] for p in points]
    mn, mx = min(vals), max(vals)
    dawn_rise = round(vals[-1] - mn, 1)
    if dawn_rise >= 30 and vals[-1] > 140:
        blurb = (
            f"Dawn vibes: dipped to {mn:.0f}, woke near {vals[-1]:.0f} (+{dawn_rise:.0f}). "
            "Classic overnight plot twist."
        )
    elif mx - mn < 25:
        blurb = f"Overnight was oddly civil: {mn:.0f}–{mx:.0f}. Sleep on that win."
    else:
        blurb = f"Night range {mn:.0f}–{mx:.0f}. Not a thriller, not a rom-com."
    return {
        "ready": True,
        "minMgDl": mn,
        "maxMgDl": mx,
        "endMgDl": vals[-1],
        "dawnRiseMgDl": dawn_rise,
        "readingCount": len(points),
        "blurb": blurb,
    }


def meal_log_streak(db: Session, device_ids: list[str]) -> int:
    q = db.query(Meal)
    if device_ids:
        q = q.filter(Meal.device_id.in_(device_ids))
    meals = q.order_by(Meal.eaten_at.desc()).limit(400).all()
    days = sorted({to_date_key(m.eaten_at) for m in meals}, reverse=True)
    if not days:
        return 0
    today = to_date_key(datetime.now())
    cursor = today if today in days else to_date_key(datetime.now() - timedelta(days=1))
    if cursor not in days:
        return 0
    streak = 0
    expected = datetime.strptime(cursor, "%Y-%m-%d").date()
    day_set = set(days)
    while expected.strftime("%Y-%m-%d") in day_set:
        streak += 1
        expected = expected - timedelta(days=1)
    return streak


def find_related_hypo(
    db: Session, device_ids: list[str], eaten_at_ms: int, lookback_min: int = 75
) -> dict[str, Any] | None:
    low, _ = _tir_bounds(db)
    start = eaten_at_ms - lookback_min * 60 * 1000
    points = _readings_between(db, device_ids, start, eaten_at_ms + 5 * 60 * 1000)
    hypos = find_hypo_events(points, threshold=low)
    if not hypos:
        return None
    return max(hypos, key=lambda h: h["endedAt"])


def weekly_plot_twists(weekly: dict[str, Any], days: list[dict[str, Any]]) -> list[str]:
    twists: list[str] = []
    tir_days = [
        (d["date"], d["glucose"].get("timeInRangePct"))
        for d in days
        if d["glucose"].get("timeInRangePct") is not None
    ]
    if tir_days:
        best = max(tir_days, key=lambda x: x[1] or 0)
        worst = min(tir_days, key=lambda x: x[1] or 0)
        twists.append(
            f"Director’s pick: best TIR {best[1]}% on {best[0]}; chaos award {worst[1]}% on {worst[0]}."
        )

    carb_days = [(d["date"], d["nutrition"]["macros"].get("carbsG") or 0) for d in days]
    if carb_days:
        cmax = max(carb_days, key=lambda x: x[1])
        if cmax[1] >= 40:
            twists.append(f"Carb plot twist: {cmax[0]} brought ~{int(cmax[1])}g to the party.")

    hypos: list[Any] = []
    for d in days:
        for h in d.get("glucose", {}).get("hypoEvents") or []:
            hypos.append({**h, "date": d["date"]})
    if hypos:
        twists.append(f"{len(hypos)} hypo episode(s) this week — each one a mini thriller.")
    else:
        twists.append("Hypo count: zero. The villain stayed off-screen.")

    stress_high = (weekly.get("totals") or {}).get("stressHigh") or 0
    if stress_high:
        twists.append(f"Stress logged high {stress_high}× — cortisol wanted a cameo.")

    cafe = (weekly.get("totals") or {}).get("caffeineMg") or 0
    if cafe >= 400:
        twists.append(f"Caffeine subplot: ~{int(cafe)} mg. The plot was caffeinated.")

    if not twists:
        twists.append("Quiet week on paper. Suspicious. Check the raw footage (Reports).")
    return twists[:6]


def device_care_payload(profile: BodyProfile | None) -> dict[str, Any]:
    now = datetime.now(timezone.utc)

    def days_since(ts: datetime | None) -> int | None:
        if not ts:
            return None
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return max(0, int((now - ts).total_seconds() // 86400))

    cannula = getattr(profile, "cannula_changed_at", None) if profile else None
    sensor = getattr(profile, "sensor_started_at", None) if profile else None
    return {
        "cannulaChangedAt": int(cannula.timestamp() * 1000) if cannula else None,
        "sensorStartedAt": int(sensor.timestamp() * 1000) if sensor else None,
        "cannulaDay": days_since(cannula),
        "sensorDay": days_since(sensor),
        "siteChangeSuggested": (days_since(cannula) or 0) >= 3 if cannula else False,
        "sensorAging": (days_since(sensor) or 0) >= 10 if sensor else False,
    }
