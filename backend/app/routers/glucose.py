from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import GlucoseSample, Meal, PumpLogEvent, User
from app.routers.pump import KIND_LABELS, serialize_pump_event
from app.schemas import GlucoseSyncIn
from app.services.glucose_stats import to_mg_dl

router = APIRouter(prefix="/glucose", tags=["glucose"])


def _window_bounds(
    hours: int,
    from_ms: int | None,
    to_ms: int | None,
) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    if from_ms is not None and to_ms is not None:
        start = datetime.fromtimestamp(
            from_ms / 1000 if from_ms > 1e12 else from_ms, tz=timezone.utc
        )
        end = datetime.fromtimestamp(to_ms / 1000 if to_ms > 1e12 else to_ms, tz=timezone.utc)
        return start, end
    end = now
    return end - timedelta(hours=hours), end


@router.post("/sync")
def sync_glucose(
    body: GlucoseSyncIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    inserted = 0
    for r in body.readings[:500]:
        ts = datetime.fromtimestamp(r.timestamp / 1000 if r.timestamp > 1e12 else r.timestamp)
        exists = (
            db.query(GlucoseSample)
            .filter(
                GlucoseSample.device_id == device_id,
                GlucoseSample.timestamp == ts,
                GlucoseSample.value == r.value,
            )
            .first()
        )
        if exists:
            continue
        db.add(
            GlucoseSample(
                id=str(uuid.uuid4()),
                device_id=device_id,
                value=r.value,
                unit=r.unit,
                timestamp=ts,
            )
        )
        inserted += 1
    db.commit()
    return {"ok": True, "inserted": inserted}


@router.get("/history")
def glucose_history(
    hours: int = Query(12, ge=1, le=168),
    from_ms: int | None = Query(None, alias="from"),
    to_ms: int | None = Query(None, alias="to"),
    limit: int = Query(800, ge=1, le=2000),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return CGM samples for charting (12h / 24h / custom range)."""
    ids = household_device_ids(db, user)
    if not ids:
        return {"readings": [], "from": None, "to": None, "hours": hours}

    start, end = _window_bounds(hours, from_ms, to_ms)

    rows = (
        db.query(GlucoseSample)
        .filter(
            GlucoseSample.device_id.in_(ids),
            GlucoseSample.timestamp >= start,
            GlucoseSample.timestamp <= end,
        )
        .order_by(GlucoseSample.timestamp.asc())
        .limit(limit)
        .all()
    )

    readings = []
    for r in rows:
        ts = r.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        unit = (r.unit or "mg/dL").replace("mg/dl", "mg/dL").replace("mmol/l", "mmol/L")
        if unit not in ("mg/dL", "mmol/L"):
            unit = "mg/dL"
        mg = to_mg_dl(float(r.value), unit)
        readings.append(
            {
                "value": float(r.value),
                "unit": unit,
                "timestamp": int(ts.timestamp() * 1000),
                "valueMgDl": round(mg, 1),
            }
        )

    return {
        "readings": readings,
        "from": int(start.timestamp() * 1000),
        "to": int(end.timestamp() * 1000),
        "hours": hours,
        "count": len(readings),
    }


@router.get("/events")
def glucose_chart_events(
    hours: int = Query(12, ge=1, le=168),
    from_ms: int | None = Query(None, alias="from"),
    to_ms: int | None = Query(None, alias="to"),
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Meals + pump events (insulin, alerts) for overlaying on the glycemia chart."""
    ids = household_device_ids(db, user)
    start, end = _window_bounds(hours, from_ms, to_ms)
    if not ids:
        return {
            "events": [],
            "from": int(start.timestamp() * 1000),
            "to": int(end.timestamp() * 1000),
            "hours": hours,
        }

    events: list[dict] = []

    meals = (
        db.query(Meal)
        .filter(
            Meal.device_id.in_(ids),
            Meal.eaten_at >= start,
            Meal.eaten_at <= end,
        )
        .order_by(Meal.eaten_at.asc())
        .limit(limit)
        .all()
    )
    for m in meals:
        ts = m.eaten_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        try:
            macros = json.loads(m.macros_json or "{}")
        except json.JSONDecodeError:
            macros = {}
        carbs = macros.get("carbsG")
        meal_type = (m.meal_type or "meal").replace("_", " ").title()
        detail_parts = []
        if carbs is not None:
            try:
                detail_parts.append(f"{round(float(carbs))}g carbs")
            except (TypeError, ValueError):
                pass
        kcal = macros.get("caloriesKcal")
        if kcal is not None:
            try:
                detail_parts.append(f"{round(float(kcal))} kcal")
            except (TypeError, ValueError):
                pass
        events.append(
            {
                "id": f"meal-{m.id}",
                "type": "meal",
                "timestamp": int(ts.timestamp() * 1000),
                "label": meal_type,
                "detail": " · ".join(detail_parts) if detail_parts else None,
                "carbsG": carbs,
                "units": None,
                "kind": m.meal_type,
            }
        )

    pump_rows = (
        db.query(PumpLogEvent)
        .filter(
            PumpLogEvent.device_id.in_(ids),
            PumpLogEvent.timestamp >= start,
            PumpLogEvent.timestamp <= end,
            PumpLogEvent.kind.in_(
                (
                    "insulin_delivered",
                    "low",
                    "urgent_low",
                    "high",
                    "reservoir",
                    "occlusion",
                    "sensor",
                    "alert",
                )
            ),
        )
        .order_by(PumpLogEvent.timestamp.asc())
        .limit(limit)
        .all()
    )
    for row in pump_rows:
        ser = serialize_pump_event(row)
        kind = ser.get("kind") or "other"
        event_type = "insulin" if kind == "insulin_delivered" else "pump"
        label = ser.get("kindLabel") or KIND_LABELS.get(kind, "Pump")
        if event_type == "insulin" and ser.get("units") is not None:
            u = ser["units"]
            u_disp = int(u) if float(u).is_integer() else u
            label = f"{u_disp} U"
        events.append(
            {
                "id": f"pump-{ser['id']}",
                "type": event_type,
                "timestamp": ser.get("timestamp"),
                "label": label,
                "detail": ser.get("message"),
                "carbsG": None,
                "units": ser.get("units"),
                "kind": kind,
            }
        )

    events.sort(key=lambda e: e.get("timestamp") or 0)
    return {
        "events": events,
        "from": int(start.timestamp() * 1000),
        "to": int(end.timestamp() * 1000),
        "hours": hours,
        "count": len(events),
    }
