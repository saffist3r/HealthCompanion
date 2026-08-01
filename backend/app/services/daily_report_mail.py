from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.services.email_smtp import send_email, smtp_configured
from app.services.gemini_insights import generate_daily_ai_insights
from app.services.report_pdf import build_daily_pdf
from app.services.reports import to_date_key

logger = logging.getLogger(__name__)

PARIS = ZoneInfo("Europe/Paris")


def default_morning_report_date(now: datetime | None = None) -> str:
    """Calendar day the morning email should cover: yesterday in Europe/Paris."""
    local = (now or datetime.now(tz=PARIS)).astimezone(PARIS)
    return to_date_key(local - timedelta(days=1))


def send_daily_report_email(db: Session, date: str | None = None) -> dict[str, Any]:
    """Build AI PDF for the day and email it to REPORT_EMAIL_TO.

    When date is omitted (cron), uses the previous calendar day in Europe/Paris
    so the 07:00 morning mail covers a completed day, not the day that just started.
    """
    # Lazy import avoids circular import with routers.reports
    from app.core.deps import household_device_ids
    from app.routers.reports import _load_daily

    if not smtp_configured():
        raise RuntimeError("SMTP is not configured")

    settings = get_settings()
    day = date or default_morning_report_date()
    daily = _load_daily(db, household_device_ids(db), day)
    ai = generate_daily_ai_insights(daily)
    from app.services.day_debriefs import upsert_day_debrief

    upsert_day_debrief(db, daily, ai)
    from app.services.report_share import get_or_create_share, share_page_url

    share = get_or_create_share(db, date=day)
    share_url = share_page_url(share.token)
    pdf = build_daily_pdf(daily=daily, ai=ai, share_url=share_url)

    headline = ai.get("headline") or f"Daily report · {day}"
    summary = ai.get("summary") or ""
    highlights = ai.get("highlights") or []
    tips = ai.get("tomorrowTips") or []

    text_lines = [
        f"Health Companion — daily report for {day}",
        "",
        headline,
        "",
        summary,
        "",
    ]
    if highlights:
        text_lines.append("Highlights:")
        text_lines.extend(f"• {h}" for h in highlights)
        text_lines.append("")
    if tips:
        text_lines.append("Tips for tomorrow:")
        text_lines.extend(f"• {t}" for t in tips)
        text_lines.append("")
    text_lines.append("The full report is attached as a PDF.")
    text_lines.append(f"Share link: {share_url}")
    text_lines.append("This is not medical advice.")

    html = _html_body(
        day=day,
        headline=headline,
        summary=summary,
        highlights=highlights,
        tips=tips,
        share_url=share_url,
    )

    send_email(
        subject=f"Health Companion · {day} · {headline[:80]}",
        text_body="\n".join(text_lines),
        html_body=html,
        attachments=[(f"health-companion-{day}.pdf", pdf, "application/pdf")],
    )
    logger.info("Daily report email sent for %s to %s (%s bytes PDF)", day, settings.report_email_to, len(pdf))
    return {
        "ok": True,
        "date": day,
        "to": settings.report_email_to,
        "pdfBytes": len(pdf),
        "aiSource": ai.get("source"),
        "headline": headline,
        "shareUrl": share_url,
    }


def _html_body(
    *,
    day: str,
    headline: str,
    summary: str,
    highlights: list[str],
    tips: list[str],
    share_url: str | None = None,
) -> str:
    hi = "".join(f"<li>{_esc(h)}</li>" for h in highlights)
    tip = "".join(f"<li>{_esc(t)}</li>" for t in tips)
    share_block = ""
    if share_url:
        share_block = (
            f'<p style="margin:16px 0">'
            f'<a href="{_esc(share_url)}" style="color:#0d9488;font-weight:600">'
            f"Open shared report</a></p>"
        )
    return f"""
    <div style="font-family:Helvetica,Arial,sans-serif;color:#0f172a;max-width:640px">
      <p style="color:#0d9488;font-weight:700;margin:0 0 4px">Health Companion</p>
      <p style="color:#64748b;margin:0 0 16px">Daily report · {_esc(day)}</p>
      <h1 style="font-size:20px;margin:0 0 12px">{_esc(headline)}</h1>
      <p style="line-height:1.5">{_esc(summary)}</p>
      {"<h2 style='font-size:14px;color:#0d9488'>Highlights</h2><ul>" + hi + "</ul>" if hi else ""}
      {"<h2 style='font-size:14px;color:#0d9488'>Tips for tomorrow</h2><ul>" + tip + "</ul>" if tip else ""}
      {share_block}
      <p style="color:#64748b;font-size:13px">Full details are in the attached PDF.</p>
      <p style="color:#94a3b8;font-size:11px">Not medical advice. Lifestyle tracking only.</p>
    </div>
    """


def _esc(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
