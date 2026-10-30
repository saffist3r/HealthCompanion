"""Watch-outs: timely warnings when something just happened that, in this person's own history,
tends to lead to a hypo or a high (sport → night hypos, late bolus → highs, ...).

Each watch-out has a stable id so the phone notifies it once, and a fire time (now, or later
the same day, e.g. bedtime after sport).
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import ActivityDay, BodyProfile, GlucoseSample, Meal, PumpLogEvent, SportMatch
from app.services import episode_causes as ec
from app.services.glucose_stats import find_hypo_events, to_mg_dl
from app.services.pattern_finder import find_patterns

PARIS = ZoneInfo("Europe/Paris")
MIN = 60_000
BEDTIME = (21, 30)
BOLUS_WAIT_MIN = 10  # give the pump notification time to arrive
BOLUS_WINDOW_MIN = 60
PATTERN_CACHE_S = 30 * 60

_pattern_cache: dict[tuple[str, ...], tuple[float, list[dict[str, Any]]]] = {}

TEXT = {
    "en": {
        "sportNightTitle": "{sport} today: watch tonight",
        "sportNightPattern": "After sport you went low on {hits} of {nights} nights. Check before bed and consider a snack or lower basal.",
        "sportNightGeneric": "Exercise can lower glucose for up to 24 hours. Check before bed.",
        "sportSoonTitle": "Just after {sport}: watch the next hours",
        "sportSoonBody": "{hits} of {sessions} sessions were followed by a hypo within 4 h. Keep sugar close.",
        "bolusTitle": "{meal} logged, no bolus yet",
        "bolusLate": "Late boluses went high {pct} of the time ({hits} of {meals}). Bolus now if you haven't.",
        "bolusMissed": "Meals without a bolus went high {pct} of the time ({hits} of {meals}). Bolus now if you haven't.",
        "bolusGeneric": "No bolus seen since you ate. Bolus now if you haven't.",
        "reboundTitle": "Hypo over: go easy on the sugar",
        "reboundBody": "{hits} of {hypos} hypos rebounded high within 3 h. 15 g is usually enough, then recheck.",
        "meals": {"breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner", "snack": "Snack", "other": "Meal"},
    },
    "fr": {
        "sportNightTitle": "{sport} aujourd’hui : vigilance cette nuit",
        "sportNightPattern": "Après le sport, hypo {hits} nuits sur {nights}. Contrôlez avant le coucher et pensez à une collation ou à baisser le basal.",
        "sportNightGeneric": "L’effort peut faire baisser la glycémie jusqu’à 24 h. Contrôlez avant le coucher.",
        "sportSoonTitle": "Juste après le {sport} : vigilance les prochaines heures",
        "sportSoonBody": "{hits} séances sur {sessions} ont été suivies d’une hypo dans les 4 h. Gardez du sucre à portée.",
        "bolusTitle": "{meal} enregistré, pas encore de bolus",
        "bolusLate": "Les bolus en retard ont donné une hyper {pct} du temps ({hits} sur {meals}). Faites le bolus si ce n’est pas fait.",
        "bolusMissed": "Les repas sans bolus ont donné une hyper {pct} du temps ({hits} sur {meals}). Faites le bolus si ce n’est pas fait.",
        "bolusGeneric": "Aucun bolus vu depuis le repas. Faites-le si ce n’est pas fait.",
        "reboundTitle": "Hypo terminée : doucement sur le sucre",
        "reboundBody": "{hits} hypos sur {hypos} ont rebondi en hyper dans les 3 h. 15 g suffisent souvent, puis recontrôlez.",
        "meals": {"breakfast": "Petit-déjeuner", "lunch": "Déjeuner", "dinner": "Dîner", "snack": "Collation", "other": "Repas"},
    },
}


def _ms(dt: datetime) -> int:
    dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _scoped(query, column, device_ids: list[str]):
    return query.filter(column.in_(device_ids)) if device_ids else query


def _carbs(meal: Meal) -> float:
    try:
        return float(json.loads(meal.macros_json or "{}").get("carbsG") or 0)
    except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
        return 0.0


def _patterns(db: Session, device_ids: list[str], now: datetime) -> dict[str, dict[str, Any]]:
    key = tuple(sorted(device_ids))
    hit = _pattern_cache.get(key)
    if hit and time.time() - hit[0] < PATTERN_CACHE_S:
        found = hit[1]
    else:
        found = find_patterns(db, device_ids, now=now)["patterns"]
        _pattern_cache[key] = (time.time(), found)
    return {p["code"]: p["params"] for p in found}


def build_watchouts(db: Session, device_ids: list[str], now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(tz=timezone.utc)
    now_ms = _ms(now)
    local = now.astimezone(PARIS)
    today = local.strftime("%Y-%m-%d")
    profile = db.get(BodyProfile, "default")
    lang = "fr" if profile and (profile.locale or "").startswith("fr") else "en"
    t = TEXT[lang]
    patterns = _patterns(db, device_ids, now)
    out: list[dict[str, Any]] = []

    def add(wid: str, title: str, body: str, fire_at: int, kind: str) -> None:
        out.append({"id": wid, "kind": kind, "title": title, "body": body, "fireAt": max(fire_at, now_ms)})

    # 1. Sport today → tonight; and right after sport when that tends to go low
    sports = _scoped(db.query(SportMatch), SportMatch.device_id, device_ids).filter(SportMatch.date == today).all()
    activity = _scoped(db.query(ActivityDay), ActivityDay.device_id, device_ids).filter(ActivityDay.date == today).all()
    sessions = [s for s in ec.exercise_sessions(sports, activity) if s["durationMin"] >= 20]
    if sessions:
        s = sessions[0]
        name = (s["name"] or "Sport").capitalize()
        bedtime = local.replace(hour=BEDTIME[0], minute=BEDTIME[1], second=0, microsecond=0)
        night = patterns.get("sportNightHypo")
        body = t["sportNightPattern"].format(**night) if night else t["sportNightGeneric"]
        add(f"sport-night-{today}", t["sportNightTitle"].format(sport=name), body, _ms(bedtime), "sport")
        soon = patterns.get("hypoAfterSport")
        for sess in sessions:
            if soon and sess["end"] and 0 <= now_ms - sess["end"] <= 2 * 60 * MIN:
                add(
                    f"sport-soon-{sess['end']}",
                    t["sportSoonTitle"].format(sport=(sess["name"] or "sport").lower()),
                    t["sportSoonBody"].format(**soon),
                    now_ms,
                    "sport",
                )

    # 2. Meal logged a little while ago with no bolus since
    since = now - timedelta(minutes=BOLUS_WINDOW_MIN)
    meals = (
        _scoped(db.query(Meal), Meal.device_id, device_ids)
        .filter(Meal.eaten_at >= since, Meal.eaten_at <= now - timedelta(minutes=BOLUS_WAIT_MIN))
        .all()
    )
    for m in meals:
        if _carbs(m) < 15:
            continue
        eaten = _ms(m.eaten_at)
        bolus = (
            _scoped(db.query(PumpLogEvent), PumpLogEvent.device_id, device_ids)
            .filter(
                PumpLogEvent.kind == "insulin_delivered",
                PumpLogEvent.timestamp >= m.eaten_at - timedelta(milliseconds=ec.BOLUS_BEFORE_MEAL_MS),
            )
            .first()
        )
        if bolus:
            continue
        late, missed = patterns.get("lateBolusHigh"), patterns.get("missedBolusHigh")
        if late:
            body = t["bolusLate"].format(pct=f"{round(late['hits'] * 100 / late['meals'])}%", **late)
        elif missed:
            body = t["bolusMissed"].format(pct=f"{round(missed['hits'] * 100 / missed['meals'])}%", **missed)
        else:
            body = t["bolusGeneric"]
        meal_name = t["meals"].get(m.meal_type, t["meals"]["other"])
        add(f"bolus-{m.id}", t["bolusTitle"].format(meal=meal_name), body, eaten + BOLUS_WAIT_MIN * MIN, "bolus")

    # 3. A hypo just ended and they tend to rebound high
    rebound = patterns.get("reboundAfterHypo")
    if rebound:
        rows = (
            _scoped(db.query(GlucoseSample), GlucoseSample.device_id, device_ids)
            .filter(GlucoseSample.timestamp >= now - timedelta(hours=2))
            .order_by(GlucoseSample.timestamp.asc())
            .all()
        )
        points = [{"timestamp": _ms(r.timestamp), "mgDl": to_mg_dl(r.value, r.unit)} for r in rows]
        low = float(profile.tir_low_mgdl) if profile and profile.tir_low_mgdl else 70.0
        hypos = find_hypo_events(points, threshold=low)
        last = hypos[-1] if hypos else None
        if last and points and points[-1]["mgDl"] >= low and 0 <= now_ms - last["endedAt"] <= 30 * MIN:
            add(f"rebound-{last['startedAt']}", t["reboundTitle"], t["reboundBody"].format(**rebound), now_ms, "rebound")

    return out
