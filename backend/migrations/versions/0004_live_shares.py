"""live_shares (read-only live glucose links for family)

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-30 12:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0004'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('live_shares',
    sa.Column('token', sa.String(length=48), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked', sa.Boolean(), nullable=False),
    sa.Column('created_by_user_id', sa.String(length=36), nullable=True),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('token')
    )


def downgrade() -> None:
    op.drop_table('live_shares')
