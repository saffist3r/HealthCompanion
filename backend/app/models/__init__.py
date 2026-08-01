from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(32), default="member")  # admin | member
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True, index=True
    )

    meals = relationship("Meal", back_populates="device", cascade="all, delete-orphan")
    glucose_samples = relationship(
        "GlucoseSample", back_populates="device", cascade="all, delete-orphan"
    )
    activity_days = relationship(
        "ActivityDay", back_populates="device", cascade="all, delete-orphan"
    )
    care_visits = relationship(
        "CareVisit", back_populates="device", cascade="all, delete-orphan"
    )
    sport_matches = relationship(
        "SportMatch", back_populates="device", cascade="all, delete-orphan"
    )
    stress_logs = relationship(
        "StressLog", back_populates="device", cascade="all, delete-orphan"
    )
    injuries = relationship(
        "Injury", back_populates="device", cascade="all, delete-orphan"
    )
    injury_pain_logs = relationship(
        "InjuryPainLog", back_populates="device", cascade="all, delete-orphan"
    )
    pump_log_events = relationship(
        "PumpLogEvent", back_populates="device", cascade="all, delete-orphan"
    )


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    eaten_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    meal_type: Mapped[str] = mapped_column(String(32), default="other")
    photo_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    items_json: Mapped[str] = mapped_column(Text, default="[]")
    macros_json: Mapped[str] = mapped_column(Text, default="{}")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    carb_estimate_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    warnings_json: Mapped[str] = mapped_column(Text, default="[]")
    suggestions_json: Mapped[str] = mapped_column(Text, default="[]")
    source: Mapped[str] = mapped_column(String(32), default="ai_photo")

    device = relationship("Device", back_populates="meals")


class GlucoseSample(Base):
    __tablename__ = "glucose_samples"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(16))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device = relationship("Device", back_populates="glucose_samples")


class ActivityDay(Base):
    __tablename__ = "activity_days"
    __table_args__ = (UniqueConstraint("device_id", "date", name="uq_activity_device_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    steps: Mapped[int] = mapped_column(Integer, default=0)
    active_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    calories_burned: Mapped[float | None] = mapped_column(Float, nullable=True)
    energy_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    workouts_json: Mapped[str] = mapped_column(Text, default="[]")
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[str] = mapped_column(String(32), default="health_connect")

    device = relationship("Device", back_populates="activity_days")


class CareVisit(Base):
    __tablename__ = "care_visits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    time: Mapped[str | None] = mapped_column(String(8), nullable=True)  # HH:MM
    kind: Mapped[str] = mapped_column(String(32), default="other")  # kine|osteo|podologue|other
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device = relationship("Device", back_populates="care_visits")


class SportMatch(Base):
    __tablename__ = "sport_matches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    time: Mapped[str | None] = mapped_column(String(8), nullable=True)
    sport: Mapped[str] = mapped_column(String(64), default="padel")
    result: Mapped[str] = mapped_column(String(16), default="win")  # win|loss|draw|completed
    score: Mapped[str] = mapped_column(String(128), default="")
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opponent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    intensity: Mapped[str | None] = mapped_column(String(16), nullable=True)  # easy|moderate|hard|max
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device = relationship("Device", back_populates="sport_matches")


class StressLog(Base):
    __tablename__ = "stress_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    time: Mapped[str | None] = mapped_column(String(8), nullable=True)
    level: Mapped[str] = mapped_column(String(16), default="ok")  # calm|ok|high
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0–100 optional
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device = relationship("Device", back_populates="stress_logs")


class Injury(Base):
    """Persistent injury case (type, body area, exercises) until healed."""

    __tablename__ = "injuries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    injury_type: Mapped[str] = mapped_column(String(32), default="other")
    body_area: Mapped[str] = mapped_column(String(64), default="other")
    body_area_other: Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_on: Mapped[str] = mapped_column(String(10), index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    healed_on: Mapped[str | None] = mapped_column(String(10), nullable=True)
    related_activity_kinds_json: Mapped[str] = mapped_column(Text, default="[]")
    exercise_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device = relationship("Device", back_populates="injuries")
    pain_logs = relationship(
        "InjuryPainLog",
        back_populates="injury",
        cascade="all, delete-orphan",
        order_by="InjuryPainLog.date",
    )


class InjuryPainLog(Base):
    """One pain score per injury per day (0–10)."""

    __tablename__ = "injury_pain_logs"
    __table_args__ = (UniqueConstraint("injury_id", "date", name="uq_injury_pain_day"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    injury_id: Mapped[str] = mapped_column(String(36), ForeignKey("injuries.id"), index=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    pain_score: Mapped[int] = mapped_column(Integer, default=0)
    related_activity_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    injury = relationship("Injury", back_populates="pain_logs")
    device = relationship("Device", back_populates="injury_pain_logs")


class BodyProfile(Base):
    """Household body metrics for calorie targets (singleton row id=default)."""

    __tablename__ = "body_profile"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default="default")
    height_cm: Mapped[float] = mapped_column(Float, default=178.0)
    sex: Mapped[str] = mapped_column(String(16), default="male")
    age_years: Mapped[int] = mapped_column(Integer, default=30)
    activity: Mapped[str] = mapped_column(String(32), default="light")
    deficit_kcal: Mapped[float] = mapped_column(Float, default=500.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WeightEntry(Base):
    __tablename__ = "weight_entries"
    __table_args__ = (UniqueConstraint("date", name="uq_weight_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReportShare(Base):
    """Opaque token granting public read access to a daily report PDF."""

    __tablename__ = "report_shares"
    __table_args__ = (UniqueConstraint("date", name="uq_report_share_date"),)

    token: Mapped[str] = mapped_column(String(48), primary_key=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )


class DayDebrief(Base):
    """Archived daily AI debrief + structured agent briefing (RAG-ready)."""

    __tablename__ = "day_debriefs"
    __table_args__ = (UniqueConstraint("date", name="uq_day_debrief_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    headline: Mapped[str] = mapped_column(String(512), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    highlights_json: Mapped[str] = mapped_column(Text, default="[]")
    watchouts_json: Mapped[str] = mapped_column(Text, default="[]")
    tomorrow_tips_json: Mapped[str] = mapped_column(Text, default="[]")
    source: Mapped[str] = mapped_column(String(32), default="fallback")  # gemini | fallback
    agent_prompt: Mapped[str] = mapped_column(Text, default="")
    facts_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PumpLogEvent(Base):
    """CapAPS / CamAPS FX pump & alert notifications synced from the phone."""

    __tablename__ = "pump_log_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    units: Mapped[float | None] = mapped_column(Float, nullable=True)
    package_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    raw_text: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device = relationship("Device", back_populates="pump_log_events")

