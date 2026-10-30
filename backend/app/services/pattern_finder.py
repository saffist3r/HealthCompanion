"""Automatic pattern spotting over the stored history.

Asks a fixed set of questions of the data (does sport lead to night hypos, do late boluses
lead to highs, which meal spikes most, when do hypos cluster, ...) and only reports an answer
when there are enough cases and the difference is clear, so noise isn't presented as a pattern.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from statistics import mean, median
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import ActivityDay, BodyProfile, GlucoseSample, Meal, PumpLogEvent, SportMatch, StressLog
from app.services import episode_causes as ec
from app.services.glucose_stats import find_hypo_events, to_mg_dl

PARIS = ZoneInfo("Europe/Paris")
MIN = 60_000
HOUR = 60 * MIN
LOOKBACK_DAYS = 90

# Evidence thresholds
MIN_GROUP = 4  # cases in the smaller group
MIN_RATE_GAP = 0.15  # absolute difference in rates
MIN_RATE_RATIO = 1.5
MIN_TIR_GAP = 10  # percentage points
MIN_MEAN_GAP = 15  # mg/dL


def _ms(dt: datetime) -> int:
    dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _local(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(PARIS)


def _day(ms: int) -> str:
    return _local(ms).strftime("%Y-%m-%d")


def _scoped(query, column, device_ids: list[str]):
    return query.filter(column.in_(device_ids)) if device_ids else query


def _pattern(code: str, strength: float, **params: Any) -> dict[str, Any]:
    return {"code": code, "strength": round(strength, 2), "params": params}


def _rate_gap(hits_a: int, n_a: int, hits_b: int, n_b: int) -> tuple[float, float] | None:
    """(rate_a, rate_b) when group A clearly exceeds group B, else None."""
    if n_a < MIN_GROUP or n_b < MIN_GROUP:
        return None
    ra, rb = hits_a / n_a, hits_b / n_b
    if ra - rb >= MIN_RATE_GAP and (rb == 0 or ra / rb >= MIN_RATE_RATIO) and hits_a >= 2:
        return ra, rb
    return None


def find_patterns(db: Session, device_ids: list[str], now: datetime | None = None, days: int = LOOKBACK_DAYS) -> dict[str, Any]:
    end = now or datetime.now(tz=timezone.utc)
    start = end - timedelta(days=days)
    start_key = _day(_ms(start))

    points = [
        {"timestamp": _ms(r.timestamp), "mgDl": to_mg_dl(r.value, r.unit)}
        for r in _scoped(db.query(GlucoseSample), GlucoseSample.device_id, device_ids)
        .filter(GlucoseSample.timestamp >= start, GlucoseSample.timestamp <= end)
        .order_by(GlucoseSample.timestamp.asc())
        .all()
    ]
    if len(points) < 200:
        return {"lookbackDays": days, "daysWithData": len({_day(p["timestamp"]) for p in points}), "patterns": []}

    profile = db.get(BodyProfile, "default")
    low = float(profile.tir_low_mgdl) if profile and profile.tir_low_mgdl else 70.0
    high = float(profile.tir_high_mgdl) if profile and profile.tir_high_mgdl else 180.0

    meals = [
        {"ts": _ms(m.eaten_at), "carbs": ec_carbs(m), "type": m.meal_type}
        for m in _scoped(db.query(Meal), Meal.device_id, device_ids)
        .filter(Meal.eaten_at >= start, Meal.eaten_at <= end)
        .order_by(Meal.eaten_at.asc())
        .all()
    ]
    boluses = [
        {"ts": _ms(p.timestamp), "units": float(p.units)}
        for p in _scoped(db.query(PumpLogEvent), PumpLogEvent.device_id, device_ids)
        .filter(PumpLogEvent.timestamp >= start, PumpLogEvent.timestamp <= end, PumpLogEvent.kind == "insulin_delivered")
        .order_by(PumpLogEvent.timestamp.asc())
        .all()
        if p.units
    ]
    sports = _scoped(db.query(SportMatch), SportMatch.device_id, device_ids).filter(SportMatch.date >= start_key).all()
    activity = _scoped(db.query(ActivityDay), ActivityDay.device_id, device_ids).filter(ActivityDay.date >= start_key).all()
    stress_days = {
        r.date
        for r in _scoped(db.query(StressLog), StressLog.device_id, device_ids).filter(StressLog.date >= start_key).all()
        if r.level == "high"
    }

    hypos = [h for h in find_hypo_events(points, threshold=low) if h["readingCount"] >= 3 or h["durationMin"] >= 15]
    highs = ec.find_high_episodes(points, high)

    by_day: dict[str, list[float]] = {}
    for p in points:
        by_day.setdefault(_day(p["timestamp"]), []).append(p["mgDl"])
    full_days = {d: v for d, v in by_day.items() if len(v) >= 72}  # ~6 h of 5-min readings

    def tir(values: list[float]) -> float:
        return 100 * sum(1 for v in values if low <= v <= high) / len(values)

    sessions = ec.exercise_sessions(sports, activity)
    sport_days = {s["date"] for s in sessions}
    patterns: list[dict[str, Any]] = []

    # 1. Night hypos after sport days
    nights = sorted(d for d in full_days)
    night_hypo = {_day(h["startedAt"]) for h in hypos if _local(h["startedAt"]).hour < 7}
    after_sport = [d for d in nights if _prev(d) in sport_days]
    other = [d for d in nights if _prev(d) not in sport_days]
    gap = _rate_gap(sum(d in night_hypo for d in after_sport), len(after_sport), sum(d in night_hypo for d in other), len(other))
    if gap:
        patterns.append(_pattern(
            "sportNightHypo", gap[0] - gap[1],
            hits=sum(d in night_hypo for d in after_sport), nights=len(after_sport),
            otherHits=sum(d in night_hypo for d in other), otherNights=len(other),
        ))

    # 2. Hypos within 4 h of sport vs the same hours on non-sport days
    timed = [s for s in sessions if s["end"]]
    if len(timed) >= MIN_GROUP:
        after = sum(1 for s in timed if any(0 <= h["startedAt"] - s["end"] <= 4 * HOUR for h in hypos))
        if after >= 2 and after / len(timed) >= 0.3:
            patterns.append(_pattern("hypoAfterSport", after / len(timed), hits=after, sessions=len(timed)))

    # 3. Late or missed meal boluses vs on-time: share followed by a high within 3 h
    def went_high(meal_ts: int) -> bool:
        return any(meal_ts <= e["startedAt"] <= meal_ts + 3 * HOUR for e in highs)

    groups: dict[str, list[bool]] = {"onTime": [], "late": [], "missed": []}
    for m in meals:
        if m["carbs"] < 15 or m["ts"] + 3 * HOUR > _ms(end):
            continue
        matched = [b for b in boluses if m["ts"] - ec.BOLUS_BEFORE_MEAL_MS <= b["ts"] <= m["ts"] + ec.BOLUS_AFTER_MEAL_MS]
        kind = "missed" if not matched else "late" if (matched[0]["ts"] - m["ts"]) / MIN > ec.LATE_BOLUS_MIN else "onTime"
        groups[kind].append(went_high(m["ts"]))
    for kind in ("late", "missed"):
        g, ref = groups[kind], groups["onTime"]
        gap = _rate_gap(sum(g), len(g), sum(ref), len(ref))
        if gap:
            patterns.append(_pattern(
                "lateBolusHigh" if kind == "late" else "missedBolusHigh", gap[0] - gap[1],
                hits=sum(g), meals=len(g), onTimeHits=sum(ref), onTimeMeals=len(ref),
            ))

    # 4. Which meal spikes most (median rise over the 3 h after eating)
    rises: dict[str, list[float]] = {}
    for m in meals:
        if m["carbs"] < 15:
            continue
        before = [p["mgDl"] for p in points if m["ts"] - 20 * MIN <= p["timestamp"] <= m["ts"] + 5 * MIN]
        after = [p["mgDl"] for p in points if m["ts"] + 30 * MIN <= p["timestamp"] <= m["ts"] + 3 * HOUR]
        if before and len(after) >= 6:
            rises.setdefault(m["type"], []).append(max(after) - before[-1])
    medians = {t: median(v) for t, v in rises.items() if len(v) >= 5 and t in ("breakfast", "lunch", "dinner", "snack")}
    if len(medians) >= 2:
        worst = max(medians, key=medians.get)
        rest = median([v for t, v in medians.items() if t != worst])
        if medians[worst] - rest >= 30:
            patterns.append(_pattern(
                "mealSpike", (medians[worst] - rest) / 100,
                mealType=worst, riseMgDl=round(medians[worst]), otherRiseMgDl=round(rest), meals=len(rises[worst]),
            ))

    # 5–6. When hypos and highs cluster (3-hour windows)
    for code, episodes in (("hypoTimeCluster", hypos), ("highTimeCluster", highs)):
        if len(episodes) >= 5:
            bins = Counter(_local(e["startedAt"]).hour // 3 for e in episodes)
            slot, n = bins.most_common(1)[0]
            if n / len(episodes) >= 0.4 and n >= 4:
                patterns.append(_pattern(code, n / len(episodes), fromHour=slot * 3, toHour=slot * 3 + 3, hits=n, episodes=len(episodes)))

    # 7. Early-morning rise without food (dawn phenomenon)
    dawn_days = rises_days = 0
    for d in full_days:
        night = [p for p in points if _day(p["timestamp"]) == d and 3 <= _local(p["timestamp"]).hour < 8]
        if len(night) < 24:
            continue
        ate = any(_day(m["ts"]) == d and 3 <= _local(m["ts"]).hour < 8 for m in meals)
        if ate:
            continue
        rises_days += 1
        if night[-1]["mgDl"] - min(p["mgDl"] for p in night[: len(night) // 2]) >= 30:
            dawn_days += 1
    if rises_days >= 7 and dawn_days / rises_days >= 0.5:
        patterns.append(_pattern("dawnRise", dawn_days / rises_days, days=dawn_days, of=rises_days))

    # 8. Rebound highs after treating a hypo
    if len(hypos) >= MIN_GROUP:
        rebounds = sum(1 for h in hypos if any(0 <= e["startedAt"] - h["endedAt"] <= 3 * HOUR for e in highs))
        if rebounds >= 3 and rebounds / len(hypos) >= 0.35:
            patterns.append(_pattern("reboundAfterHypo", rebounds / len(hypos), hits=rebounds, hypos=len(hypos)))

    # 9–12. Day types: weekend, stress, sport, very active
    def compare(code: str, in_group: set[str], **extra: Any) -> None:
        a = [d for d in full_days if d in in_group]
        b = [d for d in full_days if d not in in_group]
        if len(a) < 3 or len(b) < 3:
            return
        tir_a, tir_b = mean(tir(full_days[d]) for d in a), mean(tir(full_days[d]) for d in b)
        avg_a, avg_b = mean(mean(full_days[d]) for d in a), mean(mean(full_days[d]) for d in b)
        if abs(tir_a - tir_b) >= MIN_TIR_GAP or abs(avg_a - avg_b) >= MIN_MEAN_GAP:
            patterns.append(_pattern(
                code, abs(tir_a - tir_b) / 100 + abs(avg_a - avg_b) / 200,
                days=len(a), otherDays=len(b), tir=round(tir_a), otherTir=round(tir_b),
                avgMgDl=round(avg_a), otherAvgMgDl=round(avg_b), **extra,
            ))

    compare("weekendDiff", {d for d in full_days if datetime.strptime(d, "%Y-%m-%d").weekday() >= 5})
    compare("stressDayDiff", stress_days & set(full_days))
    compare("sportDayDiff", sport_days & set(full_days))
    steps = {a.date: a.steps for a in activity if a.steps}
    compare("activeDayDiff", {d for d, s in steps.items() if s >= 10_000})

    patterns.sort(key=lambda p: -p["strength"])
    return {"lookbackDays": days, "daysWithData": len(full_days), "patterns": patterns[:8]}


def _prev(day: str) -> str:
    return (datetime.strptime(day, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")


def ec_carbs(meal: Meal) -> float:
    try:
        return float(json.loads(meal.macros_json or "{}").get("carbsG") or 0)
    except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
        return 0.0
