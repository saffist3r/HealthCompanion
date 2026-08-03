"""Locale helpers for the household (English default / archive language)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.i18n.report_strings import Locale, normalize_locale


def household_locale(db: Session) -> Locale:
    from app.services.body_profile import ensure_body_defaults

    profile = ensure_body_defaults(db)
    return normalize_locale(getattr(profile, "locale", None) or "en")
