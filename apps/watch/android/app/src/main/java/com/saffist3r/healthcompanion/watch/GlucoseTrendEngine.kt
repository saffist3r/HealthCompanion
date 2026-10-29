package com.saffist3r.healthcompanion.watch

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.sqrt

/** One CGM reading in mg/dL. */
data class GlucoseSample(val mgDl: Double, val timestamp: Long)

/** CGM-style trend arrows (same rate bands as Dexcom / Libre, in mg/dL per minute). */
enum class TrendArrow(val angleDeg: Float, val arrowCount: Int) {
    DOUBLE_UP(-90f, 2),
    SINGLE_UP(-90f, 1),
    FORTY_FIVE_UP(-45f, 1),
    FLAT(0f, 1),
    FORTY_FIVE_DOWN(45f, 1),
    SINGLE_DOWN(90f, 1),
    DOUBLE_DOWN(90f, 2),
    NONE(0f, 0);

    val isRising get() = this == DOUBLE_UP || this == SINGLE_UP || this == FORTY_FIVE_UP
    val isFalling get() = this == DOUBLE_DOWN || this == SINGLE_DOWN || this == FORTY_FIVE_DOWN
}

enum class GlucoseZone { URGENT_LOW, LOW, IN_RANGE, HIGH, VERY_HIGH, UNKNOWN }

data class GlucoseInsight(
    val current: GlucoseSample?,
    val ageMs: Long,
    val isStale: Boolean,
    /** Smoothed rate of change, mg/dL per minute (null when it can't be estimated). */
    val ratePerMin: Double?,
    val arrow: TrendArrow,
    /** 0..1 — how well the recent readings fit a straight line and how many there are. */
    val confidence: Double,
    val zone: GlucoseZone,
    /** Projected readings every 5 min for the next [GlucoseTrendEngine.PREDICTION_MINUTES]. */
    val prediction: List<GlucoseSample>,
    val predicted20Min: Double?,
    /** Minutes until the projection crosses the low threshold (falling), within the horizon. */
    val minutesToLow: Int?,
    /** Minutes until the projection crosses the high threshold (rising), within the horizon. */
    val minutesToHigh: Int?,
    /** Share of readings in range over the history passed in, 0..100. */
    val timeInRangePct: Int?
) {
    val delta5Min: Double? get() = ratePerMin?.let { it * 5.0 }

    companion object {
        val EMPTY = GlucoseInsight(
            current = null, ageMs = 0, isStale = true, ratePerMin = null, arrow = TrendArrow.NONE,
            confidence = 0.0, zone = GlucoseZone.UNKNOWN, prediction = emptyList(), predicted20Min = null,
            minutesToLow = null, minutesToHigh = null, timeInRangePct = null
        )
    }
}

/**
 * Turns the raw reading history into a trend, a short-term forecast and alerts.
 *
 * Why not "last minus first": readings arrive every 1–5 min with sensor noise and the
 * phone sometimes re-posts the same value, so the old detector flipped between up/down
 * on noise and ignored how much time the change took. Here the rate is a recency-weighted
 * least-squares slope over the last ~10 minutes (wider when readings are sparse), classified with the standard CGM
 * rate bands, and the forecast damps that rate so it doesn't overshoot.
 */
object GlucoseTrendEngine {
    const val STALE_AFTER_MS = 15L * 60 * 1000
    const val PREDICTION_MINUTES = 30

    private const val FIT_WINDOW_MS = 10L * 60 * 1000
    private const val FIT_WINDOW_SPARSE_MS = 35L * 60 * 1000
    private const val MIN_FIT_SPAN_MS = 4L * 60 * 1000
    private const val MERGE_WITHIN_MS = 45_000L

    /** Recent readings count more: weight halves every ~3.5 min. */
    private const val RECENCY_TAU_MIN = 5.0

    /** Glucose rarely changes faster than this; larger slopes are sensor glitches. */
    private const val MAX_RATE = 6.0

