from __future__ import annotations

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from app.core.database import Base, engine


def test_migrations_match_models(client) -> None:
    """Startup ran `alembic upgrade head`; the result must equal the SQLAlchemy models.

    Fails when a model changes without a new Alembic revision
    (create one with: alembic revision --autogenerate -m "...").
    """
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []
