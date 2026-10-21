from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, time
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import ensure_device, household_device_ids, require_device_id, require_user
from app.models import Meal, User
from app.schemas import MealAnalysisResult, MealCreate, MealOut, MealPhotoIn, MealPhotoOut, MealUpdate, Macros
from app.services.diabetes_insights import find_related_hypo, post_meal_story, similar_meals
from app.services.gemini_meal import analyze_meal_photo
from app.services.reports import to_date_key
from app.services.warnings import evaluate_meal_warnings, resolved_calories_kcal

router = APIRouter(prefix="/meals", tags=["meals"])

_ALLOWED_PHOTO_ROLES = {"main", "side", "dessert", "drink", "other"}
_MAX_MEAL_PHOTOS = 8


def _http_exc_from_gemini(exc: Exception) -> HTTPException:
    msg = str(exc)
    lower = msg.lower()
    if "429" in msg or "resource_exhausted" in lower or "quota" in lower:
        return HTTPException(
            status_code=429,
            detail="AI is rate-limited right now. Wait a minute and try again.",
        )
    if (
        "503" in msg
        or "unavailable" in lower
        or "high demand" in lower
        or "overloaded" in lower
        or "try again" in lower
    ):
        return HTTPException(
            status_code=503,
            detail="AI is busy right now. Wait a few seconds and try again.",
        )
    if "api key" in lower or "not configured" in lower:
        return HTTPException(status_code=503, detail=msg)
    return HTTPException(status_code=500, detail=msg)


def _upload_dir() -> Path:
    path = Path(get_settings().upload_dir).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _normalize_photo_role(role: str | None) -> str:
    r = (role or "other").strip().lower()
    return r if r in _ALLOWED_PHOTO_ROLES else "other"


def _photo_entries_from_body(
    photos: list[MealPhotoIn] | None,
    photo_path: str | None,
) -> list[dict]:
    """Build stored photo list; primary is role=main or the first entry."""
    entries: list[dict] = []
    seen: set[str] = set()
    for p in photos or []:
        path = (p.path or "").strip()
        if not path or path in seen:
            continue
        seen.add(path)
        label = (p.label or "").strip() or None
        entries.append(
            {
                "path": path,
                "role": _normalize_photo_role(p.role),
                "label": label,
            }
        )
        if len(entries) >= _MAX_MEAL_PHOTOS:
            break
    if photo_path:
        path = photo_path.strip()
        if path and path not in seen:
            entries.insert(0, {"path": path, "role": "main", "label": None})
            seen.add(path)
        elif path and entries and not any(e["role"] == "main" for e in entries):
            for e in entries:
                if e["path"] == path:
                    e["role"] = "main"
                    break
    if entries and not any(e["role"] == "main" for e in entries):
        entries[0]["role"] = "main"
    return entries[:_MAX_MEAL_PHOTOS]


def _primary_photo_path(entries: list[dict], fallback: str | None = None) -> str | None:
    for e in entries:
        if e.get("role") == "main" and e.get("path"):
            return str(e["path"])
    if entries and entries[0].get("path"):
        return str(entries[0]["path"])
    return fallback


def _serialize_photos(meal: Meal) -> list[MealPhotoOut]:
    entries: list[dict] = []
    try:
        raw = json.loads(getattr(meal, "photos_json", None) or "[]")
        if isinstance(raw, list):
            entries = [e for e in raw if isinstance(e, dict) and e.get("path")]
    except json.JSONDecodeError:
        entries = []
    if not entries and meal.photo_path:
        entries = [{"path": meal.photo_path, "role": "main", "label": None}]
    out: list[MealPhotoOut] = []
    for e in entries:
        path = str(e.get("path") or "").strip()
        if not path:
            continue
        out.append(
            MealPhotoOut(
                url=f"/uploads/{path}",
                path=path,
                role=_normalize_photo_role(e.get("role")),
                label=(str(e["label"]).strip() if e.get("label") else None),
            )
        )
    return out


