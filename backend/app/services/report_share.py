from __future__ import annotations

import io
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import ReportShare


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def public_base_url() -> str:
    return (get_settings().public_url or "").rstrip("/") or "http://localhost:5173"


def share_page_url(token: str) -> str:
    return f"{public_base_url()}/share/{token}"


def share_pdf_url(token: str) -> str:
    return f"{public_base_url()}/reports/share/{token}/pdf"


def serialize_share(row: ReportShare) -> dict[str, Any]:
    return {
        "token": row.token,
        "date": row.date,
        "shareUrl": share_page_url(row.token),
        "pdfUrl": share_pdf_url(row.token),
        "qrUrl": f"{public_base_url()}/reports/share/{row.token}/qr.png",
        "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
        "expiresAt": int(row.expires_at.timestamp() * 1000) if row.expires_at else None,
    }


def get_valid_share(db: Session, token: str) -> ReportShare | None:
    row = db.query(ReportShare).filter(ReportShare.token == token).first()
    if not row:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < _utcnow():
        return None
    return row


def get_or_create_share(
    db: Session,
    *,
    date: str,
    user_id: str | None = None,
) -> ReportShare:
    existing = db.query(ReportShare).filter(ReportShare.date == date).first()
    now = _utcnow()
    ttl_days = max(1, int(get_settings().report_share_ttl_days or 30))

    if existing:
        expires = existing.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires > now:
            return existing
        existing.token = secrets.token_urlsafe(24)
        existing.expires_at = now + timedelta(days=ttl_days)
        existing.created_at = now
        existing.created_by_user_id = user_id
        db.commit()
        db.refresh(existing)
        return existing

    row = ReportShare(
        token=secrets.token_urlsafe(24),
        date=date,
        expires_at=now + timedelta(days=ttl_days),
        created_by_user_id=user_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def build_qr_png(url: str, *, box_size: int = 8, border: int = 2) -> bytes:
    import qrcode

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
