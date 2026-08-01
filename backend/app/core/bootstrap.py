from __future__ import annotations

import uuid

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal, engine, init_db as _create_tables
from app.models import User
from app.services.auth_tokens import hash_password
from app.services.body_profile import ensure_body_defaults


def _ensure_device_owner_column() -> None:
    insp = inspect(engine)
    if "devices" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("devices")}
    if "owner_user_id" in cols:
        return
    dialect = engine.dialect.name
    with engine.begin() as conn:
        if dialect == "sqlite":
            conn.execute(text("ALTER TABLE devices ADD COLUMN owner_user_id VARCHAR(36)"))
        else:
            conn.execute(text("ALTER TABLE devices ADD COLUMN owner_user_id VARCHAR(36)"))
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_devices_owner_user_id ON devices (owner_user_id)")
            )


def _ensure_sport_match_columns() -> None:
    insp = inspect(engine)
    if "sport_matches" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("sport_matches")}
    with engine.begin() as conn:
        if "intensity" not in cols:
            conn.execute(text("ALTER TABLE sport_matches ADD COLUMN intensity VARCHAR(16)"))
        dialect = engine.dialect.name
        if dialect == "postgresql":
            try:
                conn.execute(text("ALTER TABLE sport_matches ALTER COLUMN sport TYPE VARCHAR(64)"))
            except Exception:
                pass


def bootstrap_admin(db: Session | None = None) -> None:
    settings = get_settings()
    email = (settings.admin_email or "").strip().lower()
    password = settings.admin_password or ""
    if not email or not password:
        return

    own = db is None
    session = db or SessionLocal()
    try:
        existing = session.query(User).filter(User.email == email).first()
        if existing:
            return
        # Only auto-create when there are no users yet
        if session.query(User).count() > 0:
            return
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            password_hash=hash_password(password),
            display_name=(settings.admin_name or "Admin").strip(),
            role="admin",
            active=True,
        )
        session.add(user)
        session.commit()
    finally:
        if own:
            session.close()


def init_db() -> None:
    _create_tables()
    _ensure_device_owner_column()
    _ensure_sport_match_columns()
    bootstrap_admin()
    session = SessionLocal()
    try:
        ensure_body_defaults(session)
    finally:
        session.close()
