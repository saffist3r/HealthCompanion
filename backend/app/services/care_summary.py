"""Multi-day clinical summary for the nurse / doctor (read-only care-team view).

Glucose bands follow the international consensus on CGM metrics (Battelino 2019):
very low <54, low 54–69, in range 70–180, high 181–250, very high >250 mg/dL.
"""

from __future__ import annotations

import json
import math
import secrets
from datetime import datetime, timedelta, timezone
from statistics import mean, pstdev
from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    ActivityDay,
    BodyProfile,
    CareShare,
    DayCheckIn,
    GlucoseSample,
    Injury,
    InjuryPainLog,
    Meal,
    PumpLogEvent,
    SportMatch,
    StressLog,
)
from app.services import episode_causes, pattern_finder
from app.services.glucose_stats import find_hypo_events, to_mg_dl
from app.services.reports import PARIS, paris_date_key, paris_day_bounds

ALLOWED_DAYS = (7, 14, 30, 90)
BANDS = (
    ("veryLow", None, 54.0),
    ("low", 54.0, 70.0),
    ("inRange", 70.0, 180.0001),
    ("high", 180.0001, 250.0001),
    ("veryHigh", 250.0001, None),
)
LOOKBACK_MS = 4 * 60 * 60 * 1000  # context window before a hypo
# Consensus: a CGM hypo event lasts at least 15 minutes (3 readings at 5-minute intervals).
MIN_HYPO_READINGS = 3
MIN_HYPO_MINUTES = 15
MOOD_ORDER = ("terrible", "low", "ok", "good", "great")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ms(dt: datetime) -> int:
    return int(_aware(dt).timestamp() * 1000)


def _carbs(meal: Meal) -> float:
    try:
        return float(json.loads(meal.macros_json or "{}").get("carbsG") or 0)
    except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
        return 0.0