def serialize_meal(
    meal: Meal,
    *,
    db: Session | None = None,
    device_ids: list[str] | None = None,
    include_story: bool = False,
    include_similar: bool = False,
) -> MealOut:
    try:
        raw_macros = json.loads(meal.macros_json or "{}")
    except json.JSONDecodeError:
        raw_macros = {}
    macros = Macros.model_validate(raw_macros)
    macros.caloriesKcal = resolved_calories_kcal(macros)
    story = None
    similar = []
    if db is not None and include_story:
        ids = device_ids if device_ids is not None else household_device_ids(db)
        story = post_meal_story(
            db, device_ids=ids, eaten_at_ms=int(meal.eaten_at.timestamp() * 1000)
        )
    if db is not None and include_similar:
        ids = device_ids if device_ids is not None else household_device_ids(db)
        similar = similar_meals(db, device_ids=ids, meal=meal)
    photos = _serialize_photos(meal)
    primary = meal.photo_path or (photos[0].path if photos else None)
    return MealOut(
        id=meal.id,
        deviceId=meal.device_id,
        createdAt=int(meal.created_at.timestamp() * 1000) if meal.created_at else 0,
        eatenAt=int(meal.eaten_at.timestamp() * 1000),
        mealType=meal.meal_type,
        photoUrl=f"/uploads/{primary}" if primary else None,
        photos=photos,
        items=json.loads(meal.items_json or "[]"),
        macros=macros,
        notes=meal.notes,
        aiSummary=meal.ai_summary,
        carbEstimateNote=meal.carb_estimate_note,
        warnings=json.loads(meal.warnings_json or "[]"),
        suggestions=json.loads(meal.suggestions_json or "[]"),
        source=meal.source,
        date=to_date_key(meal.eaten_at),
        wouldAgain=getattr(meal, "would_again", None),
        wouldAgainNote=getattr(meal, "would_again_note", None),
        relatedHypoStartedAt=getattr(meal, "related_hypo_started_at", None),
        glucoseStory=story,
        similarMeals=similar,
    )


