"""Injury cases and daily pain logs."""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import (
    Injury,
    InjuryPainLog,
    User,
)
from app.routers.health_data.common import (
    _require_date,
)
from app.schemas import (
    InjuryIn,
    InjuryPainLogIn,
    InjuryUpdate,
)
from app.services.injuries import (
    ACTIVITY_KINDS,
    BODY_AREAS,
    INJURY_STATUSES,
    INJURY_TYPES,
    serialize_injury,
    serialize_pain_log,
)
from app.services.reports import to_date_key

router = APIRouter()


def _default_injury_title(body: InjuryIn) -> str:
    type_label = body.injuryType.replace("_", " ").title()
    if body.bodyArea == "other" and body.bodyAreaOther:
        area = body.bodyAreaOther.strip()
    else:
        area = body.bodyArea.replace("_", " ")
    return f"{type_label} · {area}".strip(" ·")


@router.post("/injuries")
def create_injury(
    body: InjuryIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.startedOn)
    if body.injuryType not in INJURY_TYPES:
        raise HTTPException(status_code=400, detail="invalid injury type")
    if body.bodyArea not in BODY_AREAS:
        raise HTTPException(status_code=400, detail="invalid body area")
    if body.status not in INJURY_STATUSES:
        raise HTTPException(status_code=400, detail="invalid status")
    kinds = [k for k in (body.relatedActivityKinds or []) if k in ACTIVITY_KINDS]
    title = (body.title or "").strip() or _default_injury_title(body)
    row = Injury(
        id=str(uuid.uuid4()),
        device_id=device_id,
        title=title[:255],
        injury_type=body.injuryType,
        body_area=body.bodyArea,
        body_area_other=(body.bodyAreaOther or "").strip() or None,
        started_on=body.startedOn,
        status=body.status,
        healed_on=None,
        related_activity_kinds_json=json.dumps(kinds),
        exercise_notes=(body.exerciseNotes or "").strip() or None,
        notes=(body.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "injury": serialize_injury(row)}


@router.get("/injuries")
def list_injuries(
    status: str = Query("active"),
    limit: int = Query(50, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    if not ids:
        return {"injuries": []}
    q = db.query(Injury).filter(Injury.device_id.in_(ids))
    if status and status != "all":
        if status == "open":
            q = q.filter(Injury.status.in_(("active", "healing")))
        else:
            q = q.filter(Injury.status == status)
    rows = q.order_by(Injury.started_on.desc(), Injury.created_at.desc()).limit(limit).all()
    today = to_date_key(datetime.now())
    out = []
    for row in rows:
        latest = (
            db.query(InjuryPainLog)
            .filter(InjuryPainLog.injury_id == row.id)
            .order_by(InjuryPainLog.date.desc())
            .first()
        )
        today_pain = (
            db.query(InjuryPainLog)
            .filter(InjuryPainLog.injury_id == row.id, InjuryPainLog.date == today)
            .first()
        )
        recent = (
            db.query(InjuryPainLog)
            .filter(InjuryPainLog.injury_id == row.id)
            .order_by(InjuryPainLog.date.desc())
            .limit(7)
            .all()
        )
        out.append(
            serialize_injury(
                row,
                latest_pain=latest,
                today_pain=today_pain,
                include_recent_pain=list(reversed(recent)),
            )
        )
    return {"injuries": out}


@router.patch("/injuries/{injury_id}")
def update_injury(
    injury_id: str,
    body: InjuryUpdate,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db, user)
    row = db.query(Injury).filter(Injury.id == injury_id, Injury.device_id.in_(ids)).first()
    if not row:
        raise HTTPException(status_code=404, detail="injury not found")

    if body.title is not None:
        row.title = body.title.strip()[:255] or row.title
    if body.injuryType is not None:
        if body.injuryType not in INJURY_TYPES:
            raise HTTPException(status_code=400, detail="invalid injury type")
        row.injury_type = body.injuryType
    if body.bodyArea is not None:
        if body.bodyArea not in BODY_AREAS:
            raise HTTPException(status_code=400, detail="invalid body area")
        row.body_area = body.bodyArea
    if body.bodyAreaOther is not None:
        row.body_area_other = body.bodyAreaOther.strip() or None
    if body.startedOn is not None:
        _require_date(body.startedOn)
        row.started_on = body.startedOn
    if body.status is not None:
        if body.status not in INJURY_STATUSES:
            raise HTTPException(status_code=400, detail="invalid status")
        row.status = body.status
        if body.status == "healed" and not row.healed_on:
            row.healed_on = body.healedOn or to_date_key(datetime.now())
        if body.status != "healed":
            row.healed_on = body.healedOn
    if body.healedOn is not None:
        if body.healedOn:
            _require_date(body.healedOn)
        row.healed_on = body.healedOn or None
    if body.relatedActivityKinds is not None:
        kinds = [k for k in body.relatedActivityKinds if k in ACTIVITY_KINDS]
        row.related_activity_kinds_json = json.dumps(kinds)
    if body.exerciseNotes is not None:
        row.exercise_notes = body.exerciseNotes.strip() or None
    if body.notes is not None:
        row.notes = body.notes.strip() or None

    db.commit()
    db.refresh(row)
    return {"ok": True, "injury": serialize_injury(row)}


@router.delete("/injuries/{injury_id}")
def delete_injury(
    injury_id: str,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    ids = household_device_ids(db, user)
    row = db.query(Injury).filter(Injury.id == injury_id, Injury.device_id.in_(ids)).first()
    if not row:
        raise HTTPException(status_code=404, detail="injury not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/injuries/{injury_id}/pain")
def upsert_injury_pain(
    injury_id: str,
    body: InjuryPainLogIn,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    _require_date(body.date)
    ids = household_device_ids(db, user)
    injury = db.query(Injury).filter(Injury.id == injury_id, Injury.device_id.in_(ids)).first()
    if not injury:
        raise HTTPException(status_code=404, detail="injury not found")
    kind = body.relatedActivityKind
    if kind is not None and kind not in ACTIVITY_KINDS:
        raise HTTPException(status_code=400, detail="invalid activity kind")

    row = (
        db.query(InjuryPainLog)
        .filter(InjuryPainLog.injury_id == injury_id, InjuryPainLog.date == body.date)
        .first()
    )
    if row:
        row.pain_score = body.painScore
        row.related_activity_kind = kind
        row.notes = (body.notes or "").strip() or None
    else:
        row = InjuryPainLog(
            id=str(uuid.uuid4()),
            injury_id=injury_id,
            device_id=device_id,
            date=body.date,
            pain_score=body.painScore,
            related_activity_kind=kind,
            notes=(body.notes or "").strip() or None,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "painLog": serialize_pain_log(row), "injury": serialize_injury(injury, today_pain=row)}


@router.get("/injuries/{injury_id}/pain")
def list_injury_pain(
    injury_id: str,
    limit: int = Query(60, le=365),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    injury = db.query(Injury).filter(Injury.id == injury_id, Injury.device_id.in_(ids)).first()
    if not injury:
        raise HTTPException(status_code=404, detail="injury not found")
    rows = (
        db.query(InjuryPainLog)
        .filter(InjuryPainLog.injury_id == injury_id)
        .order_by(InjuryPainLog.date.desc())
        .limit(limit)
        .all()
    )
    return {"painLogs": [serialize_pain_log(r) for r in rows]}


@router.get("/injury-pain")
def list_injury_pain_for_day(
    date: str | None = Query(None),
    limit: int = Query(100, le=500),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db, user)
    if not ids:
        return {"painLogs": []}
    day = date or to_date_key(datetime.now())
    if date:
        _require_date(date)
    rows = (
        db.query(InjuryPainLog)
        .filter(InjuryPainLog.device_id.in_(ids), InjuryPainLog.date == day)
        .order_by(InjuryPainLog.created_at.asc())
        .limit(limit)
        .all()
    )
    return {"painLogs": [serialize_pain_log(r) for r in rows], "date": day}
