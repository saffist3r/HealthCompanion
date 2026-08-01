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
    with engine.begin() as conn:
        try:
            conn.execute(
                text("ALTER TABLE activity_days ADD COLUMN IF NOT EXISTS energy_score DOUBLE PRECISION")
            )
        except Exception:
            # SQLite / older PG without IF NOT EXISTS — ignore if column exists
            try:
                conn.execute(text("ALTER TABLE activity_days ADD COLUMN energy_score FLOAT"))
            except Exception:
                pass

