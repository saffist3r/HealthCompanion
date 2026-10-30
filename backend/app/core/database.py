from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

# Allow both postgresql:// and postgres://
db_url = settings.database_url.replace("postgres://", "postgresql://", 1)
# Name the driver: SQLAlchemy 2.1 defaults bare postgresql:// to psycopg 3, we ship psycopg2
if db_url.startswith("postgresql://"):
    db_url = "postgresql+psycopg2://" + db_url[len("postgresql://"):]

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
