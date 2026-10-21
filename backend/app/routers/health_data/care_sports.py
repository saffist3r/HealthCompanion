"""Care visits (kiné, osteo, …) and sport matches."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import (
    CareVisit,
    SportMatch,
    User,
)
from app.routers.health_data.common import (
    CARE_KINDS,
    SPORT_RESULTS,
    _require_date,
    serialize_care_visit,
    serialize_sport_match,
)
from app.schemas import (
    CareVisitIn,
    SportMatchIn,
)

router = APIRouter()


@router.post("/care-visits")
def create_care_visit(
    body: CareVisitIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)
    if body.kind not in CARE_KINDS:
        raise HTTPException(status_code=400, detail="invalid care kind")

    row = CareVisit(
        id=str(uuid.uuid4()),
        device_id=device_id,
        date=body.date,
        time=body.time,
        kind=body.kind,
        label=(body.label or "").strip() or None,
        notes=(body.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "careVisit": serialize_care_visit(row)}


@router.get("/care-visits")
def list_care_visits(
    date: str | None = Query(None),
    limit: int = Query(50, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    if not ids:
        return {"careVisits": []}
    q = db.query(CareVisit).filter(CareVisit.device_id.in_(ids))
    if date:
        q = q.filter(CareVisit.date == date)
    rows = q.order_by(CareVisit.date.desc(), CareVisit.created_at.desc()).limit(limit).all()
    return {"careVisits": [serialize_care_visit(r) for r in rows]}


@router.delete("/care-visits/{visit_id}")
def delete_care_visit(
    visit_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db, user)
    row = (
        db.query(CareVisit)
        .filter(CareVisit.id == visit_id, CareVisit.device_id.in_(ids))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="care visit not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/sport-matches")
def create_sport_match(
    body: SportMatchIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)
    if body.result not in SPORT_RESULTS:
        raise HTTPException(status_code=400, detail="invalid result")

    sport_raw = (body.sport or "padel").strip() or "padel"
    known = {"padel", "gym", "running", "cycling", "swimming", "walking", "other"}
    sport = sport_raw.lower() if sport_raw.lower() in known else sport_raw[:64]

    row = SportMatch(
        id=str(uuid.uuid4()),
        device_id=device_id,
        date=body.date,
        time=body.time,
        sport=sport,
        result=body.result,
        score=(body.score or "").strip(),
        duration_min=body.durationMin,
        opponent=(body.opponent or "").strip() or None,
        intensity=(body.intensity or None),
        notes=(body.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "sportMatch": serialize_sport_match(row)}


@router.get("/sport-matches")
def list_sport_matches(
    date: str | None = Query(None),
    limit: int = Query(50, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    if not ids:
        return {"sportMatches": []}
    q = db.query(SportMatch).filter(SportMatch.device_id.in_(ids))
    if date:
        q = q.filter(SportMatch.date == date)
    rows = q.order_by(SportMatch.date.desc(), SportMatch.created_at.desc()).limit(limit).all()
    return {"sportMatches": [serialize_sport_match(r) for r in rows]}


@router.delete("/sport-matches/{match_id}")
def delete_sport_match(
    match_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db, user)
    row = (
        db.query(SportMatch)
        .filter(SportMatch.id == match_id, SportMatch.device_id.in_(ids))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="sport match not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
