from __future__ import annotations

import re
import uuid
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import PumpLogEvent, User
from app.schemas import PumpLogSyncIn

router = APIRouter(prefix="/pump", tags=["pump"])

KIND_LABELS = {
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

# Live sync: ignore CapAPS sticky refreshes of the same notice.
INSULIN_DEDUPE_WINDOW = timedelta(minutes=90)
OTHER_DEDUPE_WINDOW = timedelta(minutes=15)
# Historical cleanup: Date.now()-stamped refreshes can be hours apart.
CLEANUP_INSULIN_WINDOW = timedelta(hours=8)


def serialize_pump_event(row: PumpLogEvent) -> dict:
    ts = row.timestamp
    kind = row.kind or "other"
    units = row.units
    label = KIND_LABELS.get(kind, kind.replace("_", " ").title())
    message = (row.message or "").strip()
    raw = (row.raw_text or "").strip()
    blob = f"{message} {raw} {row.title or ''}"
    if units is None and kind == "insulin_delivered":
        m = re.search(r"(?i)(?:delivered\s+)?(\d+[.,]\d+|\d+)\s*(?:U|IU|units?)\b", blob)
        if m:
            try:
                units = float(m.group(1).replace(",", "."))
            except ValueError:
                units = None
    if kind == "insulin_delivered" and units is not None:
        u = int(units) if float(units).is_integer() else units
        message = f"Delivered {u} U of insulin"
    elif any(x in message for x in ("android.app.Notification", "NotificationCompat", "com.camdiab")):
        message = label
    return {
        "id": row.id,
        "kind": kind,
        "kindLabel": label,
        "title": label,
        "message": message,
        "units": units,
        "packageId": row.package_id,
        "rawText": message,
        "timestamp": int(ts.timestamp() * 1000) if ts else None,
        "time": ts.strftime("%H:%M") if ts else None,
        "date": ts.strftime("%Y-%m-%d") if ts else None,
    }


def _normalize_message(message: str | None) -> str:
    return re.sub(r"\s+", " ", (message or "").strip().lower())[:160]


def _units_close(a: float | None, b: float | None) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) < 0.001


def _find_duplicate(
    db: Session,
    *,
    device_id: str,
    kind: str,
    units: float | None,
    message: str,
    ts: datetime,
) -> PumpLogEvent | None:
    window = INSULIN_DEDUPE_WINDOW if kind == "insulin_delivered" else OTHER_DEDUPE_WINDOW
    start = ts - window
    end = ts + window
    candidates = (
        db.query(PumpLogEvent)
        .filter(
            PumpLogEvent.device_id == device_id,
            PumpLogEvent.kind == kind,
            PumpLogEvent.timestamp >= start,
            PumpLogEvent.timestamp <= end,
        )
        .all()
    )
    norm = _normalize_message(message)
    for row in candidates:
        if not _units_close(row.units, units):
            continue
        if _normalize_message(row.message) == norm or _normalize_message(row.raw_text) == norm:
            return row
        # Exact timestamp match (legacy dedupe)
        if row.timestamp == ts and _units_close(row.units, units):
            return row
    return None


def cleanup_pump_duplicates(db: Session, device_id: str | None = None) -> int:
    """Remove near-duplicate pump rows (keep earliest). Returns deleted count."""
    q = db.query(PumpLogEvent).order_by(PumpLogEvent.timestamp.asc(), PumpLogEvent.created_at.asc())
    if device_id:
        q = q.filter(PumpLogEvent.device_id == device_id)
    rows = q.all()
    keep: list[PumpLogEvent] = []
    delete_ids: list[str] = []
    for row in rows:
        is_dup = False
        for kept in keep:
            if kept.device_id != row.device_id or kept.kind != row.kind:
                continue
            window = (
                CLEANUP_INSULIN_WINDOW if row.kind == "insulin_delivered" else OTHER_DEDUPE_WINDOW
            )
            if abs((kept.timestamp - row.timestamp).total_seconds()) > window.total_seconds():
                continue
            if not _units_close(kept.units, row.units):
                continue
            if _normalize_message(kept.message) != _normalize_message(row.message):
                continue
            is_dup = True
            break
        if is_dup:
            delete_ids.append(row.id)
        else:
            keep.append(row)
    if not delete_ids:
        return 0
    (
        db.query(PumpLogEvent)
        .filter(PumpLogEvent.id.in_(delete_ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return len(delete_ids)


@router.post("/sync")
def sync_pump_events(
    body: PumpLogSyncIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    inserted = 0
    skipped = 0
    for ev in body.events[:500]:
        ts = datetime.fromtimestamp(ev.timestamp / 1000 if ev.timestamp > 1e12 else ev.timestamp)
        kind = (ev.kind or "other").strip()[:32] or "other"
        units = ev.units
        message = (ev.message or "").strip() or (ev.title or "").strip()
        if _find_duplicate(db, device_id=device_id, kind=kind, units=units, message=message, ts=ts):
            skipped += 1
            continue
        db.add(
            PumpLogEvent(
                id=str(uuid.uuid4()),
                device_id=device_id,
                kind=kind,
                title=(ev.title or "")[:255],
                message=message,
                units=units,
                package_id=(ev.packageId or None),
                raw_text=(ev.rawText or message or "")[:2000],
                timestamp=ts,
            )
        )
        inserted += 1
    db.commit()
    # Opportunistic cleanup of historical near-dupes for this device
    removed = cleanup_pump_duplicates(db, device_id=device_id)
    return {"ok": True, "inserted": inserted, "skipped": skipped, "removedDuplicates": removed}


@router.post("/cleanup-duplicates")
def cleanup_duplicates_endpoint(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """One-shot collapse of redundant CapAPS insulin / alert rows."""
    ids = household_device_ids(db, user)
    removed = 0
    if ids:
        for device_id in ids:
            removed += cleanup_pump_duplicates(db, device_id=device_id)
    else:
        removed = cleanup_pump_duplicates(db)
    return {"ok": True, "removed": removed}


@router.get("/events")
def list_pump_events(
    date: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    q = db.query(PumpLogEvent)
    if ids:
        q = q.filter(PumpLogEvent.device_id.in_(ids))
    if date:
        start = datetime.strptime(date, "%Y-%m-%d")
        end = datetime.combine(start.date(), time(23, 59, 59, 999999))
        q = q.filter(PumpLogEvent.timestamp >= start, PumpLogEvent.timestamp <= end)
    rows = q.order_by(PumpLogEvent.timestamp.desc()).limit(limit).all()
    return {"events": [serialize_pump_event(r) for r in rows]}
