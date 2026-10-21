from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, BigInteger, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
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
    day_checkins = relationship(
        "DayCheckIn", back_populates="device", cascade="all, delete-orphan"
    )
    caffeine_logs = relationship(
        "CaffeineLog", back_populates="device", cascade="all, delete-orphan"
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
    workout_plans = relationship(
        "WorkoutPlan", back_populates="device", cascade="all, delete-orphan"
    )


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    eaten_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    meal_type: Mapped[str] = mapped_column(String(32), default="other")
    photo_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # JSON list: [{ "path": "...", "role": "main"|"side"|"dessert"|"drink"|"other", "label": "..." }]
    photos_json: Mapped[str] = mapped_column(Text, default="[]")
    items_json: Mapped[str] = mapped_column(Text, default="[]")
    macros_json: Mapped[str] = mapped_column(Text, default="{}")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    carb_estimate_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    warnings_json: Mapped[str] = mapped_column(Text, default="[]")
    suggestions_json: Mapped[str] = mapped_column(Text, default="[]")
    source: Mapped[str] = mapped_column(String(32), default="ai_photo")
    # -1 dislike / 0 meh / 1 would again — nullable until rated
    would_again: Mapped[int | None] = mapped_column(Integer, nullable=True)
    would_again_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_hypo_started_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

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
    # manual | samsung_energy (Energy Score proxy — continuous stress isn't exposed to 3P apps)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device = relationship("Device", back_populates="stress_logs")


class DayCheckIn(Base):
    """One daily wellbeing check-in: mood, wake, and ADHD-relevant ratings."""

    __tablename__ = "day_checkins"
    __table_args__ = (UniqueConstraint("device_id", "date", name="uq_day_checkin_device_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    mood: Mapped[str] = mapped_column(String(16), default="ok")  # terrible|low|ok|good|great
    wake_quality: Mapped[str] = mapped_column(
        String(16), default="ok"
    )  # rough|groggy|ok|fresh|energized
    # ADHD-relevant daily ratings
    focus: Mapped[str] = mapped_column(String(16), default="ok")  # terrible|low|ok|good|great
    restlessness: Mapped[str] = mapped_column(String(16), default="ok")  # low|ok|high
    overwhelm: Mapped[str] = mapped_column(String(16), default="ok")  # low|ok|high
    task_initiation: Mapped[str] = mapped_column(String(16), default="ok")  # stuck|slow|ok|easy
    impulsivity: Mapped[str] = mapped_column(String(16), default="ok")  # low|ok|high
    medication_taken: Mapped[bool] = mapped_column(Boolean, default=False)
    hyperfocus: Mapped[bool] = mapped_column(Boolean, default=False)
    sleep_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    device = relationship("Device", back_populates="day_checkins")


class CaffeineLog(Base):
    """Drink-based caffeine intakes (espresso, coffee, tea…)."""

    __tablename__ = "caffeine_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    time: Mapped[str | None] = mapped_column(String(8), nullable=True)
    drink: Mapped[str] = mapped_column(String(32), default="coffee")
    caffeine_mg: Mapped[int] = mapped_column(Integer, default=95)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device = relationship("Device", back_populates="caffeine_logs")


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
    # Household UI/report language. English remains the default archive language.
    locale: Mapped[str] = mapped_column(String(8), default="en")
    # Personal glucose / TIR targets (mg/dL and % goal).
    tir_low_mgdl: Mapped[float] = mapped_column(Float, default=70.0)
    tir_high_mgdl: Mapped[float] = mapped_column(Float, default=180.0)
    tir_goal_pct: Mapped[float] = mapped_column(Float, default=70.0)
    daily_carb_target_g: Mapped[float] = mapped_column(Float, default=180.0)
    cannula_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sensor_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
    # Language of the saved narrative (en is canonical / default archive).
    locale: Mapped[str] = mapped_column(String(8), default="en")
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


class WorkoutPlan(Base):
    """AI-generated workout session saved for later."""

    __tablename__ = "workout_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), ForeignKey("devices.id"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="Workout")
    focus: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    exercises_json: Mapped[str] = mapped_column(Text, default="[]")
    prompt_context_json: Mapped[str] = mapped_column(Text, default="{}")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="gemini")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device = relationship("Device", back_populates="workout_plans")

