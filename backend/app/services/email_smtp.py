from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Sequence

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    s = get_settings()
    return bool(
        (s.smtp_host or "").strip()
        and (s.smtp_user or "").strip()
        and (s.smtp_password or "").strip()
        and (s.report_email_to or "").strip()
    )


def send_email(
    *,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    to_addrs: Sequence[str] | None = None,
    attachments: Sequence[tuple[str, bytes, str]] | None = None,
) -> None:
    """
    Send an email via SMTP SSL.
    attachments: list of (filename, content_bytes, mime_type)
    """
    settings = get_settings()
    if not smtp_configured():
        raise RuntimeError("SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASSWORD / REPORT_EMAIL_TO)")

    to_list = [a.strip() for a in (to_addrs or [settings.report_email_to]) if a and a.strip()]
    if not to_list:
        raise RuntimeError("No report recipients configured")

    from_addr = (settings.report_email_from or settings.smtp_user).strip()
    from_name = (settings.report_email_from_name or "Health Companion").strip()

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_addr}>"
    msg["To"] = ", ".join(to_list)
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    for filename, content, mime in attachments or []:
        maintype, _, subtype = (mime or "application/octet-stream").partition("/")
        msg.add_attachment(
            content,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=filename,
        )

    context = ssl.create_default_context()
    port = int(settings.smtp_port or 465)
    use_ssl = bool(settings.smtp_ssl)
    logger.info("Sending email via %s:%s to %s", settings.smtp_host, port, to_list)

    if use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, port, context=context, timeout=60) as smtp:
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(settings.smtp_host, port, timeout=60) as smtp:
            smtp.starttls(context=context)
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
