"""baseline schema

Revision ID: 0001
Revises:
Create Date: 2026-10-20 09:36:31.140416
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Columns added after first release; pre-Alembic databases may lack them.
LEGACY_COLUMNS: list[tuple[str, sa.Column]] = [
    ("devices", sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True)),
    ("sport_matches", sa.Column("intensity", sa.String(16), nullable=True)),
    ("activity_days", sa.Column("energy_score", sa.Float(), nullable=True)),
    ("stress_logs", sa.Column("source", sa.String(32), server_default="manual")),
    ("day_checkins", sa.Column("focus", sa.String(16), server_default="ok")),
    ("day_checkins", sa.Column("restlessness", sa.String(16), server_default="ok")),
    ("day_checkins", sa.Column("overwhelm", sa.String(16), server_default="ok")),
    ("day_checkins", sa.Column("task_initiation", sa.String(16), server_default="ok")),
    ("day_checkins", sa.Column("impulsivity", sa.String(16), server_default="ok")),
    ("day_checkins", sa.Column("medication_taken", sa.Boolean(), server_default=sa.false())),
    ("day_checkins", sa.Column("hyperfocus", sa.Boolean(), server_default=sa.false())),
    ("day_checkins", sa.Column("sleep_hours", sa.Float(), nullable=True)),
    ("body_profile", sa.Column("locale", sa.String(8), server_default="en")),
    ("body_profile", sa.Column("tir_low_mgdl", sa.Float(), server_default="70")),
    ("body_profile", sa.Column("tir_high_mgdl", sa.Float(), server_default="180")),
    ("body_profile", sa.Column("tir_goal_pct", sa.Float(), server_default="70")),
    ("body_profile", sa.Column("daily_carb_target_g", sa.Float(), server_default="180")),
    ("body_profile", sa.Column("cannula_changed_at", sa.DateTime(timezone=True), nullable=True)),
    ("body_profile", sa.Column("sensor_started_at", sa.DateTime(timezone=True), nullable=True)),
    ("day_debriefs", sa.Column("locale", sa.String(8), server_default="en")),
    ("meals", sa.Column("would_again", sa.Integer(), nullable=True)),
    ("meals", sa.Column("would_again_note", sa.Text(), nullable=True)),
    ("meals", sa.Column("related_hypo_started_at", sa.BigInteger(), nullable=True)),
]


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _create_table(name: str, *columns, **kw) -> None:
    if not _inspector().has_table(name):
        op.create_table(name, *columns, **kw)


_deferred_indexes: list[tuple[str, str, list[str], dict]] = []


def _create_index(name: str, table: str, columns: list[str], **kw) -> None:
    insp = _inspector()
    if name in {ix["name"] for ix in insp.get_indexes(table)}:
        return
    if not set(columns) <= {c["name"] for c in insp.get_columns(table)}:
        # Legacy table without this column yet; create once _add_legacy_columns ran.
        _deferred_indexes.append((name, table, columns, kw))
        return
    op.create_index(name, table, columns, **kw)


def _add_legacy_columns() -> None:
    insp = _inspector()
    for table, column in LEGACY_COLUMNS:
        if column.name not in {c["name"] for c in insp.get_columns(table)}:
            op.add_column(table, column)
    while _deferred_indexes:
        name, table, columns, kw = _deferred_indexes.pop(0)
        _create_index(name, table, columns, **kw)
    if op.get_bind().dialect.name == "postgresql":
        # Older deploys created sport_matches.sport as VARCHAR(32)
        op.alter_column("sport_matches", "sport", type_=sa.String(64))


def upgrade() -> None:
    # Tables as of 1.5.57, generated from the models. On databases created before
    # Alembic (via create_all), existing tables are kept and missing columns added.
    _create_table('body_profile',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('height_cm', sa.Float(), nullable=False),
    sa.Column('sex', sa.String(length=16), nullable=False),
    sa.Column('age_years', sa.Integer(), nullable=False),
    sa.Column('activity', sa.String(length=32), nullable=False),
    sa.Column('deficit_kcal', sa.Float(), nullable=False),
    sa.Column('locale', sa.String(length=8), nullable=False),
    sa.Column('tir_low_mgdl', sa.Float(), nullable=False),
    sa.Column('tir_high_mgdl', sa.Float(), nullable=False),
    sa.Column('tir_goal_pct', sa.Float(), nullable=False),
    sa.Column('daily_carb_target_g', sa.Float(), nullable=False),
    sa.Column('cannula_changed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('sensor_started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    _create_table('day_debriefs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('headline', sa.String(length=512), nullable=False),
    sa.Column('summary', sa.Text(), nullable=False),
    sa.Column('highlights_json', sa.Text(), nullable=False),
    sa.Column('watchouts_json', sa.Text(), nullable=False),
    sa.Column('tomorrow_tips_json', sa.Text(), nullable=False),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.Column('locale', sa.String(length=8), nullable=False),
    sa.Column('agent_prompt', sa.Text(), nullable=False),
    sa.Column('facts_json', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('date', name='uq_day_debrief_date')
    )
    _create_index(op.f('ix_day_debriefs_date'), 'day_debriefs', ['date'], unique=False)
    _create_table('users',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('display_name', sa.String(length=120), nullable=False),
    sa.Column('role', sa.String(length=32), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    _create_table('weight_entries',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('weight_kg', sa.Float(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('date', name='uq_weight_date')
    )
    _create_index(op.f('ix_weight_entries_date'), 'weight_entries', ['date'], unique=False)
    _create_table('devices',
    sa.Column('id', sa.String(length=128), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=True),
    sa.Column('owner_user_id', sa.String(length=36), nullable=True),
    sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_devices_owner_user_id'), 'devices', ['owner_user_id'], unique=False)
    _create_table('report_shares',
    sa.Column('token', sa.String(length=48), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by_user_id', sa.String(length=36), nullable=True),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('token'),
    sa.UniqueConstraint('date', name='uq_report_share_date')
    )
    _create_index(op.f('ix_report_shares_date'), 'report_shares', ['date'], unique=False)
    _create_index(op.f('ix_report_shares_expires_at'), 'report_shares', ['expires_at'], unique=False)
    _create_table('activity_days',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('steps', sa.Integer(), nullable=False),
    sa.Column('active_minutes', sa.Integer(), nullable=True),
    sa.Column('calories_burned', sa.Float(), nullable=True),
    sa.Column('energy_score', sa.Float(), nullable=True),
    sa.Column('workouts_json', sa.Text(), nullable=False),
    sa.Column('synced_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('device_id', 'date', name='uq_activity_device_date')
    )
    _create_index(op.f('ix_activity_days_date'), 'activity_days', ['date'], unique=False)
    _create_index(op.f('ix_activity_days_device_id'), 'activity_days', ['device_id'], unique=False)
    _create_table('caffeine_logs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('time', sa.String(length=8), nullable=True),
    sa.Column('drink', sa.String(length=32), nullable=False),
    sa.Column('caffeine_mg', sa.Integer(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_caffeine_logs_date'), 'caffeine_logs', ['date'], unique=False)
    _create_index(op.f('ix_caffeine_logs_device_id'), 'caffeine_logs', ['device_id'], unique=False)
    _create_table('care_visits',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('time', sa.String(length=8), nullable=True),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_care_visits_date'), 'care_visits', ['date'], unique=False)
    _create_index(op.f('ix_care_visits_device_id'), 'care_visits', ['device_id'], unique=False)
    _create_table('day_checkins',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('mood', sa.String(length=16), nullable=False),
    sa.Column('wake_quality', sa.String(length=16), nullable=False),
    sa.Column('focus', sa.String(length=16), nullable=False),
    sa.Column('restlessness', sa.String(length=16), nullable=False),
    sa.Column('overwhelm', sa.String(length=16), nullable=False),
    sa.Column('task_initiation', sa.String(length=16), nullable=False),
    sa.Column('impulsivity', sa.String(length=16), nullable=False),
    sa.Column('medication_taken', sa.Boolean(), nullable=False),
    sa.Column('hyperfocus', sa.Boolean(), nullable=False),
    sa.Column('sleep_hours', sa.Float(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('device_id', 'date', name='uq_day_checkin_device_date')
    )
    _create_index(op.f('ix_day_checkins_date'), 'day_checkins', ['date'], unique=False)
    _create_index(op.f('ix_day_checkins_device_id'), 'day_checkins', ['device_id'], unique=False)
    _create_table('glucose_samples',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('value', sa.Float(), nullable=False),
    sa.Column('unit', sa.String(length=16), nullable=False),
    sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_glucose_samples_device_id'), 'glucose_samples', ['device_id'], unique=False)
    _create_index(op.f('ix_glucose_samples_timestamp'), 'glucose_samples', ['timestamp'], unique=False)
    _create_table('injuries',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('injury_type', sa.String(length=32), nullable=False),
    sa.Column('body_area', sa.String(length=64), nullable=False),
    sa.Column('body_area_other', sa.String(length=128), nullable=True),
    sa.Column('started_on', sa.String(length=10), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('healed_on', sa.String(length=10), nullable=True),
    sa.Column('related_activity_kinds_json', sa.Text(), nullable=False),
    sa.Column('exercise_notes', sa.Text(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_injuries_device_id'), 'injuries', ['device_id'], unique=False)
    _create_index(op.f('ix_injuries_started_on'), 'injuries', ['started_on'], unique=False)
    _create_index(op.f('ix_injuries_status'), 'injuries', ['status'], unique=False)
    _create_table('meals',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('eaten_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('meal_type', sa.String(length=32), nullable=False),
    sa.Column('photo_path', sa.String(length=512), nullable=True),
    sa.Column('items_json', sa.Text(), nullable=False),
    sa.Column('macros_json', sa.Text(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('ai_summary', sa.Text(), nullable=True),
    sa.Column('carb_estimate_note', sa.Text(), nullable=True),
    sa.Column('warnings_json', sa.Text(), nullable=False),
    sa.Column('suggestions_json', sa.Text(), nullable=False),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.Column('would_again', sa.Integer(), nullable=True),
    sa.Column('would_again_note', sa.Text(), nullable=True),
    sa.Column('related_hypo_started_at', sa.BigInteger(), nullable=True),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_meals_device_id'), 'meals', ['device_id'], unique=False)
    _create_index(op.f('ix_meals_eaten_at'), 'meals', ['eaten_at'], unique=False)
    _create_table('pump_log_events',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('units', sa.Float(), nullable=True),
    sa.Column('package_id', sa.String(length=128), nullable=True),
    sa.Column('raw_text', sa.Text(), nullable=False),
    sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_pump_log_events_device_id'), 'pump_log_events', ['device_id'], unique=False)
    _create_index(op.f('ix_pump_log_events_kind'), 'pump_log_events', ['kind'], unique=False)
    _create_index(op.f('ix_pump_log_events_timestamp'), 'pump_log_events', ['timestamp'], unique=False)
    _create_table('sport_matches',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('time', sa.String(length=8), nullable=True),
    sa.Column('sport', sa.String(length=64), nullable=False),
    sa.Column('result', sa.String(length=16), nullable=False),
    sa.Column('score', sa.String(length=128), nullable=False),
    sa.Column('duration_min', sa.Integer(), nullable=True),
    sa.Column('opponent', sa.String(length=255), nullable=True),
    sa.Column('intensity', sa.String(length=16), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_sport_matches_date'), 'sport_matches', ['date'], unique=False)
    _create_index(op.f('ix_sport_matches_device_id'), 'sport_matches', ['device_id'], unique=False)
    _create_table('stress_logs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('time', sa.String(length=8), nullable=True),
    sa.Column('level', sa.String(length=16), nullable=False),
    sa.Column('score', sa.Integer(), nullable=True),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_stress_logs_date'), 'stress_logs', ['date'], unique=False)
    _create_index(op.f('ix_stress_logs_device_id'), 'stress_logs', ['device_id'], unique=False)
    _create_table('workout_plans',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('focus', sa.String(length=128), nullable=True),
    sa.Column('duration_min', sa.Integer(), nullable=True),
    sa.Column('summary', sa.Text(), nullable=True),
    sa.Column('exercises_json', sa.Text(), nullable=False),
    sa.Column('prompt_context_json', sa.Text(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_workout_plans_device_id'), 'workout_plans', ['device_id'], unique=False)
    _create_table('injury_pain_logs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('injury_id', sa.String(length=36), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('pain_score', sa.Integer(), nullable=False),
    sa.Column('related_activity_kind', sa.String(length=32), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.ForeignKeyConstraint(['injury_id'], ['injuries.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('injury_id', 'date', name='uq_injury_pain_day')
    )
    _create_index(op.f('ix_injury_pain_logs_date'), 'injury_pain_logs', ['date'], unique=False)
    _create_index(op.f('ix_injury_pain_logs_device_id'), 'injury_pain_logs', ['device_id'], unique=False)
    _create_index(op.f('ix_injury_pain_logs_injury_id'), 'injury_pain_logs', ['injury_id'], unique=False)
    _add_legacy_columns()


def downgrade() -> None:
    op.drop_index(op.f('ix_injury_pain_logs_injury_id'), table_name='injury_pain_logs')
    op.drop_index(op.f('ix_injury_pain_logs_device_id'), table_name='injury_pain_logs')
    op.drop_index(op.f('ix_injury_pain_logs_date'), table_name='injury_pain_logs')
    op.drop_table('injury_pain_logs')
    op.drop_index(op.f('ix_workout_plans_device_id'), table_name='workout_plans')
    op.drop_table('workout_plans')
    op.drop_index(op.f('ix_stress_logs_device_id'), table_name='stress_logs')
    op.drop_index(op.f('ix_stress_logs_date'), table_name='stress_logs')
    op.drop_table('stress_logs')
    op.drop_index(op.f('ix_sport_matches_device_id'), table_name='sport_matches')
    op.drop_index(op.f('ix_sport_matches_date'), table_name='sport_matches')
    op.drop_table('sport_matches')
    op.drop_index(op.f('ix_pump_log_events_timestamp'), table_name='pump_log_events')
    op.drop_index(op.f('ix_pump_log_events_kind'), table_name='pump_log_events')
    op.drop_index(op.f('ix_pump_log_events_device_id'), table_name='pump_log_events')
    op.drop_table('pump_log_events')
    op.drop_index(op.f('ix_meals_eaten_at'), table_name='meals')
    op.drop_index(op.f('ix_meals_device_id'), table_name='meals')
    op.drop_table('meals')
    op.drop_index(op.f('ix_injuries_status'), table_name='injuries')
    op.drop_index(op.f('ix_injuries_started_on'), table_name='injuries')
    op.drop_index(op.f('ix_injuries_device_id'), table_name='injuries')
    op.drop_table('injuries')
    op.drop_index(op.f('ix_glucose_samples_timestamp'), table_name='glucose_samples')
    op.drop_index(op.f('ix_glucose_samples_device_id'), table_name='glucose_samples')
    op.drop_table('glucose_samples')
    op.drop_index(op.f('ix_day_checkins_device_id'), table_name='day_checkins')
    op.drop_index(op.f('ix_day_checkins_date'), table_name='day_checkins')
    op.drop_table('day_checkins')
    op.drop_index(op.f('ix_care_visits_device_id'), table_name='care_visits')
    op.drop_index(op.f('ix_care_visits_date'), table_name='care_visits')
    op.drop_table('care_visits')
    op.drop_index(op.f('ix_caffeine_logs_device_id'), table_name='caffeine_logs')
    op.drop_index(op.f('ix_caffeine_logs_date'), table_name='caffeine_logs')
    op.drop_table('caffeine_logs')
    op.drop_index(op.f('ix_activity_days_device_id'), table_name='activity_days')
    op.drop_index(op.f('ix_activity_days_date'), table_name='activity_days')
    op.drop_table('activity_days')
    op.drop_index(op.f('ix_report_shares_expires_at'), table_name='report_shares')
    op.drop_index(op.f('ix_report_shares_date'), table_name='report_shares')
    op.drop_table('report_shares')
    op.drop_index(op.f('ix_devices_owner_user_id'), table_name='devices')
    op.drop_table('devices')
    op.drop_index(op.f('ix_weight_entries_date'), table_name='weight_entries')
    op.drop_table('weight_entries')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_index(op.f('ix_day_debriefs_date'), table_name='day_debriefs')
    op.drop_table('day_debriefs')
    op.drop_table('body_profile')
