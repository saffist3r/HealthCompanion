from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import DayDebrief
from app.services.gemini_insights import compact_report


def _dumps(value: Any) -> str:
    return json.dumps(value if value is not None else [], ensure_ascii=False)


def serialize_day_debrief(row: DayDebrief, *, full: bool = True) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": row.id,
        "date": row.date,
        "headline": row.headline or "",
        "source": row.source or "fallback",
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
        "updatedAt": int(row.updated_at.timestamp() * 1000) if row.updated_at else None,
    }
    if not full:
        return out

    def _loads_list(raw: str | None) -> list[Any]:
        try:
            data = json.loads(raw or "[]")
            return data if isinstance(data, list) else []
        except json.JSONDecodeError:
            return []

    def _loads_obj(raw: str | None) -> dict[str, Any]:
        try:
            data = json.loads(raw or "{}")
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}

    out.update(
        {
            "summary": row.summary or "",
            "highlights": _loads_list(row.highlights_json),
            "watchouts": _loads_list(row.watchouts_json),
            "tomorrowTips": _loads_list(row.tomorrow_tips_json),
            "agentPrompt": row.agent_prompt or "",
            "facts": _loads_obj(row.facts_json),
        }
    )
    return out


def upsert_day_debrief(db: Session, daily: dict[str, Any], ai: dict[str, Any]) -> DayDebrief:
    """Create or refresh the archived debrief for daily['date']."""
    day = str(daily.get("date") or "").strip()
    if not day or len(day) != 10:
        raise ValueError("daily.date (YYYY-MM-DD) required to archive debrief")

    agent_prompt = (daily.get("agentPrompt") or "").strip()
    facts = compact_report(daily)
    headline = str(ai.get("headline") or "").strip() or f"Day overview · {day}"
    summary = str(ai.get("summary") or "").strip()
    source = str(ai.get("source") or "fallback").strip() or "fallback"

    row = db.query(DayDebrief).filter(DayDebrief.date == day).first()
    if row is None:
        row = DayDebrief(id=str(uuid.uuid4()), date=day)
        db.add(row)

    row.headline = headline[:512]
    row.summary = summary
    row.highlights_json = _dumps(ai.get("highlights") or [])
    row.watchouts_json = _dumps(ai.get("watchouts") or [])
    row.tomorrow_tips_json = _dumps(ai.get("tomorrowTips") or [])
    row.source = source[:32]
    row.agent_prompt = agent_prompt
    row.facts_json = json.dumps(facts, ensure_ascii=False)

    db.commit()
    db.refresh(row)
    return row


def list_day_debriefs(db: Session, *, limit: int = 30) -> list[DayDebrief]:
    return (
        db.query(DayDebrief)
        .order_by(DayDebrief.date.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )


def get_day_debrief(db: Session, date: str) -> DayDebrief | None:
    return db.query(DayDebrief).filter(DayDebrief.date == date).first()
