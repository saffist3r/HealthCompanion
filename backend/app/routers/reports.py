from __future__ import annotations

import logging
from datetime import datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import household_device_ids, require_user
from app.i18n import household_locale
from app.models import (
    ActivityDay,
    CaffeineLog,
    CareVisit,
    DayCheckIn,
    GlucoseSample,
    Injury,
    InjuryPainLog,
    Meal,
    PumpLogEvent,
    SportMatch,
    StressLog,
    User,
    WorkoutPlan,
)
from app.routers.meals import serialize_meal
from app.services.daily_report_mail import send_daily_report_email
from app.services.day_debriefs import (
    archive_daily_debrief,
    get_day_debrief,
    list_day_debriefs,
    serialize_day_debrief,
)
from app.services.email_smtp import smtp_configured
from app.services.gemini_life_assessment import generate_life_assessment
from app.services.life_assessment import build_life_assessment_context, rolling_date_keys
from app.services.rag_export import build_rag_archive_json, build_rag_archive_zip
from app.services.report_pdf import build_daily_pdf
from app.services.report_share import (
    build_qr_png,
    get_or_create_share,
    get_valid_share,
    serialize_share,
    share_page_url,
)
from app.services.reports import (
    build_daily_report,
    build_weekly_report,
    list_date_keys,
    monday_of,
    to_date_key,
)
from app.services.workouts import serialize_workout_plan

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reports"])


def _pick_activity(rows: list[ActivityDay]) -> ActivityDay | None:
    if not rows:
        return None
    # Prefer the richest row (steps), then fill Energy Score from any sibling row.
    best = max(rows, key=lambda r: (r.steps or 0, r.calories_burned or 0, r.energy_score or 0))
    if best.energy_score is None:
        for row in rows:
            if row.energy_score is not None:
                best.energy_score = row.energy_score
                break
    return best


