from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal, engine
from app.models import User
from app.services.auth_tokens import hash_password
from app.services.body_profile import ensure_body_defaults

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"
# Arbitrary constant identifying the startup advisory lock.
_STARTUP_LOCK_ID = 726_431_001


def run_migrations(conn: Connection) -> None:
    """Bring the schema to the latest Alembic revision."""
    cfg = Config(str(ALEMBIC_INI))
    cfg.attributes["configure_logger"] = False
    cfg.attributes["connection"] = conn
    command.upgrade(cfg, "head")
    conn.commit()


@contextmanager
def _startup_lock(conn: Connection) -> Iterator[None]:
    """Serialize startup (migrations + seeding) when several workers boot at once."""
    if conn.dialect.name != "postgresql":
        yield
        return
    conn.execute(text("SELECT pg_advisory_lock(:id)"), {"id": _STARTUP_LOCK_ID})
    conn.commit()
    try:
        yield
    finally:
        conn.rollback()
        conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": _STARTUP_LOCK_ID})
        conn.commit()


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
    with engine.connect() as conn, _startup_lock(conn):
        run_migrations(conn)
        bootstrap_admin()
        session = SessionLocal()
        try:
            ensure_body_defaults(session)
        finally:
            session.close()