    /** Forecast damping: the projected rate decays with this time constant (min). */
    private const val DAMPING_TAU_MIN = 35.0

    /** Ignore crossings when the trend is basically flat. */
    private const val MIN_ALERT_RATE = 0.4

    private const val URGENT_LOW_MG_DL = 54.0
    private const val VERY_HIGH_MG_DL = 250.0

    fun analyze(
        history: List<GlucoseSample>,
        nowMs: Long,
        lowMgDl: Double = 70.0,
        highMgDl: Double = 180.0
    ): GlucoseInsight {
        val samples = sanitize(history)
        val current = samples.lastOrNull() ?: return GlucoseInsight.EMPTY
        val ageMs = (nowMs - current.timestamp).coerceAtLeast(0)
        val isStale = ageMs > STALE_AFTER_MS
        val tir = timeInRange(samples, lowMgDl, highMgDl)
        val zone = zoneFor(current.mgDl, lowMgDl, highMgDl)

        val fit = if (isStale) null else fitRate(samples, current)
        if (fit == null) {
            return GlucoseInsight(
                current = current, ageMs = ageMs, isStale = isStale, ratePerMin = null,
                arrow = TrendArrow.NONE, confidence = 0.0, zone = zone, prediction = emptyList(),
                predicted20Min = null, minutesToLow = null, minutesToHigh = null, timeInRangePct = tir
            )
        }

        val rate = fit.rate
        // Forecast from the latest reading (what the user sees), not the fitted line.
        val prediction = (1..PREDICTION_MINUTES / 5).map { step ->
            val minutes = step * 5.0
            GlucoseSample(project(current.mgDl, rate, minutes), current.timestamp + (minutes * 60_000).toLong())
        }
        val minutesToLow = if (rate <= -MIN_ALERT_RATE && current.mgDl >= lowMgDl) {
            minutesUntil(current.mgDl, rate, lowMgDl)
        } else {
            null
        }
        val minutesToHigh = if (rate >= MIN_ALERT_RATE && current.mgDl <= highMgDl) {
            minutesUntil(current.mgDl, rate, highMgDl)
        } else {
            null
        }

        return GlucoseInsight(
            current = current,
            ageMs = ageMs,
            isStale = false,
            ratePerMin = rate,
            arrow = arrowFor(rate),
            confidence = fit.confidence,
            zone = zone,
            prediction = prediction,
            predicted20Min = project(current.mgDl, rate, 20.0),
            minutesToLow = minutesToLow,
            minutesToHigh = minutesToHigh,
            timeInRangePct = tir
        )
    }

    fun arrowFor(ratePerMin: Double): TrendArrow = when {
        ratePerMin >= 3.0 -> TrendArrow.DOUBLE_UP
        ratePerMin >= 2.0 -> TrendArrow.SINGLE_UP
        ratePerMin >= 1.0 -> TrendArrow.FORTY_FIVE_UP
        ratePerMin > -1.0 -> TrendArrow.FLAT
        ratePerMin > -2.0 -> TrendArrow.FORTY_FIVE_DOWN
        ratePerMin > -3.0 -> TrendArrow.SINGLE_DOWN
        else -> TrendArrow.DOUBLE_DOWN
    }

    fun zoneFor(mgDl: Double, lowMgDl: Double, highMgDl: Double): GlucoseZone = when {
        mgDl < URGENT_LOW_MG_DL -> GlucoseZone.URGENT_LOW
        mgDl < lowMgDl -> GlucoseZone.LOW
        mgDl <= highMgDl -> GlucoseZone.IN_RANGE
        mgDl <= VERY_HIGH_MG_DL -> GlucoseZone.HIGH
        else -> GlucoseZone.VERY_HIGH
    }

