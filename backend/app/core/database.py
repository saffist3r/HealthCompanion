from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

# Allow both postgresql:// and postgres://
db_url = settings.database_url.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if db_url.startswith("sqlite") else {}
engine = create_engine(db_url, pool_pre_ping=not db_url.startswith("sqlite"), connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401
    from sqlalchemy import text

    Base.metadata.create_all(bind=engine)
    # Lightweight column add for existing deployments (no Alembic yet).
    alters = [
        ("activity_days", "energy_score", "DOUBLE PRECISION", "FLOAT"),
        ("stress_logs", "source", "VARCHAR(32) DEFAULT 'manual'", "TEXT DEFAULT 'manual'"),
        ("day_checkins", "focus", "VARCHAR(16) DEFAULT 'ok'", "TEXT DEFAULT 'ok'"),
        ("day_checkins", "restlessness", "VARCHAR(16) DEFAULT 'ok'", "TEXT DEFAULT 'ok'"),
        ("day_checkins", "overwhelm", "VARCHAR(16) DEFAULT 'ok'", "TEXT DEFAULT 'ok'"),
        ("day_checkins", "task_initiation", "VARCHAR(16) DEFAULT 'ok'", "TEXT DEFAULT 'ok'"),
        ("day_checkins", "impulsivity", "VARCHAR(16) DEFAULT 'ok'", "TEXT DEFAULT 'ok'"),
        ("day_checkins", "medication_taken", "BOOLEAN DEFAULT FALSE", "INTEGER DEFAULT 0"),
        ("day_checkins", "hyperfocus", "BOOLEAN DEFAULT FALSE", "INTEGER DEFAULT 0"),
        ("day_checkins", "sleep_hours", "DOUBLE PRECISION", "FLOAT"),
        ("body_profile", "locale", "VARCHAR(8) DEFAULT 'en'", "TEXT DEFAULT 'en'"),
        ("body_profile", "tir_low_mgdl", "DOUBLE PRECISION DEFAULT 70", "FLOAT DEFAULT 70"),
        ("body_profile", "tir_high_mgdl", "DOUBLE PRECISION DEFAULT 180", "FLOAT DEFAULT 180"),
        ("body_profile", "tir_goal_pct", "DOUBLE PRECISION DEFAULT 70", "FLOAT DEFAULT 70"),
        ("body_profile", "daily_carb_target_g", "DOUBLE PRECISION DEFAULT 180", "FLOAT DEFAULT 180"),
        ("day_debriefs", "locale", "VARCHAR(8) DEFAULT 'en'", "TEXT DEFAULT 'en'"),
    ]
    with engine.begin() as conn:
        for table, col, pg_type, sqlite_type in alters:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {pg_type}"))
            except Exception:
                try:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {sqlite_type}"))
                except Exception:
                    pass