def _load_daily(db: Session, device_ids: list[str], date: str) -> dict:
    from app.services.body_profile import (
        compute_targets_for_day,
        household_glucose_targets,
        latest_weight,
        serialize_weight,
    )

    targets = compute_targets_for_day(db, date)
    glucose_targets = household_glucose_targets(db)
    weight_row = latest_weight(db, on_or_before=date)
    weight = serialize_weight(weight_row) if weight_row else None

    if not device_ids:
        return build_daily_report(
            date=date,
            meals=[],
            glucose=[],
            activity=None,
            care_visits=[],
            sport_matches=[],
            stress_logs=[],
            day_check_in=None,
            caffeine_logs=[],
            pump_events=[],
            injuries=[],
            calorie_targets=targets,
            weight=weight,
            glucose_targets=glucose_targets,
        )

    start = datetime.strptime(date, "%Y-%m-%d")
    end = datetime.combine(start.date(), time(23, 59, 59, 999999))
    meals = (
        db.query(Meal)
        .filter(Meal.device_id.in_(device_ids), Meal.eaten_at >= start, Meal.eaten_at <= end)
        .order_by(Meal.eaten_at.asc())
        .all()
    )
    glucose = (
        db.query(GlucoseSample)
        .filter(
            GlucoseSample.device_id.in_(device_ids),
            GlucoseSample.timestamp >= start,
            GlucoseSample.timestamp <= end,
        )
        .order_by(GlucoseSample.timestamp.asc())
        .all()
    )
    activity_rows = (
        db.query(ActivityDay)
        .filter(ActivityDay.device_id.in_(device_ids), ActivityDay.date == date)
        .all()
    )
    care_visits = (
        db.query(CareVisit)
        .filter(CareVisit.device_id.in_(device_ids), CareVisit.date == date)
        .order_by(CareVisit.created_at.asc())
        .all()
    )
    sport_matches = (
        db.query(SportMatch)
        .filter(SportMatch.device_id.in_(device_ids), SportMatch.date == date)
        .order_by(SportMatch.created_at.asc())
        .all()
    )
    stress_logs = (
        db.query(StressLog)
        .filter(StressLog.device_id.in_(device_ids), StressLog.date == date)
        .order_by(StressLog.created_at.asc())
        .all()
    )
    day_check_in = (
        db.query(DayCheckIn)
        .filter(DayCheckIn.device_id.in_(device_ids), DayCheckIn.date == date)
        .order_by(DayCheckIn.updated_at.desc())
        .first()
    )
    caffeine_logs = (
        db.query(CaffeineLog)
        .filter(CaffeineLog.device_id.in_(device_ids), CaffeineLog.date == date)
        .order_by(CaffeineLog.created_at.asc())
        .all()
    )
    pump_events = (
        db.query(PumpLogEvent)
        .filter(
            PumpLogEvent.device_id.in_(device_ids),
            PumpLogEvent.timestamp >= start,
            PumpLogEvent.timestamp <= end,
        )
        .order_by(PumpLogEvent.timestamp.asc())
        .all()
    )
    from app.services.injuries import serialize_injury

    open_injuries = (
        db.query(Injury)
        .filter(
            Injury.device_id.in_(device_ids),
            Injury.status.in_(("active", "healing")),
        )
        .order_by(Injury.started_on.asc())
        .all()
    )
    # Also include healed injuries that still have a pain log today.
    pain_today = (
        db.query(InjuryPainLog)
        .filter(InjuryPainLog.device_id.in_(device_ids), InjuryPainLog.date == date)
        .all()
    )
    pain_by_injury = {p.injury_id: p for p in pain_today}
    injury_ids = {i.id for i in open_injuries} | set(pain_by_injury.keys())
    if injury_ids - {i.id for i in open_injuries}:
        extra = (
            db.query(Injury)
            .filter(Injury.id.in_(injury_ids - {i.id for i in open_injuries}))
            .all()
        )
        open_injuries = list(open_injuries) + list(extra)

    injury_dicts = []
    for inj in open_injuries:
        today_p = pain_by_injury.get(inj.id)
        latest = (
            db.query(InjuryPainLog)
            .filter(InjuryPainLog.injury_id == inj.id)
            .order_by(InjuryPainLog.date.desc())
            .first()
        )
        injury_dicts.append(
            serialize_injury(inj, latest_pain=latest, today_pain=today_p)
        )

    day_start = datetime.strptime(date, "%Y-%m-%d")
    day_end = datetime.combine(day_start.date(), time(23, 59, 59, 999999))
    workout_rows = (
        db.query(WorkoutPlan)
        .filter(
            WorkoutPlan.device_id.in_(device_ids),
            WorkoutPlan.created_at >= day_start,
            WorkoutPlan.created_at <= day_end,
        )
        .order_by(WorkoutPlan.created_at.desc())
        .all()
    )
    workout_plans = [serialize_workout_plan(w) for w in workout_rows]

    return build_daily_report(
        date=date,
        meals=meals,
        glucose=glucose,
        activity=_pick_activity(activity_rows),
        care_visits=care_visits,
        sport_matches=sport_matches,
        stress_logs=stress_logs,
        day_check_in=day_check_in,
        caffeine_logs=caffeine_logs,
        pump_events=pump_events,
        injuries=injury_dicts,
        workout_plans=workout_plans,
        calorie_targets=targets,
        weight=weight,
        glucose_targets=glucose_targets,
    )


