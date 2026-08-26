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
    locale = getattr(row, "locale", None) or "en"
    if locale not in ("en", "fr"):
        locale = "en"
    out: dict[str, Any] = {
        "id": row.id,
        "date": row.date,
        "headline": row.headline or "",
        "source": row.source or "fallback",
        "locale": locale,
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


def upsert_day_debrief(
    db: Session,
    daily: dict[str, Any],
    ai: dict[str, Any],
    *,
    locale: str | None = None,
) -> DayDebrief:
    """Create or refresh the archived debrief for daily['date'].

    Callers should pass the English narrative for the primary archive when
    possible — English is the canonical archive language. Structured facts
    stay numeric / language-agnostic.
    """
    day = str(daily.get("date") or "").strip()
    if not day or len(day) != 10:
        raise ValueError("daily.date (YYYY-MM-DD) required to archive debrief")

    agent_prompt = (daily.get("agentPrompt") or "").strip()
    facts = compact_report(daily)
    loc = (locale or ai.get("locale") or "en").strip().lower()[:2]
    if loc not in ("en", "fr"):
        loc = "en"
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
    row.locale = loc
    row.agent_prompt = agent_prompt
    row.facts_json = json.dumps(facts, ensure_ascii=False)

    db.commit()
    db.refresh(row)
    return row


def archive_daily_debrief(
    db: Session,
    daily: dict[str, Any],
    *,
    display_locale: str | None = "en",
    display_ai: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], DayDebrief]:
    """Build display-language AI for PDF/email, archive English narrative.

    Returns (display_ai, debrief_row).
    """
    from app.services.gemini_insights import generate_daily_ai_insights

    loc = (display_locale or "en").strip().lower()[:2]
    if loc not in ("en", "fr"):
        loc = "en"

    ai_display = display_ai or generate_daily_ai_insights(daily, locale=loc)
    if loc == "en":
        row = upsert_day_debrief(db, daily, ai_display, locale="en")
        return ai_display, row

    # French (or other) for the deliverable; English for the archive.
    ai_en = generate_daily_ai_insights(daily, locale="en")
    row = upsert_day_debrief(db, daily, ai_en, locale="en")
    try:
        facts_obj = json.loads(row.facts_json or "{}")
    except json.JSONDecodeError:
        facts_obj = {}
    facts_obj["frNarrative"] = {
        "headline": ai_display.get("headline"),
        "summary": ai_display.get("summary"),
        "highlights": ai_display.get("highlights") or [],
        "watchouts": ai_display.get("watchouts") or [],
        "tomorrowTips": ai_display.get("tomorrowTips") or [],
        "source": ai_display.get("source"),
    }
    row.facts_json = json.dumps(facts_obj, ensure_ascii=False)
    db.commit()
    db.refresh(row)
    return ai_display, row


def refresh_debrief_facts(db: Session, daily: dict[str, Any]) -> DayDebrief | None:
    """Refresh structured facts on an existing debrief without regenerating AI narrative."""
    day = str(daily.get("date") or "").strip()
    if not day or len(day) != 10:
        return None
    row = db.query(DayDebrief).filter(DayDebrief.date == day).first()
    if row is None:
        return None
    facts = compact_report(daily)
    try:
        existing = json.loads(row.facts_json or "{}")
    except json.JSONDecodeError:
        existing = {}
    fr = existing.get("frNarrative")
    if fr:
        facts["frNarrative"] = fr
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
