"""meals.photos_json (multi-photo meals)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-21 19:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1.5.81 databases already have it (added by the old startup ALTERs).
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("meals")}
    if "photos_json" not in columns:
        op.add_column("meals", sa.Column("photos_json", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("meals", "photos_json")