def _percentile(sorted_vals: list[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * pct / 100
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def _scoped(query, column, device_ids: list[str]):
    return query.filter(column.in_(device_ids)) if device_ids else query


def glucose_metrics(points: list[dict[str, Any]]) -> dict[str, Any]:
    """Consensus CGM metrics from ``[{timestamp, mgDl}]`` points (ascending)."""
    values = [float(p["mgDl"]) for p in points]
    if not values:
        return {"readingCount": 0, "bandsPct": None, "meanMgDl": None, "gmiPct": None, "cvPct": None}
    n = len(values)
    bands: dict[str, float] = {}
    for key, lo, hi in BANDS:
        count = sum(1 for v in values if (lo is None or v >= lo) and (hi is None or v < hi))
        bands[key] = round(count / n * 1000) / 10
    avg = mean(values)
    return {
        "readingCount": n,
        "bandsPct": bands,
        "meanMgDl": round(avg),
        # Glucose Management Indicator (Bergenstal 2018), an estimated A1c.
        "gmiPct": round(3.31 + 0.02392 * avg, 1),
        "cvPct": round(pstdev(values) / avg * 1000) / 10 if avg else None,
    }


def hourly_profile(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Typical day: 5/25/50/75/95th percentiles per local hour."""
    buckets: dict[int, list[float]] = {h: [] for h in range(24)}
    for p in points:
        hour = datetime.fromtimestamp(p["timestamp"] / 1000, tz=PARIS).hour
        buckets[hour].append(float(p["mgDl"]))
    out = []
    for hour in range(24):
        vals = sorted(buckets[hour])
        if not vals:
            out.append({"hour": hour, "n": 0})
            continue
        out.append(
            {
                "hour": hour,
                "n": len(vals),
                **{f"p{q}": round(_percentile(vals, q)) for q in (5, 25, 50, 75, 95)},
            }
        )
    return out


def build_care_summary(
    db: Session,
    device_ids: list[str],
    *,
    days: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    end = _aware(now or _utcnow())
    # Exactly ``days`` calendar days (Europe/Paris), today included.
    end_key = paris_date_key(end)
    start_key = paris_date_key(end - timedelta(days=days - 1))
    start = paris_day_bounds(start_key)[0]

    glucose_rows = (
        _scoped(db.query(GlucoseSample), GlucoseSample.device_id, device_ids)
        .filter(GlucoseSample.timestamp >= start, GlucoseSample.timestamp <= end)
        .order_by(GlucoseSample.timestamp.asc())
        .all()
    )
    points = [
        {"timestamp": _ms(r.timestamp), "mgDl": to_mg_dl(r.value, r.unit)} for r in glucose_rows
    ]
    meals = (
        _scoped(db.query(Meal), Meal.device_id, device_ids)
        .filter(Meal.eaten_at >= start, Meal.eaten_at <= end)
        .order_by(Meal.eaten_at.asc())
        .all()
    )
    pump = (
        _scoped(db.query(PumpLogEvent), PumpLogEvent.device_id, device_ids)
        .filter(PumpLogEvent.timestamp >= start, PumpLogEvent.timestamp <= end)
        .order_by(PumpLogEvent.timestamp.asc())
        .all()
    )
    boluses = [p for p in pump if p.kind == "insulin_delivered" and p.units]
    activity = (
        _scoped(db.query(ActivityDay), ActivityDay.device_id, device_ids)
        .filter(ActivityDay.date >= start_key, ActivityDay.date <= end_key)
        .all()
    )
    sports = (
        _scoped(db.query(SportMatch), SportMatch.device_id, device_ids)
        .filter(SportMatch.date >= start_key, SportMatch.date <= end_key)
        .all()
    )

    # Per-day table
    day_keys: list[str] = []
    cursor = start
    while paris_date_key(cursor) <= end_key:
        key = paris_date_key(cursor)
        if key not in day_keys:
            day_keys.append(key)
        cursor += timedelta(days=1)
    per_day: dict[str, dict[str, Any]] = {
        k: {"date": k, "carbsG": 0.0, "insulinU": 0.0, "mealCount": 0, "steps": None, "_glucose": []}
        for k in day_keys
    }
    for m in meals:
        row = per_day.get(paris_date_key(m.eaten_at))
        if row:
            row["carbsG"] += _carbs(m)
            row["mealCount"] += 1
    for b in boluses:
        row = per_day.get(paris_date_key(b.timestamp))
        if row:
            row["insulinU"] += float(b.units or 0)
    for a in activity:
        row = per_day.get(a.date)
        if row:
            row["steps"] = (row["steps"] or 0) + int(a.steps or 0)
    for p in points:
        key = paris_date_key(datetime.fromtimestamp(p["timestamp"] / 1000, tz=timezone.utc))
        if key in per_day:
            per_day[key]["_glucose"].append(p)

    hypos = [
        h
        for h in find_hypo_events(points)
        if h["readingCount"] >= MIN_HYPO_READINGS or h["durationMin"] >= MIN_HYPO_MINUTES
    ]
    daily = []
    for key in day_keys:
        row = per_day[key]
        g = glucose_metrics(row.pop("_glucose"))
        day_start_hypos = [
            h for h in hypos
            if paris_date_key(datetime.fromtimestamp(h["startedAt"] / 1000, tz=timezone.utc)) == key
        ]
        daily.append(
            {
                **row,
                "carbsG": round(row["carbsG"]),
                "insulinU": round(row["insulinU"], 1),
                "meanMgDl": g["meanMgDl"],
                "inRangePct": g["bandsPct"]["inRange"] if g["bandsPct"] else None,
                "hypoCount": len(day_start_hypos),
            }
        )

    # What happened before each hypo
    hypo_rows = []
    for h in hypos:
        t0 = h["startedAt"]
        last_meal = next(
            (m for m in reversed(meals) if t0 - LOOKBACK_MS <= _ms(m.eaten_at) <= t0), None
        )
        recent_bolus = [b for b in boluses if t0 - LOOKBACK_MS <= _ms(b.timestamp) <= t0]
        day_key = paris_date_key(datetime.fromtimestamp(t0 / 1000, tz=timezone.utc))
        same_day_sport = [s.sport for s in sports if s.date == day_key]
        local = datetime.fromtimestamp(t0 / 1000, tz=PARIS)
        hypo_rows.append(
            {
                **h,
                "date": day_key,
                "time": local.strftime("%H:%M"),
                "overnight": local.hour < 6,
                "mealBefore": (
                    {
                        "minutesBefore": round((t0 - _ms(last_meal.eaten_at)) / 60000),
                        "mealType": last_meal.meal_type,
                        "carbsG": round(_carbs(last_meal)),
                    }
                    if last_meal
                    else None
                ),
                "insulinBeforeU": round(sum(float(b.units or 0) for b in recent_bolus), 1) or None,
                "sportSameDay": same_day_sport or None,
            }
        )

    analysis = _episode_analysis(db, device_ids, start=start, end=end, points=points, hypos=hypo_rows, daily=daily)

    n_days = max(1, len(day_keys))
    days_with_glucose = sum(1 for d in daily if d["meanMgDl"] is not None)
    days_with_meals = sum(1 for d in daily if d["mealCount"])
    days_with_insulin = sum(1 for d in daily if d["insulinU"])

    return {
        "period": {"days": days, "from": start_key, "to": end_key, "generatedAt": _ms(end)},
        "glucose": {
            **glucose_metrics(points),
            "daysWithData": days_with_glucose,
            "hourly": hourly_profile(points),
            "targets": {"low": 70, "high": analysis["highTarget"]},
        },
        "hypos": {
            "count": len(hypos),
            "overnightCount": sum(1 for h in hypo_rows if h["overnight"]),
            "below54Count": sum(1 for h in hypos if h["minMgDl"] < 54),
            "events": hypo_rows[-30:][::-1],
            "patterns": analysis["hypoPatterns"],
        },
        "highs": analysis["highs"],
        "bolusTiming": analysis["bolusTiming"],
        "carbRatio": analysis["carbRatio"],
        "patternsFound": pattern_finder.find_patterns(db, device_ids, now=end),
        "insulin": {
            "avgDailyU": round(sum(d["insulinU"] for d in daily) / days_with_insulin, 1)
            if days_with_insulin
            else None,
            "daysWithData": days_with_insulin,
        },
        "carbs": {
            "avgDailyG": round(sum(d["carbsG"] for d in daily) / days_with_meals)
            if days_with_meals
            else None,
            "daysLogged": days_with_meals,
        },
        "activity": {
            "avgSteps": round(mean([d["steps"] for d in daily if d["steps"] is not None]))
            if any(d["steps"] is not None for d in daily)
            else None,
            "sportSessions": len(sports),
        },
        "daily": daily[::-1],
        "pain": _pain_summary(db, device_ids, start_key, end_key),
        "wellbeing": _wellbeing_summary(db, device_ids, start_key, end_key),
        "coverage": {"days": n_days},
    }


def _episode_analysis(
    db: Session,
    device_ids: list[str],
    *,
    start: datetime,
    end: datetime,
    points: list[dict[str, Any]],
    hypos: list[dict[str, Any]],
    daily: list[dict[str, Any]],
) -> dict[str, Any]:
    """Likely contributors for every hypo and high, plus meal-bolus timing.

    Context (meals, insulin, sport) starts a day before the period: a hypo on the first
    morning can come from the previous evening's padel or dinner bolus.
    """
    ctx_start = start - timedelta(hours=24)
    ctx_start_key = paris_date_key(ctx_start)
    end_key = paris_date_key(end)

    meals = [
        {"ts": _ms(m.eaten_at), "carbs": _carbs(m), "type": m.meal_type}
        for m in _scoped(db.query(Meal), Meal.device_id, device_ids)
        .filter(Meal.eaten_at >= ctx_start, Meal.eaten_at <= end)
        .order_by(Meal.eaten_at.asc())
        .all()
    ]
    pump = (
        _scoped(db.query(PumpLogEvent), PumpLogEvent.device_id, device_ids)
        .filter(PumpLogEvent.timestamp >= ctx_start, PumpLogEvent.timestamp <= end)
        .order_by(PumpLogEvent.timestamp.asc())
        .all()
    )
    boluses = [{"ts": _ms(p.timestamp), "units": float(p.units)} for p in pump if p.kind == "insulin_delivered" and p.units]
    alerts = [{"ts": _ms(p.timestamp), "kind": p.kind, "title": p.title or p.kind} for p in pump if p.kind != "insulin_delivered"]
    sports = (
        _scoped(db.query(SportMatch), SportMatch.device_id, device_ids)
        .filter(SportMatch.date >= ctx_start_key, SportMatch.date <= end_key)
        .all()
    )
    activity = (
        _scoped(db.query(ActivityDay), ActivityDay.device_id, device_ids)
        .filter(ActivityDay.date >= ctx_start_key, ActivityDay.date <= end_key)
        .all()
    )
    stress = [
        {"date": r.date, "level": r.level}
        for r in _scoped(db.query(StressLog), StressLog.device_id, device_ids)
        .filter(StressLog.date >= ctx_start_key, StressLog.date <= end_key)
        .all()
    ]
    profile = db.get(BodyProfile, "default")
    high_target = float(profile.tir_high_mgdl) if profile and profile.tir_high_mgdl else 180.0
    set_changed_at = _ms(profile.cannula_changed_at) if profile and profile.cannula_changed_at else None

    sessions = episode_causes.exercise_sessions(sports, activity)
    ratio = episode_causes.usual_carb_ratio(meals, boluses)
    steps_by_day = {d["date"]: d["steps"] for d in daily if d.get("steps")}
    usual_steps = mean(steps_by_day.values()) if len(steps_by_day) >= 3 else None
    highs = episode_causes.find_high_episodes(points, high_target)

    for h in hypos:
        h["causes"] = episode_causes.hypo_causes(
            h,
            points=points,
            meals=meals,
            boluses=boluses,
            alerts=alerts,
            sessions=sessions,
            highs=highs,
            ratio=ratio,
            steps_by_day=steps_by_day,
            usual_steps=usual_steps,
        )

    high_rows = []
    for e in highs:
        local = datetime.fromtimestamp(e["startedAt"] / 1000, tz=timezone.utc).astimezone(PARIS)
        high_rows.append(
            {
                **e,
                "date": local.strftime("%Y-%m-%d"),
                "time": local.strftime("%H:%M"),
                "causes": episode_causes.high_causes(
                    e,
                    meals=meals,
                    boluses=boluses,
                    alerts=alerts,
                    hypos=hypos,
                    stress=stress,
                    ratio=ratio,
                    set_changed_at=set_changed_at,
                ),
            }
        )

    period_meals = [m for m in meals if m["ts"] >= _ms(start)]
    return {
        "highTarget": high_target,
        "hypoPatterns": episode_causes.pattern_summary(hypos),
        "highs": {
            "count": len(high_rows),
            "events": high_rows[-30:][::-1],
            "patterns": episode_causes.pattern_summary(high_rows),
        },
        "bolusTiming": episode_causes.meal_bolus_timing(period_meals, boluses),
        "carbRatio": ratio,
    }


def _pain_summary(db: Session, device_ids: list[str], start_key: str, end_key: str) -> list[dict]:
    logs = (
        _scoped(db.query(InjuryPainLog), InjuryPainLog.device_id, device_ids)
        .filter(InjuryPainLog.date >= start_key, InjuryPainLog.date <= end_key)
        .order_by(InjuryPainLog.date.asc())
        .all()
    )
    injuries = {
        i.id: i
        for i in _scoped(db.query(Injury), Injury.device_id, device_ids).all()
        if i.status == "active" or i.id in {log.injury_id for log in logs}
    }
    out = []
    for injury_id, injury in injuries.items():
        scores = [(log.date, log.pain_score) for log in logs if log.injury_id == injury_id]
        values = [s for _, s in scores]
        half = len(values) // 2
        trend = None
        if len(values) >= 4:
            first, second = mean(values[:half]), mean(values[half:])
            trend = "better" if second < first - 0.5 else "worse" if second > first + 0.5 else "stable"
        out.append(
            {
                "title": injury.title or injury.body_area,
                "bodyArea": injury.body_area_other or injury.body_area,
                "status": injury.status,
                "startedOn": injury.started_on,
                "logCount": len(values),
                "avgPain": round(mean(values), 1) if values else None,
                "latestPain": values[-1] if values else None,
                "maxPain": max(values) if values else None,
                "trend": trend,
                "series": [{"date": d, "score": s} for d, s in scores],
            }
        )
    return out


def _wellbeing_summary(db: Session, device_ids: list[str], start_key: str, end_key: str) -> dict:
    checkins = (
        _scoped(db.query(DayCheckIn), DayCheckIn.device_id, device_ids)
        .filter(DayCheckIn.date >= start_key, DayCheckIn.date <= end_key)
        .all()
    )
    stress = (
        _scoped(db.query(StressLog), StressLog.device_id, device_ids)
        .filter(StressLog.date >= start_key, StressLog.date <= end_key)
        .all()
    )
    moods = {m: 0 for m in MOOD_ORDER}
    for c in checkins:
        if c.mood in moods:
            moods[c.mood] += 1
    sleep = [c.sleep_hours for c in checkins if c.sleep_hours]
    return {
        "checkInDays": len(checkins),
        "moodCounts": moods,
        "avgSleepHours": round(mean(sleep), 1) if sleep else None,
        "medicationTakenDays": sum(1 for c in checkins if c.medication_taken),
        "stressLogs": len(stress),
        "highStressLogs": sum(1 for s in stress if s.level == "high"),
    }


# --- Share links -----------------------------------------------------------


def create_care_share(
    db: Session, *, user_id: str, days: int, ttl_days: int, label: str = "", note: str | None = None
) -> CareShare:
    row = CareShare(
        token=secrets.token_urlsafe(24),
        label=label.strip()[:120],
        days=days,
        note=(note or "").strip() or None,
        expires_at=_utcnow() + timedelta(days=ttl_days),
        revoked=False,
        created_by_user_id=user_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_valid_care_share(db: Session, token: str) -> CareShare | None:
    row = db.get(CareShare, token)
    if not row or row.revoked or _aware(row.expires_at) < _utcnow():
        return None
    return row


def serialize_care_share(row: CareShare, base_url: str) -> dict[str, Any]:
    return {
        "token": row.token,
        "label": row.label,
        "days": row.days,
        "note": row.note,
        "url": f"{base_url}/care/{row.token}",
        "createdAt": _ms(row.created_at) if row.created_at else None,
        "expiresAt": _ms(row.expires_at),
        "revoked": bool(row.revoked),
    }