@router.post("/analyze")
async def analyze(
    photo: UploadFile = File(...),
    notes: str | None = Form(None),
    glucoseMgDl: float | None = Form(None),
    hourLocal: int | None = Form(None),
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    ensure_device(db, device_id, owner_user_id=user.id)
    settings = get_settings()
    data = await photo.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(status_code=400, detail="Photo too large")

    ext = Path(photo.filename or "meal.jpg").suffix or ".jpg"
    filename = f"{int(datetime.now().timestamp() * 1000)}-{uuid.uuid4().hex[:8]}{ext}"
    dest = _upload_dir() / filename
    dest.write_bytes(data)

    hour = hourLocal if hourLocal is not None else datetime.now().hour
    try:
        # Gemini client is sync; run off the event loop so /health probes stay responsive.
        analysis = await asyncio.to_thread(
            analyze_meal_photo,
            image_bytes=data,
            mime_type=photo.content_type or "image/jpeg",
            glucose_mg_dl=glucoseMgDl,
            hour_local=hour,
            notes=notes,
        )
    except Exception as exc:  # noqa: BLE001
        raise _http_exc_from_gemini(exc) from exc

    return {
        "analysis": analysis.model_dump(),
        "photoPath": filename,
        "photoUrl": f"/uploads/{filename}",
    }


@router.post("/upload-photo")
async def upload_photo(
    photo: UploadFile = File(...),
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> dict:
    """Store an extra meal photo without running AI analysis."""
    ensure_device(db, device_id, owner_user_id=user.id)
    settings = get_settings()
    data = await photo.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(status_code=400, detail="Photo too large")
    if not data:
        raise HTTPException(status_code=400, detail="Empty photo")

    ext = Path(photo.filename or "meal.jpg").suffix or ".jpg"
    filename = f"{int(datetime.now().timestamp() * 1000)}-{uuid.uuid4().hex[:8]}{ext}"
    dest = _upload_dir() / filename
    dest.write_bytes(data)
    return {
        "photoPath": filename,
        "photoUrl": f"/uploads/{filename}",
    }


@router.post("", response_model=MealOut, status_code=201)
def create_meal(
    body: MealCreate,
    user: User = Depends(require_user),
    device_id: str = Depends(require_device_id),
    db: Session = Depends(get_db),
) -> MealOut:
    ensure_device(db, device_id, owner_user_id=user.id)
    eaten_at = body.eatenAt or datetime.now().astimezone()
    macros = body.macros.model_copy()
    macros.caloriesKcal = resolved_calories_kcal(macros)
    warnings = body.warnings or evaluate_meal_warnings(
        macros,
        hour_local=eaten_at.hour,
        glucose_mg_dl=body.glucoseMgDl,
        meal_type=body.mealType,
    )
    photo_entries = _photo_entries_from_body(body.photos, body.photoPath)
    primary = _primary_photo_path(photo_entries, body.photoPath)
    meal = Meal(
        id=str(uuid.uuid4()),
        device_id=device_id,
        eaten_at=eaten_at,
        meal_type=body.mealType,
        photo_path=primary,
        photos_json=json.dumps(photo_entries),
        items_json=json.dumps([i.model_dump() for i in body.items]),
        macros_json=macros.model_dump_json(),
        notes=body.notes,
        ai_summary=body.aiSummary,
        carb_estimate_note=body.carbEstimateNote,
        warnings_json=json.dumps([w.model_dump() for w in warnings]),
        suggestions_json=json.dumps(body.suggestions),
        source=body.source,
    )
    ids = household_device_ids(db)
    eaten_ms = int(eaten_at.timestamp() * 1000)
    if (body.mealType or "").lower() == "resucrage":
        hypo = find_related_hypo(db, ids, eaten_ms)
        if hypo:
            meal.related_hypo_started_at = int(hypo["startedAt"])
    db.add(meal)
    db.commit()
    db.refresh(meal)
    return serialize_meal(meal, db=db, device_ids=ids, include_story=True, include_similar=True)


@router.get("")
def list_meals(
    date: str | None = Query(None),
    limit: int = Query(50, le=200),
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
    q = db.query(Meal)
    if ids:
        q = q.filter(Meal.device_id.in_(ids))
    if date:
        start = datetime.strptime(date, "%Y-%m-%d")
        end = datetime.combine(start.date(), time(23, 59, 59, 999999))
        q = q.filter(Meal.eaten_at >= start, Meal.eaten_at <= end)
    meals = q.order_by(Meal.eaten_at.desc()).limit(limit).all()
    return {"meals": [serialize_meal(m) for m in meals]}


@router.get("/{meal_id}")
def get_meal(
    meal_id: str,
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
    q = db.query(Meal).filter(Meal.id == meal_id)
    if ids:
        q = q.filter(Meal.device_id.in_(ids))
    meal = q.first()
    if not meal:
        raise HTTPException(status_code=404, detail="not found")
    return {
        "meal": serialize_meal(
            meal, db=db, device_ids=ids, include_story=True, include_similar=True
        )
    }


@router.get("/{meal_id}/glucose-story")
def meal_glucose_story(
    meal_id: str,
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
    q = db.query(Meal).filter(Meal.id == meal_id)
    if ids:
        q = q.filter(Meal.device_id.in_(ids))
    meal = q.first()
    if not meal:
        raise HTTPException(status_code=404, detail="not found")
    story = post_meal_story(
        db, device_ids=ids, eaten_at_ms=int(meal.eaten_at.timestamp() * 1000)
    )
    similar = similar_meals(db, device_ids=ids, meal=meal)
    return {"story": story, "similarMeals": similar}


@router.patch("/{meal_id}", response_model=MealOut)
def update_meal(
    meal_id: str,
    body: MealUpdate,
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> MealOut:
    ids = household_device_ids(db)
    q = db.query(Meal).filter(Meal.id == meal_id)
    if ids:
        q = q.filter(Meal.device_id.in_(ids))
    meal = q.first()
    if not meal:
        raise HTTPException(status_code=404, detail="not found")

    if body.mealType is not None:
        meal_type = (body.mealType or "other").strip().lower() or "other"
        meal.meal_type = meal_type[:32]

    if body.notes is not None:
        meal.notes = body.notes.strip() or None

    if body.aiSummary is not None:
        meal.ai_summary = body.aiSummary.strip() or None

    if body.carbEstimateNote is not None:
        meal.carb_estimate_note = body.carbEstimateNote.strip() or None

    if body.eatenAt is not None:
        meal.eaten_at = body.eatenAt if body.eatenAt.tzinfo else body.eatenAt.astimezone()

    if body.wouldAgain is not None:
        meal.would_again = int(body.wouldAgain)
    if body.wouldAgainNote is not None:
        meal.would_again_note = body.wouldAgainNote.strip() or None

    if body.photos is not None or body.photoPath is not None:
        photo_entries = _photo_entries_from_body(body.photos, body.photoPath)
        meal.photos_json = json.dumps(photo_entries)
        meal.photo_path = _primary_photo_path(photo_entries, body.photoPath)

    macros_changed = False
    if body.macros is not None:
        macros = body.macros.model_copy()
        macros.caloriesKcal = resolved_calories_kcal(macros)
        meal.macros_json = macros.model_dump_json()
        macros_changed = True

    if macros_changed or body.mealType is not None or body.glucoseMgDl is not None:
        try:
            raw_macros = json.loads(meal.macros_json or "{}")
        except json.JSONDecodeError:
            raw_macros = {}
        macros = Macros.model_validate(raw_macros)
        macros.caloriesKcal = resolved_calories_kcal(macros)
        warnings = evaluate_meal_warnings(
            macros,
            hour_local=meal.eaten_at.hour if meal.eaten_at else datetime.now().hour,
            glucose_mg_dl=body.glucoseMgDl,
            meal_type=meal.meal_type,
        )
        meal.warnings_json = json.dumps([w.model_dump() for w in warnings])

    if (meal.meal_type or "").lower() == "resucrage" and meal.related_hypo_started_at is None:
        hypo = find_related_hypo(db, ids, int(meal.eaten_at.timestamp() * 1000))
        if hypo:
            meal.related_hypo_started_at = int(hypo["startedAt"])

    db.commit()
    db.refresh(meal)
    return serialize_meal(meal, db=db, device_ids=ids, include_story=True, include_similar=True)


@router.delete("/{meal_id}")
def delete_meal(
    meal_id: str,
    _: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    ids = household_device_ids(db)
    q = db.query(Meal).filter(Meal.id == meal_id)
    if ids:
        q = q.filter(Meal.device_id.in_(ids))
    meal = q.first()
    if not meal:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(meal)
    db.commit()
    return {"ok": True}
