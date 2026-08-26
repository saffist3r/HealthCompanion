from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class Macros(BaseModel):
    carbsG: float = 0
    proteinG: float = 0
    fatG: float = 0
    fiberG: float | None = 0
    caloriesKcal: float | None = 0
    sugarG: float | None = 0


class FoodItem(BaseModel):
    name: str
    portion: str | None = None
    macros: Macros
    confidence: float | None = None


class DiabetesWarning(BaseModel):
    code: str
    severity: Literal["info", "caution", "alert"]
    title: str
    message: str


class MealAnalysisResult(BaseModel):
    items: list[FoodItem]
    macros: Macros
    mealTypeGuess: str | None = None
    summary: str
    carbEstimateNote: str
    suggestions: list[str] = Field(default_factory=list)
    warnings: list[DiabetesWarning] = Field(default_factory=list)


class MealCreate(BaseModel):
    eatenAt: datetime | None = None
    mealType: str = "other"
    items: list[FoodItem] = Field(default_factory=list)
    macros: Macros
    photoPath: str | None = None
    notes: str | None = None
    aiSummary: str | None = None
    carbEstimateNote: str | None = None
    warnings: list[DiabetesWarning] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    glucoseMgDl: float | None = None
    source: str = "ai_photo"


class MealUpdate(BaseModel):
    """Partial update for an existing meal (category, macros, notes, time)."""

    mealType: str | None = None
    notes: str | None = None
    aiSummary: str | None = None
    carbEstimateNote: str | None = None
    macros: Macros | None = None
    eatenAt: datetime | None = None
    glucoseMgDl: float | None = None
    wouldAgain: int | None = Field(default=None, ge=-1, le=1)
    wouldAgainNote: str | None = None


class MealOut(BaseModel):
    id: str
    deviceId: str
    createdAt: int
    eatenAt: int
    mealType: str
    photoUrl: str | None = None
    items: list[Any]
    macros: Macros
    notes: str | None = None
    aiSummary: str | None = None
    carbEstimateNote: str | None = None
    warnings: list[Any] = Field(default_factory=list)
    suggestions: list[Any] = Field(default_factory=list)
    source: str
    date: str
    wouldAgain: int | None = None
    wouldAgainNote: str | None = None
    relatedHypoStartedAt: int | None = None
    glucoseStory: dict[str, Any] | None = None
    similarMeals: list[Any] = Field(default_factory=list)


class GlucoseReadingIn(BaseModel):
    value: float
    unit: str
    timestamp: int


class GlucoseSyncIn(BaseModel):
    readings: list[GlucoseReadingIn] = Field(default_factory=list)


class PumpLogEventIn(BaseModel):
    kind: str
    title: str = ""
    message: str = ""
    units: float | None = None
    packageId: str | None = None
    timestamp: int
    rawText: str = ""


class PumpLogSyncIn(BaseModel):
    events: list[PumpLogEventIn] = Field(default_factory=list)


class ActivityIn(BaseModel):
    date: str
    steps: int = 0
    activeMinutes: int | None = None
    caloriesBurned: float | None = None
    energyScore: float | None = None
    workouts: list[Any] = Field(default_factory=list)
    source: str = "health_connect"


CareKind = Literal["kine", "osteo", "podologue", "other"]
SportResult = Literal["win", "loss", "draw", "completed"]
StressLevel = Literal["calm", "ok", "high"]
SportKind = Literal["padel", "gym", "running", "cycling", "swimming", "walking", "other"]
SportIntensity = Literal["easy", "moderate", "hard", "max"]


class CareVisitIn(BaseModel):
    date: str
    time: str | None = None
    kind: CareKind = "other"
    label: str | None = None
    notes: str | None = None


class SportMatchIn(BaseModel):
    date: str
    time: str | None = None
    sport: str = "padel"
    result: SportResult = "win"
    score: str = ""
    durationMin: int | None = None
    opponent: str | None = None
    intensity: SportIntensity | None = None
    notes: str | None = None


class StressLogIn(BaseModel):
    date: str
    time: str | None = None
    level: StressLevel = "ok"
    score: int | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


MoodLevel = Literal["terrible", "low", "ok", "good", "great"]
WakeQuality = Literal["rough", "groggy", "ok", "fresh", "energized"]
FocusLevel = Literal["terrible", "low", "ok", "good", "great"]
AdhdIntensity = Literal["low", "ok", "high"]
TaskInitiation = Literal["stuck", "slow", "ok", "easy"]
CaffeineDrink = Literal[
    "espresso",
    "double_espresso",
    "coffee",
    "iced_coffee",
    "green_tea",
    "black_tea",
]


class DayCheckInIn(BaseModel):
    date: str
    mood: MoodLevel = "ok"
    wakeQuality: WakeQuality = "ok"
    focus: FocusLevel = "ok"
    restlessness: AdhdIntensity = "ok"
    overwhelm: AdhdIntensity = "ok"
    taskInitiation: TaskInitiation = "ok"
    impulsivity: AdhdIntensity = "ok"
    medicationTaken: bool = False
    hyperfocus: bool = False
    sleepHours: float | None = Field(default=None, ge=0, le=24)
    notes: str | None = None