    /** Damped projection: v0 + r·τ·(1 − e^(−t/τ)), clamped to what sensors report. */
    fun project(currentMgDl: Double, ratePerMin: Double, minutes: Double): Double {
        val travelled = ratePerMin * DAMPING_TAU_MIN * (1 - exp(-minutes / DAMPING_TAU_MIN))
        return (currentMgDl + travelled).coerceIn(39.0, 401.0)
    }

    private fun minutesUntil(currentMgDl: Double, ratePerMin: Double, targetMgDl: Double): Int? {
        // Solve v0 + r·τ·(1 − e^(−t/τ)) = target for t.
        val needed = targetMgDl - currentMgDl
        val ratio = 1 - needed / (ratePerMin * DAMPING_TAU_MIN)
        if (ratio <= 0 || ratio >= 1.0 + 1e-9) return if (abs(needed) < 1e-9) 0 else null
        val minutes = -DAMPING_TAU_MIN * ln(ratio)
        return if (minutes in 0.0..PREDICTION_MINUTES.toDouble()) minutes.toInt() else null
    }

    private data class Fit(val rate: Double, val confidence: Double)

    private fun fitRate(samples: List<GlucoseSample>, current: GlucoseSample): Fit? {
        var window = samples.filter { it.timestamp >= current.timestamp - FIT_WINDOW_MS }
        if (window.size < 3) {
            window = samples.filter { it.timestamp >= current.timestamp - FIT_WINDOW_SPARSE_MS }
        }
        if (window.size < 2) return null
        val spanMs = current.timestamp - window.first().timestamp
        if (spanMs < MIN_FIT_SPAN_MS) return null

        val xs = window.map { (it.timestamp - current.timestamp) / 60_000.0 } // minutes, ≤ 0
        val ys = window.map { it.mgDl }
        val ws = xs.map { exp(it / RECENCY_TAU_MIN) }
        val wSum = ws.sum()
        val xMean = xs.indices.sumOf { ws[it] * xs[it] } / wSum
        val yMean = xs.indices.sumOf { ws[it] * ys[it] } / wSum
        var sxx = 0.0
        var sxy = 0.0
        for (i in xs.indices) {
            val dx = xs[i] - xMean
            sxx += ws[i] * dx * dx
            sxy += ws[i] * dx * (ys[i] - yMean)
        }
        if (sxx <= 1e-9) return null
        val rate = (sxy / sxx).coerceIn(-MAX_RATE, MAX_RATE)

        var residual = 0.0
        for (i in xs.indices) {
            val fitted = yMean + rate * (xs[i] - xMean)
            residual += ws[i] * (ys[i] - fitted) * (ys[i] - fitted)
        }
        val rms = sqrt(residual / wSum)
        val fitQuality = (1.0 - rms / 12.0).coerceIn(0.0, 1.0)
        val countFactor = (window.size / 4.0).coerceAtMost(1.0)
        val spanFactor = (spanMs / (10.0 * 60_000)).coerceAtMost(1.0)
        return Fit(rate, fitQuality * countFactor * (0.5 + 0.5 * spanFactor))
    }

    /** Oldest → newest, plausible values only, near-duplicate re-posts merged (latest wins). */
    fun sanitize(history: List<GlucoseSample>): List<GlucoseSample> {
        val sorted = history
            .filter { it.timestamp > 0 && it.mgDl in 20.0..600.0 }
            .sortedBy { it.timestamp }
        val out = ArrayList<GlucoseSample>(sorted.size)
        for (s in sorted) {
            val last = out.lastOrNull()
            if (last != null && s.timestamp - last.timestamp < MERGE_WITHIN_MS) {
                out[out.size - 1] = s
            } else {
                out.add(s)
            }
        }
        return out
    }

    private fun timeInRange(samples: List<GlucoseSample>, lowMgDl: Double, highMgDl: Double): Int? {
        if (samples.size < 3) return null
        val inRange = samples.count { it.mgDl in lowMgDl..highMgDl }
        return Math.round(inRange * 100.0 / samples.size).toInt()
    }
}
