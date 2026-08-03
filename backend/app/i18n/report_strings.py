"""Report / PDF / email strings. English is the canonical archive language."""

from __future__ import annotations

from typing import Literal

Locale = Literal["en", "fr"]

PDF = {
    "en": {
        "brand": "Health Companion",
        "daily_report": "Daily report · {date}",
        "day_overview": "Day overview",
        "ai_insights": "AI insights",
        "highlights": "Highlights",
        "watchouts": "Watch-outs",
        "tomorrow_tips": "Tips for tomorrow",
        "day_details": "Day details",
        "nutrition": "Nutrition",
        "meals_count": "{n} meal(s)",
        "carbs": "Carbs",
        "protein": "Protein",
        "fat": "Fat",
        "calorie_plan": "Calorie plan",
        "maintenance": "maintenance",
        "deficit_target": "deficit target",
        "bmi": "BMI",
        "weight": "weight",
        "today_vs_target": "Today vs target",
        "intake": "intake",
        "under": "under",
        "over": "over",
        "weight_label": "Weight",
        "meals": "Meals",
        "no_meals": "No meals logged this day.",
        "glucose_activity": "Glucose & activity",
        "glucose": "Glucose",
        "avg": "avg",
        "tir": "TIR",
        "low": "Low",
        "high": "High",
        "hypo_episodes": "Hypo episodes",
        "hypoglycemia": "Hypoglycemia",
        "activity": "Activity",
        "steps": "steps",
        "energy_score": "Energy score",
        "via": "via",
        "no_activity": "No activity synced.",
        "workouts": "Workouts",
        "workout": "Workout",
        "care_visits": "Care visits",
        "sport_matches": "Sport matches",
        "injuries_pain": "Injuries & pain",
        "not_medical": "This is not medical advice. Confirm carbs and treatment decisions with your care team.",
        "share_scan": "Scan to open this report",
        "meal_types": {
            "breakfast": "Breakfast",
            "lunch": "Lunch",
            "dinner": "Dinner",
            "snack": "Snack",
            "resucrage": "Resucrage",
            "other": "Other",
        },
    },
    "fr": {
        "brand": "Health Companion",
        "daily_report": "Rapport quotidien · {date}",
        "day_overview": "Aperçu du jour",
        "ai_insights": "Analyses IA",
        "highlights": "Points positifs",
        "watchouts": "Points d’attention",
        "tomorrow_tips": "Conseils pour demain",
        "day_details": "Détails du jour",
        "nutrition": "Nutrition",
        "meals_count": "{n} repas",
        "carbs": "Glucides",
        "protein": "Protéines",
        "fat": "Lipides",
        "calorie_plan": "Plan calorique",
        "maintenance": "maintien",
        "deficit_target": "objectif déficit",
        "bmi": "IMC",
        "weight": "poids",
        "today_vs_target": "Aujourd’hui vs objectif",
        "intake": "apport",
        "under": "sous",
        "over": "au-dessus",
        "weight_label": "Poids",
        "meals": "Repas",
        "no_meals": "Aucun repas enregistré ce jour.",
        "glucose_activity": "Glycémie & activité",
        "glucose": "Glycémie",
        "avg": "moy.",
        "tir": "TIR",
        "low": "Bas",
        "high": "Haut",
        "hypo_episodes": "Épisodes d’hypo",
        "hypoglycemia": "Hypoglycémie",
        "activity": "Activité",
        "steps": "pas",
        "energy_score": "Score d’énergie",
        "via": "via",
        "no_activity": "Aucune activité synchronisée.",
        "workouts": "Séances",
        "workout": "Séance",
        "care_visits": "Soins",
        "sport_matches": "Matchs / sport",
        "injuries_pain": "Blessures & douleur",
        "not_medical": "Ceci n’est pas un avis médical. Confirmez glucides et décisions de traitement avec votre équipe soignante.",
        "share_scan": "Scannez pour ouvrir ce rapport",
        "meal_types": {
            "breakfast": "Petit-déjeuner",
            "lunch": "Déjeuner",
            "dinner": "Dîner",
            "snack": "Collation",
            "resucrage": "Resucrage",
            "other": "Autre",
        },
    },
}

MAIL = {
    "en": {
        "subject_prefix": "Health Companion",
        "intro": "Health Companion — daily report for {date}",
        "highlights": "Highlights:",
        "tips": "Tips for tomorrow:",
        "pdf_attached": "The full report is attached as a PDF.",
        "share_link": "Share link:",
        "not_medical": "This is not medical advice.",
        "open_report": "Open shared report",
    },
    "fr": {
        "subject_prefix": "Health Companion",
        "intro": "Health Companion — rapport quotidien du {date}",
        "highlights": "Points positifs :",
        "tips": "Conseils pour demain :",
        "pdf_attached": "Le rapport complet est joint en PDF.",
        "share_link": "Lien de partage :",
        "not_medical": "Ceci n’est pas un avis médical.",
        "open_report": "Ouvrir le rapport partagé",
    },
}

AI_LANG = {
    "en": "Write the entire JSON response in English.",
    "fr": "Rédige tout le JSON en français (headline, summary, highlights, watchouts, tomorrowTips).",
}

FALLBACK = {
    "en": {
        "headline": "Day overview · {date}",
        "summary_empty": "Limited data logged for this day.",
        "tip1": "Log meals with the phone camera for better carb context.",
        "tip2": "Open Activity and sync Samsung Health so steps appear in reports.",
        "ai_missing": "AI is not configured on the server.",
        "ai_unavailable": "AI insights unavailable ({exc}).",
        "no_summary": "No detailed summary available.",
    },
    "fr": {
        "headline": "Aperçu du jour · {date}",
        "summary_empty": "Peu de données enregistrées pour ce jour.",
        "tip1": "Photographiez vos repas avec le téléphone pour mieux estimer les glucides.",
        "tip2": "Ouvrez Activité et synchronisez Samsung Health pour voir les pas dans les rapports.",
        "ai_missing": "L’IA n’est pas configurée sur le serveur.",
        "ai_unavailable": "Analyses IA indisponibles ({exc}).",
        "no_summary": "Aucun résumé détaillé disponible.",
    },
}


def normalize_locale(value: str | None) -> Locale:
    raw = (value or "").strip().lower()[:2]
    return "fr" if raw == "fr" else "en"


def pdf_strings(locale: str | None) -> dict:
    return PDF[normalize_locale(locale)]


def mail_strings(locale: str | None) -> dict:
    return MAIL[normalize_locale(locale)]


def fallback_strings(locale: str | None) -> dict:
    return FALLBACK[normalize_locale(locale)]


def ai_language_instruction(locale: str | None) -> str:
    return AI_LANG[normalize_locale(locale)]
