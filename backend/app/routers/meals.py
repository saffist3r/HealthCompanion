from __future__ import annotations

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
from app.schemas import MealAnalysisResult, MealCreate, MealOut, MealUpdate, Macros
from app.services.gemini_meal import analyze_meal_photo
from app.services.reports import to_date_key
from app.services.warnings import evaluate_meal_warnings, resolved_calories_kcal

router = APIRouter(prefix="/meals", tags=["meals"])


def _http_exc_from_gemini(exc: Exception) -> HTTPException:
    msg = str(exc)
    lower = msg.lower()
    if "429" in msg or "resource_exhausted" in lower or "quota" in lower:
        return HTTPException(
            status_code=429,
            detail="Gemini quota exceeded. Try again in a minute, or enable billing / switch models in AI Studio.",
        )
    if "api key" in lower or "not configured" in lower:
        return HTTPException(status_code=503, detail=msg)
    return HTTPException(status_code=500, detail=msg)


def _upload_dir() -> Path:
    path = Path(get_settings().upload_dir).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def serialize_meal(meal: Meal) -> MealOut:
    try:
        raw_macros = json.loads(meal.macros_json or "{}")
    except json.JSONDecodeError:
        raw_macros = {}
    macros = Macros.model_validate(raw_macros)
    macros.caloriesKcal = resolved_calories_kcal(macros)
    return MealOut(
        id=meal.id,
        deviceId=meal.device_id,
        createdAt=int(meal.created_at.timestamp() * 1000) if meal.created_at else 0,
        eatenAt=int(meal.eaten_at.timestamp() * 1000),
        mealType=meal.meal_type,
        photoUrl=f"/uploads/{meal.photo_path}" if meal.photo_path else None,
        items=json.loads(meal.items_json or "[]"),
        macros=macros,
        notes=meal.notes,
        aiSummary=meal.ai_summary,
        carbEstimateNote=meal.carb_estimate_note,
        warnings=json.loads(meal.warnings_json or "[]"),
        suggestions=json.loads(meal.suggestions_json or "[]"),
        source=meal.source,
        date=to_date_key(meal.eaten_at),
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

    try:
        analysis = analyze_meal_photo(
            image_bytes=data,
            mime_type=photo.content_type or "image/jpeg",
            glucose_mg_dl=glucoseMgDl,
            hour_local=hourLocal if hourLocal is not None else datetime.now().hour,
            notes=notes,
        )
    except Exception as exc:  # noqa: BLE001
        raise _http_exc_from_gemini(exc) from exc

    return {
        "analysis": analysis.model_dump(),
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
    meal = Meal(
        id=str(uuid.uuid4()),
        device_id=device_id,
        eaten_at=eaten_at,
        meal_type=body.mealType,
        photo_path=body.photoPath,
        items_json=json.dumps([i.model_dump() for i in body.items]),
        macros_json=macros.model_dump_json(),
        notes=body.notes,
        ai_summary=body.aiSummary,
        carb_estimate_note=body.carbEstimateNote,
        warnings_json=json.dumps([w.model_dump() for w in warnings]),
        suggestions_json=json.dumps(body.suggestions),
        source=body.source,
    )
    db.add(meal)
    db.commit()
    db.refresh(meal)
    return serialize_meal(meal)


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

    db.commit()
    db.refresh(meal)
    return serialize_meal(meal)


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
