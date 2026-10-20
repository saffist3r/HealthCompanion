"""Human-readable labels for enum-like values stored in the database."""

CARE_LABELS = {
    "kine": "Kiné",
    "osteo": "Ostéo",
    "podologue": "Podologue",
    "other": "Other",
}
STRESS_LABELS = {
    "calm": "Calm",
    "ok": "OK",
    "high": "High",
}
MOOD_LABELS = {
    "terrible": "Terrible",
    "low": "Low",
    "ok": "OK",
    "good": "Good",
    "great": "Great",
}
WAKE_LABELS = {
    "rough": "Rough",
    "groggy": "Groggy",
    "ok": "OK",
    "fresh": "Fresh",
    "energized": "Energized",
}
FOCUS_LABELS = MOOD_LABELS
ADHD_INTENSITY_LABELS = {
    "low": "Low",
    "ok": "OK",
    "high": "High",
}
TASK_INITIATION_LABELS = {
    "stuck": "Stuck",
    "slow": "Slow",
    "ok": "OK",
    "easy": "Easy",
}
CAFFEINE_DRINK_LABELS = {
    "espresso": "Espresso",
    "double_espresso": "Double espresso",
    "coffee": "Coffee",
    "iced_coffee": "Iced coffee",
    "green_tea": "Green tea",
    "black_tea": "Black tea",
}
STRESS_SOURCE_LABELS = {
    "manual": "Manual",
    "samsung_energy": "Samsung Energy Score",
}
PUMP_KIND_LABELS = {
    "insulin_delivered": "Insulin delivered",
    "high": "High glucose",
    "low": "Low glucose",
    "urgent_low": "Urgent low",
    "reservoir": "Reservoir",
    "battery": "Battery",
    "occlusion": "Occlusion",
    "sensor": "Sensor",
    "alert": "Alert",
    "other": "Pump event",
}
