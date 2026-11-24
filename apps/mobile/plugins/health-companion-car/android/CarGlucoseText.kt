package com.saffist3r.healthcompanion.car

import java.util.Locale
import kotlin.math.roundToInt

/** Wording and number formatting for the car screen and car alerts (English / French). */
object CarGlucoseText {
    private const val MMOL_FACTOR = 18.0182

    val fr: Boolean get() = Locale.getDefault().language == "fr"

    fun isMmol(unit: String) = unit.lowercase(Locale.ROOT).startsWith("mmol")

    fun value(mgDl: Double, unit: String): String =
        if (isMmol(unit)) String.format(Locale.getDefault(), "%.1f", mgDl / MMOL_FACTOR)
        else mgDl.roundToInt().toString()

    fun unitLabel(unit: String) = if (isMmol(unit)) "mmol/L" else "mg/dL"

    fun withUnit(mgDl: Double, unit: String) = "${value(mgDl, unit)} ${unitLabel(unit)}"

    fun arrow(arrow: TrendArrow): String = when (arrow) {
        TrendArrow.DOUBLE_UP -> "⇈"
        TrendArrow.SINGLE_UP -> "↑"
        TrendArrow.FORTY_FIVE_UP -> "↗"
        TrendArrow.FLAT -> "→"
        TrendArrow.FORTY_FIVE_DOWN -> "↘"
        TrendArrow.SINGLE_DOWN -> "↓"
        TrendArrow.DOUBLE_DOWN -> "⇊"
        TrendArrow.NONE -> ""
    }

    fun trendWord(arrow: TrendArrow): String = when (arrow) {
        TrendArrow.DOUBLE_UP -> if (fr) "Monte vite" else "Rising fast"
        TrendArrow.SINGLE_UP -> if (fr) "Monte" else "Rising"
        TrendArrow.FORTY_FIVE_UP -> if (fr) "Monte doucement" else "Rising slowly"
        TrendArrow.FLAT -> if (fr) "Stable" else "Steady"
        TrendArrow.FORTY_FIVE_DOWN -> if (fr) "Baisse doucement" else "Falling slowly"
        TrendArrow.SINGLE_DOWN -> if (fr) "Baisse" else "Falling"
        TrendArrow.DOUBLE_DOWN -> if (fr) "Baisse vite" else "Falling fast"
        TrendArrow.NONE -> if (fr) "Tendance inconnue" else "No trend yet"
    }

    fun ago(ageMs: Long): String {
        val min = (ageMs / 60_000).toInt()
        return when {
            min < 1 -> if (fr) "à l’instant" else "just now"
            min < 60 -> if (fr) "il y a $min min" else "$min min ago"
            else -> if (fr) "il y a ${min / 60} h" else "${min / 60} h ago"
        }
    }

    fun zoneWord(zone: GlucoseZone): String = when (zone) {
        GlucoseZone.URGENT_LOW -> if (fr) "Hypo sévère" else "Urgent low"
        GlucoseZone.LOW -> if (fr) "Bas" else "Low"
        GlucoseZone.IN_RANGE -> if (fr) "Dans la cible" else "In range"
        GlucoseZone.HIGH -> if (fr) "Haut" else "High"
        GlucoseZone.VERY_HIGH -> if (fr) "Très haut" else "Very high"
        GlucoseZone.UNKNOWN -> ""
    }
}
