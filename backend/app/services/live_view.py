"""Live glucose view for family: current reading, trend and today's essentials."""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models import BodyProfile, GlucoseSample, LiveShare, Meal, PumpLogEvent
from app.services import glucose_trend
from app.services.glucose_stats import to_mg_dl
from app.services.reports import paris_date_key, paris_day_bounds

CHART_HOURS = 12


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ms(dt: datetime) -> int:
    return int(_aware(dt).timestamp() * 1000)


def _scoped(query, column, device_ids: list[str]):
    return query.filter(column.in_(device_ids)) if device_ids else query


def _carbs(meal: Meal) -> float:
    try:
        return float(json.loads(meal.macros_json or "{}").get("carbsG") or 0)
    except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
        return 0.0


def _targets(db: Session) -> tuple[float, float]:
    profile = db.get(BodyProfile, "default")
    low = float(profile.tir_low_mgdl) if profile and profile.tir_low_mgdl else 70.0
    high = float(profile.tir_high_mgdl) if profile and profile.tir_high_mgdl else 180.0
    return low, high


def build_live_view(db: Session, device_ids: list[str], now: datetime | None = None) -> dict[str, Any]:
    now = now or _utcnow()
    now_ms = _ms(now)
    low, high = _targets(db)

    since = now - timedelta(hours=CHART_HOURS)
    rows = (
        _scoped(db.query(GlucoseSample), GlucoseSample.device_id, device_ids)
        .filter(GlucoseSample.timestamp >= since, GlucoseSample.timestamp <= now + timedelta(minutes=5))
        .order_by(GlucoseSample.timestamp.asc())
        .all()
    )
    samples = [glucose_trend.Sample(to_mg_dl(r.value, r.unit), _ms(r.timestamp)) for r in rows]
    unit = rows[-1].unit if rows else "mg/dL"
    insight = glucose_trend.analyze(samples, now_ms, low, high)

    day_start, day_end = paris_day_bounds(paris_date_key(now))
    today_samples = [s for s in samples if s.timestamp >= _ms(day_start)]
    today_mg = [s.mg_dl for s in today_samples]
    in_range = sum(1 for v in today_mg if low <= v <= high)

    meals_today = (
        _scoped(db.query(Meal), Meal.device_id, device_ids)
        .filter(Meal.eaten_at >= day_start, Meal.eaten_at < day_end)
        .order_by(Meal.eaten_at.desc())
        .all()
    )
    last_meal = (
        _scoped(db.query(Meal), Meal.device_id, device_ids)
        .filter(Meal.eaten_at <= now)
        .order_by(Meal.eaten_at.desc())
        .first()
    )
    insulin_today = (
        _scoped(db.query(PumpLogEvent), PumpLogEvent.device_id, device_ids)
        .filter(
            PumpLogEvent.kind == "insulin_delivered",
            PumpLogEvent.timestamp >= day_start,
            PumpLogEvent.timestamp < day_end,
        )
        .all()
    )
    last_insulin = (
        _scoped(db.query(PumpLogEvent), PumpLogEvent.device_id, device_ids)
        .filter(PumpLogEvent.kind == "insulin_delivered", PumpLogEvent.timestamp <= now)
        .order_by(PumpLogEvent.timestamp.desc())
        .first()
    )

    current = insight.current
    return {
        "now": now_ms,
        "unit": unit,
        "targets": {"lowMgDl": low, "highMgDl": high},
        "current": {"mgDl": round(current.mg_dl, 1), "timestamp": current.timestamp} if current else None,
        "insight": {
            "ageMs": insight.age_ms,
            "isStale": insight.is_stale,
            "ratePerMin": round(insight.rate_per_min, 3) if insight.rate_per_min is not None else None,
            "arrow": insight.arrow,
            "zone": insight.zone,
            "minutesToLow": insight.minutes_to_low,
            "minutesToHigh": insight.minutes_to_high,
            "prediction": [{"mgDl": round(p.mg_dl, 1), "timestamp": p.timestamp} for p in insight.prediction],
        },
        "readings": [{"mgDl": round(s.mg_dl, 1), "timestamp": s.timestamp} for s in glucose_trend.sanitize(samples)],
        "today": {
            "timeInRangePct": round(in_range * 100 / len(today_mg)) if len(today_mg) >= 3 else None,
            "avgMgDl": round(sum(today_mg) / len(today_mg)) if today_mg else None,
            "carbsG": round(sum(_carbs(m) for m in meals_today)),
            "mealCount": len(meals_today),
            "insulinU": round(sum(e.units or 0 for e in insulin_today), 1),
        },
        "lastMeal": (
            {"mealType": last_meal.meal_type, "carbsG": round(_carbs(last_meal)), "timestamp": _ms(last_meal.eaten_at)}
            if last_meal
            else None
        ),
        "lastInsulin": (
            {"units": last_insulin.units, "timestamp": _ms(last_insulin.timestamp)} if last_insulin else None
        ),
    }


def create_live_share(db: Session, *, user_id: str, label: str = "", ttl_days: int | None = None) -> LiveShare:
    row = LiveShare(
        token=secrets.token_urlsafe(24),
        label=label.strip()[:120],
        expires_at=_utcnow() + timedelta(days=ttl_days) if ttl_days else None,
        revoked=False,
        created_by_user_id=user_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_valid_live_share(db: Session, token: str) -> LiveShare | None:
    row = db.get(LiveShare, token)
    if not row or row.revoked:
        return None
    if row.expires_at is not None and _aware(row.expires_at) < _utcnow():
        return None
    return row


def serialize_live_share(row: LiveShare, base_url: str) -> dict[str, Any]:
    return {
        "token": row.token,
        "label": row.label,
        "url": f"{base_url}/live/{row.token}",
        "createdAt": _ms(row.created_at) if row.created_at else None,
        "expiresAt": _ms(row.expires_at) if row.expires_at else None,
        "revoked": bool(row.revoked),
    }
