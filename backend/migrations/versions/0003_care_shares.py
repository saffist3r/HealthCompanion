"""care_shares (read-only links for the care team)

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-22 09:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('care_shares',
    sa.Column('token', sa.String(length=48), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('days', sa.Integer(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked', sa.Boolean(), nullable=False),
    sa.Column('created_by_user_id', sa.String(length=36), nullable=True),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('token')
    )
    op.create_index(op.f('ix_care_shares_expires_at'), 'care_shares', ['expires_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_care_shares_expires_at'), table_name='care_shares')
    op.drop_table('care_shares')
