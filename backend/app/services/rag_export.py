from __future__ import annotations

import io
import json
import logging
import zipfile
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models import DayDebrief, WorkoutPlan
from app.services.day_debriefs import list_day_debriefs, serialize_day_debrief
from app.services.report_pdf import build_daily_pdf
from app.services.workouts import serialize_workout_plan

logger = logging.getLogger(__name__)

def _debrief_ai(row: DayDebrief) -> dict[str, Any]:
    detail = serialize_day_debrief(row, full=True)
    return {
        "headline": detail.get("headline") or "",
        "summary": detail.get("summary") or "",
        "highlights": detail.get("highlights") or [],
        "watchouts": detail.get("watchouts") or [],
        "tomorrowTips": detail.get("tomorrowTips") or [],
        "source": detail.get("source") or "fallback",
        "locale": detail.get("locale") or "en",
    }


def build_rag_archive_payload(
    db: Session,
    *,
    device_ids: list[str],
    limit: int = 200,
) -> dict[str, Any]:
    debrief_rows = list_day_debriefs(db, limit=limit)
    debriefs = [serialize_day_debrief(r, full=True) for r in debrief_rows]
    workout_plans: list[dict[str, Any]] = []
    if device_ids:
        rows = (
            db.query(WorkoutPlan)
            .filter(WorkoutPlan.device_id.in_(device_ids))
            .order_by(WorkoutPlan.created_at.desc())
            .limit(limit)
            .all()
        )
        workout_plans = [serialize_workout_plan(r) for r in rows]
    return {
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "debriefCount": len(debriefs),
        "workoutPlanCount": len(workout_plans),
        "debriefs": debriefs,
        "workoutPlans": workout_plans,
    }


def build_rag_archive_json(
    db: Session,
    *,
    device_ids: list[str],
    limit: int = 200,
) -> bytes:
    payload = build_rag_archive_payload(db, device_ids=device_ids, limit=limit)
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def build_rag_archive_zip(
    db: Session,
    *,
    device_ids: list[str],
    limit: int = 200,
    locale: str = "en",
    load_daily,
) -> bytes:
    """ZIP with rag-archive.json plus one PDF per archived day (no Gemini calls)."""
    payload = build_rag_archive_payload(db, device_ids=device_ids, limit=limit)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "rag-archive.json",
            json.dumps(payload, ensure_ascii=False, indent=2),
        )
        debrief_rows = list_day_debriefs(db, limit=limit)
        for row in debrief_rows:
            day = row.date
            if not day:
                continue
            try:
                daily = load_daily(db, device_ids, day)
                ai = _debrief_ai(row)
                pdf = build_daily_pdf(daily=daily, ai=ai, share_url=None, locale=locale)
                zf.writestr(f"pdfs/health-companion-{day}.pdf", pdf)
            except Exception:
                logger.exception("RAG archive: skipping PDF for %s", day)
                continue
    return buf.getvalue()