class CaffeineLogIn(BaseModel):
    date: str
    time: str | None = None
    drink: CaffeineDrink = "coffee"
    caffeineMg: int | None = Field(default=None, ge=0, le=500)
    notes: str | None = None


class BodyProfileIn(BaseModel):
    heightCm: float = Field(gt=50, lt=250)
    sex: Literal["male", "female"] = "male"
    ageYears: int = Field(ge=14, le=100)
    activity: Literal["sedentary", "light", "moderate", "active", "very_active"] = "light"
    deficitKcal: float = Field(default=500, ge=0, le=1500)
    locale: Literal["en", "fr"] | None = None
    tirLowMgDl: float | None = Field(default=None, ge=40, le=120)
    tirHighMgDl: float | None = Field(default=None, ge=100, le=300)
    tirGoalPct: float | None = Field(default=None, ge=40, le=100)
    dailyCarbTargetG: float | None = Field(default=None, ge=50, le=400)
    cannulaChangedAt: int | None = None  # epoch ms; set to mark site change
    sensorStartedAt: int | None = None
    markCannulaChanged: bool | None = None
    markSensorStarted: bool | None = None


class DeviceCareIn(BaseModel):
    markCannulaChanged: bool | None = None
    markSensorStarted: bool | None = None
    cannulaChangedAt: int | None = None
    sensorStartedAt: int | None = None


class WeightIn(BaseModel):
    date: str
    weightKg: float = Field(gt=20, lt=400)
    notes: str | None = None


InjuryType = Literal["sprain", "tendinitis", "muscle_strain", "bruise", "fracture", "other"]
InjuryStatus = Literal["active", "healing", "healed"]
InjuryBodyArea = Literal[
    "knee_left",
    "knee_right",
    "ankle_left",
    "ankle_right",
    "shoulder_left",
    "shoulder_right",
    "elbow_left",
    "elbow_right",
    "wrist_left",
    "wrist_right",
    "hip_left",
    "hip_right",
    "lower_back",
    "upper_back",
    "neck",
    "foot_left",
    "foot_right",
    "hamstring_left",
    "hamstring_right",
    "calf_left",
    "calf_right",
    "other",
]
InjuryActivityKind = Literal["sport", "kine", "osteo", "podologue", "gym", "other"]


class InjuryIn(BaseModel):
    title: str | None = None
    injuryType: InjuryType = "other"
    bodyArea: InjuryBodyArea = "other"
    bodyAreaOther: str | None = None
    startedOn: str
    status: InjuryStatus = "active"
    relatedActivityKinds: list[InjuryActivityKind] = Field(default_factory=list)
    exerciseNotes: str | None = None
    notes: str | None = None


class InjuryUpdate(BaseModel):
    title: str | None = None
    injuryType: InjuryType | None = None
    bodyArea: InjuryBodyArea | None = None
    bodyAreaOther: str | None = None
    startedOn: str | None = None
    status: InjuryStatus | None = None
    healedOn: str | None = None
    relatedActivityKinds: list[InjuryActivityKind] | None = None
    exerciseNotes: str | None = None
    notes: str | None = None


class InjuryPainLogIn(BaseModel):
    date: str
    painScore: int = Field(ge=0, le=10)
    relatedActivityKind: InjuryActivityKind | None = None
    notes: str | None = None


class WorkoutExercise(BaseModel):
    name: str
    sets: int | None = None
    reps: str | None = None
    durationMin: int | None = None
    restSec: int | None = None
    targetArea: str | None = None
    notes: str | None = None


class WorkoutPlanDraft(BaseModel):
    title: str
    focus: str | None = None
    durationMin: int | None = None
    summary: str | None = None
    exercises: list[WorkoutExercise] = Field(default_factory=list)
    basedOn: str | None = None
    disclaimer: str | None = None


class WorkoutGenerateIn(BaseModel):
    notes: str | None = None


class WorkoutPlanIn(BaseModel):
    title: str
    focus: str | None = None
    durationMin: int | None = None
    summary: str | None = None
    exercises: list[WorkoutExercise] = Field(default_factory=list)
    basedOn: str | None = None
    notes: str | None = None
    source: str = "gemini"


class WorkoutPlanOut(BaseModel):
    id: str
    title: str
    focus: str | None = None
    durationMin: int | None = None
    summary: str | None = None
    exercises: list[WorkoutExercise] = Field(default_factory=list)
    source: str = "gemini"
    notes: str | None = None
    basedOn: str | None = None
    createdAt: int | None = None


class DashboardOut(BaseModel):
    deviceId: str
    mealCount: int
    todayCarbsG: float
    todayProteinG: float
    todayFatG: float
    todaySteps: int
    glucoseAvgMgDl: float | None
    timeInRangePct: float | None
    recentMeals: list[MealOut]
    dailyReport: dict[str, Any]
    weeklyReport: dict[str, Any]