@router.get("/daily")
def daily_report(
    date: str | None = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    day = date or to_date_key(datetime.now())
    return _load_daily(db, household_device_ids(db, user), day)


@router.post("/daily/voice")
async def daily_report_voice(
    date: str | None = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Tunisian Darija Gemini voice briefing (Reb3i → Saff; script + TTS)."""
    import asyncio

    from app.core.config import get_settings
    from app.services.gemini_voice_report import generate_daily_voice_briefing

    if not get_settings().gemini_configured:
        raise HTTPException(status_code=503, detail="Gemini is not configured on the server")

    day = date or to_date_key(datetime.now())
    if len(day) != 10:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    daily = _load_daily(db, household_device_ids(db, user), day)
    try:
        # Gemini + TTS are sync; keep the event loop free for /health probes.
        return await asyncio.to_thread(generate_daily_voice_briefing, daily)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Voice briefing failed")
        raise HTTPException(status_code=502, detail=f"Voice briefing failed: {exc}") from exc


@router.post("/daily/voice-video")
async def daily_report_voice_video(
    date: str | None = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Reb3i talking video: stock still (Ken Burns + audio pulse) + Darija TTS."""
    import asyncio

    from app.core.config import get_settings
    from app.services.gemini_voice_video import generate_daily_voice_video

    if not get_settings().gemini_configured:
        raise HTTPException(status_code=503, detail="Gemini is not configured on the server")

    day = date or to_date_key(datetime.now())
    if len(day) != 10:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    daily = _load_daily(db, household_device_ids(db, user), day)
    try:
        return await asyncio.to_thread(generate_daily_voice_video, daily)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Voice video failed")
        raise HTTPException(status_code=502, detail=f"Voice video failed: {exc}") from exc


@router.get("/daily/pdf")
def daily_report_pdf(
    date: str | None = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> Response:
    """Downloadable PDF with Gemini AI insights for the selected day."""
    day = date or to_date_key(datetime.now())
    locale = household_locale(db)
    daily = _load_daily(db, household_device_ids(db, user), day)
    ai, _ = archive_daily_debrief(db, daily, display_locale=locale)
    share = get_or_create_share(db, date=day, user_id=user.id)
    pdf = build_daily_pdf(
        daily=daily, ai=ai, share_url=share_page_url(share.token), locale=locale
    )
    filename = f"health-companion-{day}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/daily/share")
def daily_report_share(
    date: str | None = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Create or refresh a public share link + QR for the daily report."""
    day = date or to_date_key(datetime.now())
    share = get_or_create_share(db, date=day, user_id=user.id)
    return serialize_share(share)


@router.get("/share/{token}")
def shared_report_meta(token: str, db: Session = Depends(get_db)) -> dict:
    """Public metadata for a shared daily report (no auth)."""
    share = get_valid_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found or expired")
    return serialize_share(share)


@router.get("/share/{token}/pdf")
def shared_report_pdf(token: str, db: Session = Depends(get_db)) -> Response:
    """Public PDF download for a shared daily report (no auth)."""
    share = get_valid_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found or expired")
    locale = household_locale(db)
    creator = db.get(User, share.created_by_user_id) if share.created_by_user_id else None
    daily = _load_daily(db, household_device_ids(db, creator), share.date)
    ai, _ = archive_daily_debrief(db, daily, display_locale=locale)
    pdf = build_daily_pdf(
        daily=daily, ai=ai, share_url=share_page_url(share.token), locale=locale
    )
    filename = f"health-companion-{share.date}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "private, max-age=300",
        },
    )


@router.get("/share/{token}/qr.png")
def shared_report_qr(token: str, db: Session = Depends(get_db)) -> Response:
    """PNG QR code pointing at the public share page."""
    share = get_valid_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found or expired")
    png = build_qr_png(share_page_url(share.token))
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/daily/email")
def daily_report_email(
    date: str | None = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Email today's (or selected day's) AI PDF report to REPORT_EMAIL_TO."""
    if not smtp_configured():
        raise HTTPException(status_code=503, detail="SMTP is not configured on the server")
    try:
        return send_daily_report_email(db, date=date)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Daily report email failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/debriefs")
def list_debriefs(
    limit: int = Query(30, ge=1, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """List archived day debriefs (newest first)."""
    rows = list_day_debriefs(db, limit=limit)
    return {"debriefs": [serialize_day_debrief(r, full=False) for r in rows]}


@router.get("/debriefs/{date}")
def get_debrief(
    date: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Full archived debrief for a calendar date."""
    if not date or len(date) != 10:
        raise HTTPException(status_code=400, detail="date (YYYY-MM-DD) required")
    row = get_day_debrief(db, date)
    if not row:
        raise HTTPException(status_code=404, detail="No debrief archived for this date")
    return serialize_day_debrief(row, full=True)


@router.get("/rag-archive")
def rag_archive(
    limit: int = Query(30, ge=1, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Unified RAG archive: daily debrief facts + saved workout plans."""
    ids = household_device_ids(db, user)
    debrief_rows = list_day_debriefs(db, limit=limit)
    debriefs = [serialize_day_debrief(r, full=False) for r in debrief_rows]
    workout_plans: list[dict] = []
    if ids:
        rows = (
            db.query(WorkoutPlan)
            .filter(WorkoutPlan.device_id.in_(ids))
            .order_by(WorkoutPlan.created_at.desc())
            .limit(limit)
            .all()
        )
        workout_plans = [serialize_workout_plan(r) for r in rows]
    return {"debriefs": debriefs, "workoutPlans": workout_plans}


@router.get("/rag-archive/export")
def export_rag_archive(
    limit: int = Query(200, ge=1, le=200),
    format: Literal["json", "zip"] = Query("zip"),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> Response:
    """Bulk download: JSON (RAG) or ZIP (JSON + all archived PDFs)."""
    ids = household_device_ids(db, user)
    rows = list_day_debriefs(db, limit=limit)
    if not rows:
        raise HTTPException(status_code=404, detail="No archived debriefs to export")

    stamp = datetime.now().strftime("%Y-%m-%d")
    if format == "json":
        body = build_rag_archive_json(db, device_ids=ids, limit=limit)
        filename = f"health-companion-rag-archive-{stamp}.json"
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    locale = household_locale(db)
    body = build_rag_archive_zip(
        db,
        device_ids=ids,
        limit=limit,
        locale=locale,
        load_daily=_load_daily,
    )
    filename = f"health-companion-rag-archive-{stamp}.zip"
    return Response(
        content=body,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/life-assessment")
def life_assessment(
    days: int = Query(7, ge=3, le=14),
    end: str | None = Query(None, description="Last day of window (YYYY-MM-DD), default today"),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Honest AI review of the last N days of tracked health & lifestyle data."""
    if end and (len(end) != 10):
        raise HTTPException(status_code=400, detail="end must be YYYY-MM-DD")
    period_start, period_end, keys = rolling_date_keys(end_date=end, days=days)
    ids = household_device_ids(db, user)
    daily_days = [_load_daily(db, ids, d) for d in keys]
    context = build_life_assessment_context(daily_days)
    locale = household_locale(db)
    ai = generate_life_assessment(context, locale=locale)
    return {
        "periodStart": period_start,
        "periodEnd": period_end,
        "dayCount": len(keys),
        "totals": context.get("totals"),
        "generatedAt": int(datetime.now().timestamp() * 1000),
        **ai,
    }


@router.get("/weekly")
def weekly_report(
    date: str | None = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    anchor = date or to_date_key(datetime.now())
    week_start = monday_of(anchor)
    end = datetime.strptime(week_start, "%Y-%m-%d") + timedelta(days=6)
    week_end = end.strftime("%Y-%m-%d")
    ids = household_device_ids(db, user)
    days = [_load_daily(db, ids, d) for d in list_date_keys(week_start, week_end)]
    return build_weekly_report(week_start=week_start, week_end=week_end, days=days)


@router.get("/dashboard")
def dashboard(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Aggregated household view for the React web dashboard."""
    ids = household_device_ids(db, user)
    today = to_date_key(datetime.now())
    daily = _load_daily(db, ids, today)
    week_start = monday_of(today)
    end = datetime.strptime(week_start, "%Y-%m-%d") + timedelta(days=6)
    week_end = end.strftime("%Y-%m-%d")
    days = [_load_daily(db, ids, d) for d in list_date_keys(week_start, week_end)]
    weekly = build_weekly_report(week_start=week_start, week_end=week_end, days=days)

    recent_q = db.query(Meal)
    if ids:
        recent_q = recent_q.filter(Meal.device_id.in_(ids))
    recent = recent_q.order_by(Meal.eaten_at.desc()).limit(8).all()

    nutrition = daily["nutrition"]["macros"]
    activity = daily.get("activity") or {}
    glucose = daily["glucose"]
    today_workouts = activity.get("workouts") or [] if activity else []
    today_workout_min = sum(
        int(w.get("durationMin") or 0) for w in today_workouts if isinstance(w, dict)
    )
    today_care = daily.get("careVisits") or []
    today_matches = daily.get("sportMatches") or []
    today_stress = daily.get("stressLogs") or []
    today_check_in = daily.get("dayCheckIn")
    today_caffeine = daily.get("caffeineLogs") or []
    today_injuries = daily.get("injuries") or []
    today_pump = daily.get("pumpEvents") or []
    today_insulin = round(
        sum(float(p.get("units") or 0) for p in today_pump if p.get("kind") == "insulin_delivered"),
        2,
    )
    today_caffeine_mg = sum(int(c.get("caffeineMg") or 0) for c in today_caffeine)

    from app.models import BodyProfile
    from app.services.diabetes_insights import (
        device_care_payload,
        episode_context,
        meal_log_streak,
    )

    profile = db.query(BodyProfile).filter(BodyProfile.id == "default").first()
    hypo_events = list(glucose.get("hypoEvents") or [])
    hyper_events = list(glucose.get("hyperEvents") or [])
    for ev in (hypo_events + hyper_events)[:8]:
        try:
            ev["context"] = episode_context(
                db,
                device_ids=ids,
                started_at_ms=int(ev["startedAt"]),
                ended_at_ms=int(ev["endedAt"]),
            )
        except Exception:
            logger.warning("Episode context failed for event at %s", ev.get("startedAt"), exc_info=True)
            ev["context"] = None

    return {
        "deviceIds": ids,
        "mealCount": nutrition and daily["nutrition"]["mealCount"],
        "todayCarbsG": nutrition.get("carbsG", 0),
        "todayProteinG": nutrition.get("proteinG", 0),
        "todayFatG": nutrition.get("fatG", 0),
        "todayCaloriesKcal": nutrition.get("caloriesKcal", 0),
        "calorieTargets": daily.get("calorieTargets"),
        "calorieBalance": daily.get("calorieBalance"),
        "weight": daily.get("weight"),
        "todaySteps": activity.get("steps", 0) if activity else 0,
        "todayActiveMinutes": activity.get("activeMinutes") if activity else None,
        "todayCaloriesBurned": activity.get("caloriesBurned") if activity else None,
        "todayEnergyScore": activity.get("energyScore") if activity else None,
        "todayActivitySource": activity.get("source") if activity else None,
        "todayActivitySyncedAt": activity.get("syncedAt") if activity else None,
        "todayWorkouts": today_workouts,
        "todayWorkoutMinutes": today_workout_min,
        "todayCareVisits": today_care,
        "todaySportMatches": today_matches,
        "todayStressLogs": today_stress,
        "todayDayCheckIn": today_check_in,
        "todayCaffeineLogs": today_caffeine,
        "todayCaffeineMg": today_caffeine_mg,
        "todayInjuries": today_injuries,
        "todayPumpEvents": today_pump,
        "todayInsulinDeliveredU": today_insulin,
        "todayPumpEventCount": len(today_pump),
        "glucoseAvgMgDl": glucose.get("avgMgDl"),
        "timeInRangePct": glucose.get("timeInRangePct"),
        "glucoseTargets": daily.get("glucoseTargets"),
        "todayHypoEventCount": glucose.get("hypoEventCount") or 0,
        "todayHypoEvents": hypo_events,
        "todayHyperEventCount": glucose.get("hyperEventCount") or 0,
        "todayHyperEvents": hyper_events,
        "overnight": daily.get("overnight"),
        "mealLogStreak": meal_log_streak(db, ids),
        "deviceCare": device_care_payload(profile),
        "plotTwists": weekly.get("plotTwists") or [],
        "directorsCut": weekly.get("directorsCut"),
        "recentMeals": [serialize_meal(m).model_dump() for m in recent],
        "dailyReport": daily,
        "weeklyReport": weekly,
        "sports": {
            "todaySteps": activity.get("steps", 0) if activity else 0,
            "todayEnergyScore": activity.get("energyScore") if activity else None,
            "todayActivitySource": activity.get("source") if activity else None,
            "todayActivitySyncedAt": activity.get("syncedAt") if activity else None,
            "todayWorkoutMinutes": today_workout_min,
            "todayWorkoutCount": len(today_workouts),
            "todayCaloriesBurned": activity.get("caloriesBurned") if activity else None,
            "weekSteps": weekly["totals"].get("totalSteps", 0),
            "weekWorkoutMinutes": weekly["totals"].get("workoutMinutes", 0),
            "weekWorkoutCount": weekly["totals"].get("workoutCount", 0),
            "weekActiveCalories": weekly["totals"].get("activeCalories", 0),
            "recentWorkouts": weekly.get("workouts") or [],
            "careVisits": weekly.get("careVisits") or [],
            "sportMatches": weekly.get("sportMatches") or [],
            "stressLogs": weekly.get("stressLogs") or [],
            "padelWins": weekly["totals"].get("padelWins", 0),
            "padelLosses": weekly["totals"].get("padelLosses", 0),
            "stressLogCount": weekly["totals"].get("stressLogCount", 0),
            "stressHighCount": weekly["totals"].get("stressHighCount", 0),
        },
    }
