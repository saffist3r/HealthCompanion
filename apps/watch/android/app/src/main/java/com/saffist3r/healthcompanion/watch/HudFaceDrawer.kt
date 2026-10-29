package com.saffist3r.healthcompanion.watch

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/** Everything the face shows for one frame. */
data class FaceState(
    val time: ZonedDateTime,
    val nowMs: Long,
    val insight: GlucoseInsight,
    /** Oldest → newest, mg/dL. */
    val history: List<GlucoseSample>,
    /** "mg/dL" or "mmol/L" — the unit the CGM app reports in. */
    val displayUnit: String,
    val heartBpm: Int?,
    val steps: Int?,
    val textColor: Int,
    val isAmbient: Boolean,
    val lowMgDl: Double = 70.0,
    val highMgDl: Double = 180.0
)

/**
 * Futuristic HUD watch face: glucose gauge ring with forecast marker, neon readout with
 * CGM trend arrow, 3-hour chart with a 30-minute projection, and predictive alerts.
 * Pure android.graphics so it can be rendered off-device for previews.
 */
object HudFaceDrawer {
    // Palette
    val CYAN = Color.parseColor("#00E5FF")
    val MINT = Color.parseColor("#2EF2B5")
    val AMBER = Color.parseColor("#FFB547")
    val RED = Color.parseColor("#FF4D6D")
    val URGENT = Color.parseColor("#FF1F4B")
    val VIOLET = Color.parseColor("#9D8CFF")
    private val DIM = Color.parseColor("#5B6B82")

    private const val GAUGE_MIN = 40.0
    private const val GAUGE_MAX = 400.0
    private const val GAUGE_START_DEG = 135f
    private const val GAUGE_SWEEP_DEG = 270f
    private const val CHART_PAST_MS = 3L * 60 * 60 * 1000
    private const val CHART_FUTURE_MS = GlucoseTrendEngine.PREDICTION_MINUTES * 60_000L
    private const val ALERT_MINUTES = 20

    private val thin: Typeface = Typeface.create("sans-serif-thin", Typeface.NORMAL)
    private val light: Typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
    private val condensed: Typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val condensedLight: Typeface = Typeface.create("sans-serif-condensed", Typeface.NORMAL)

    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val path = Path()
    private val arc = RectF()
    private val dash = DashPathEffect(floatArrayOf(6f, 6f), 0f)
    private val dateFormat = DateTimeFormatter.ofPattern("EEE dd MMM", Locale.ENGLISH)
    private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")

    fun zoneColor(zone: GlucoseZone): Int = when (zone) {
        GlucoseZone.URGENT_LOW -> URGENT
        GlucoseZone.LOW -> RED
        GlucoseZone.IN_RANGE -> MINT
        GlucoseZone.HIGH -> AMBER
        GlucoseZone.VERY_HIGH -> RED
        GlucoseZone.UNKNOWN -> DIM
    }

    fun draw(canvas: Canvas, bounds: Rect, state: FaceState) {
        val cx = bounds.exactCenterX()
        val cy = bounds.exactCenterY()
        val radius = min(bounds.width(), bounds.height()) / 2f
        val s = radius / 227f // layout designed on a 454 px round face
        val insight = state.insight
        val accent = if (insight.isStale) DIM else zoneColor(insight.zone)
        val pulse = if (state.isAmbient) 1f else 0.5f + 0.5f * sin(2 * PI * (state.nowMs % 2400) / 2400.0).toFloat()

        if (!state.isAmbient) drawSecondsRing(canvas, cx, cy, radius - 7 * s, s, state.time.second)
        drawGauge(canvas, cx, cy, radius - 26 * s, s, state, accent, pulse)
        drawDateTime(canvas, cx, cy, s, state)
        drawSideStats(canvas, cx, cy, s, state)
        drawReadout(canvas, cx, cy + 34 * s, s, state, accent, pulse)
        drawStatusLine(canvas, cx, cy + 68 * s, s, state, pulse)
        if (!state.isAmbient) {
            drawChart(canvas, RectF(cx - 112 * s, cy + 84 * s, cx + 112 * s, cy + 134 * s), s, state)
            drawTimeInRange(canvas, cx, cy + 160 * s, s, state)
        }
    }

    // ---------------------------------------------------------------- frame

    private fun drawSecondsRing(canvas: Canvas, cx: Float, cy: Float, r: Float, s: Float, second: Int) {
        for (i in 0 until 60) {
            val major = i % 5 == 0
            val lit = i <= second
            val len = (if (major) 9f else 4f) * s
            stroke.strokeWidth = (if (major) 2.4f else 1.4f) * s
            stroke.color = when {
                i == second -> CYAN
                lit -> withAlpha(CYAN, if (major) 170 else 110)
                else -> withAlpha(Color.WHITE, if (major) 70 else 34)
            }
            stroke.setShadowLayer(if (i == second) 8f * s else 0f, 0f, 0f, CYAN)
            val a = Math.toRadians(i * 6.0 - 90)
            val ca = cos(a).toFloat()
            val sa = sin(a).toFloat()
            canvas.drawLine(cx + ca * r, cy + sa * r, cx + ca * (r - len), cy + sa * (r - len), stroke)
        }
        stroke.clearShadowLayer()
    }

    private fun drawGauge(
        canvas: Canvas, cx: Float, cy: Float, r: Float, s: Float,
        state: FaceState, accent: Int, pulse: Float
    ) {
        arc.set(cx - r, cy - r, cx + r, cy + r)
        val ambient = state.isAmbient
        stroke.pathEffect = null
        stroke.strokeCap = Paint.Cap.BUTT

        // Zone track: low | in range | high | very high
        val bands = listOf(
            GAUGE_MIN to state.lowMgDl to RED,
            state.lowMgDl to state.highMgDl to MINT,
            state.highMgDl to 250.0 to AMBER,
            250.0 to GAUGE_MAX to RED
        )
        stroke.strokeWidth = (if (ambient) 1.5f else 5f) * s
        for ((range, color) in bands) {
            val a0 = gaugeAngle(range.first)
            val a1 = gaugeAngle(range.second)
            stroke.color = withAlpha(if (ambient) Color.WHITE else color, if (ambient) 60 else 55)
            canvas.drawArc(arc, a0 + 0.8f, a1 - a0 - 1.6f, false, stroke)
        }

        // Threshold labels just inside the ring
        if (!ambient) {
            text.typeface = condensedLight
            text.textSize = 13f * s
            text.letterSpacing = 0f
            text.color = withAlpha(Color.WHITE, 120)
            for (v in listOf(state.lowMgDl, state.highMgDl)) {
                val a = Math.toRadians(gaugeAngle(v).toDouble())
                val lr = r - 16 * s
                canvas.drawText(
                    formatGlucose(v, state.displayUnit),
                    cx + cos(a).toFloat() * lr,
                    cy + sin(a).toFloat() * lr + 4 * s,
                    text
                )
            }
        }

        val current = state.insight.current ?: return
        val curAngle = gaugeAngle(current.mgDl)

        // Filled sweep up to the current value
        if (!ambient) {
            stroke.strokeWidth = 7f * s
            stroke.strokeCap = Paint.Cap.ROUND
            stroke.shader = LinearGradient(
                cx - r, cy + r, cx + r, cy - r,
                withAlpha(accent, 40), withAlpha(accent, 230), Shader.TileMode.CLAMP
            )
            stroke.setShadowLayer(10f * s, 0f, 0f, withAlpha(accent, 160))
            canvas.drawArc(arc, GAUGE_START_DEG, curAngle - GAUGE_START_DEG, false, stroke)
            stroke.shader = null
            stroke.clearShadowLayer()
        }

        // Forecast: dashed arc to the 20-minute projection + hollow marker
        val predicted = state.insight.predicted20Min
        if (!ambient && predicted != null && abs(predicted - current.mgDl) >= 3) {
            val pAngle = gaugeAngle(predicted)
            stroke.strokeWidth = 3f * s
            stroke.strokeCap = Paint.Cap.ROUND
            stroke.pathEffect = dash
            stroke.color = withAlpha(VIOLET, 200)
            canvas.drawArc(arc, curAngle, pAngle - curAngle, false, stroke)
            stroke.pathEffect = null
            val p = pointOn(cx, cy, r, pAngle)
            stroke.strokeWidth = 2.5f * s
            canvas.drawCircle(p.first, p.second, 6f * s, stroke)
        }

        // Current-value marker
        val m = pointOn(cx, cy, r, curAngle)
        if (ambient) {
            fill.color = Color.WHITE
            canvas.drawCircle(m.first, m.second, 4f * s, fill)
        } else {
            fill.color = withAlpha(accent, (70 + 80 * pulse).toInt())
            canvas.drawCircle(m.first, m.second, (10f + 4f * pulse) * s, fill)
            fill.color = Color.WHITE
            fill.setShadowLayer(8f * s, 0f, 0f, accent)
            canvas.drawCircle(m.first, m.second, 5f * s, fill)
            fill.clearShadowLayer()
        }
        stroke.strokeCap = Paint.Cap.ROUND
    }

    // ---------------------------------------------------------------- text

    private fun drawDateTime(canvas: Canvas, cx: Float, cy: Float, s: Float, state: FaceState) {
        val base = state.textColor
        text.letterSpacing = 0.28f
        text.typeface = condensed
        text.textSize = 16f * s
        text.color = withAlpha(if (state.isAmbient) Color.WHITE else CYAN, if (state.isAmbient) 150 else 200)
        canvas.drawText(state.time.format(dateFormat).uppercase(Locale.ENGLISH), cx, cy - 122 * s, text)

        text.letterSpacing = 0.02f
        text.typeface = thin
        text.textSize = 74f * s
        text.color = withAlpha(base, if (state.isAmbient) 200 else 255)
        if (!state.isAmbient) text.setShadowLayer(12f * s, 0f, 0f, withAlpha(CYAN, 90))
        canvas.drawText(state.time.format(timeFormat), cx, cy - 52 * s, text)
        text.clearShadowLayer()
        text.letterSpacing = 0f
    }

    private fun drawReadout(
        canvas: Canvas, cx: Float, baseline: Float, s: Float,
        state: FaceState, accent: Int, pulse: Float
    ) {
        val insight = state.insight
        val current = insight.current
        val value = current?.let { formatGlucose(it.mgDl, state.displayUnit) } ?: "--"

        text.typeface = if (state.isAmbient) light else condensed
        text.textSize = 82f * s
        text.letterSpacing = -0.01f
        val valueW = text.measureText(value)
        val badgeR = 17f * s
        val gap = 10f * s
        val hasArrow = insight.arrow != TrendArrow.NONE
        val totalW = valueW + if (hasArrow) gap + badgeR * 2 else 0f
        val left = cx - totalW / 2f

        text.textAlign = Paint.Align.LEFT
        text.color = when {
            state.isAmbient -> withAlpha(Color.WHITE, 220)
            insight.isStale -> withAlpha(DIM, 230)
            else -> accent
        }
        if (!state.isAmbient && !insight.isStale) {
            text.setShadowLayer((10f + 6f * pulse) * s, 0f, 0f, withAlpha(accent, 170))
        }
        canvas.drawText(value, left, baseline, text)
        text.clearShadowLayer()
        text.textAlign = Paint.Align.CENTER
        text.letterSpacing = 0f

        if (insight.isStale && current != null) {
            // Strike-through so an old number is never mistaken for a live one
            stroke.strokeWidth = 3f * s
            stroke.color = withAlpha(RED, 200)
            val midY = baseline - 26 * s
            canvas.drawLine(left - 4 * s, midY, left + valueW + 4 * s, midY, stroke)
        }

        if (hasArrow) {
            val bx = left + valueW + gap + badgeR
            val by = baseline - 28 * s
            drawTrendBadge(canvas, bx, by, badgeR, insight.arrow, accent, state.isAmbient, insight.confidence)
        }

        // Unit, small and spaced, under the number
        text.typeface = condensedLight
        text.textSize = 11f * s
        text.letterSpacing = 0.3f
        text.color = withAlpha(Color.WHITE, if (state.isAmbient) 110 else 130)
        canvas.drawText(state.displayUnit.uppercase(Locale.ENGLISH), cx - (if (hasArrow) badgeR + gap / 2 else 0f), baseline + 13 * s, text)
        text.letterSpacing = 0f
    }

    private fun drawTrendBadge(
        canvas: Canvas, cx: Float, cy: Float, r: Float,
        arrow: TrendArrow, color: Int, ambient: Boolean, confidence: Double
    ) {
        stroke.strokeWidth = 2f * r / 17f
        stroke.color = if (ambient) withAlpha(Color.WHITE, 160) else withAlpha(color, 210)
        canvas.drawCircle(cx, cy, r, stroke)
        if (!ambient) {
            fill.color = withAlpha(color, (30 + 50 * confidence).toInt())
            canvas.drawCircle(cx, cy, r - stroke.strokeWidth, fill)
        }

        canvas.save()
        canvas.rotate(arrow.angleDeg, cx, cy)
        fill.color = Color.WHITE
        val heads = arrow.arrowCount
        val hw = r * 0.42f
        val hl = r * 0.48f
        // Shaft
        stroke.strokeWidth = r * 0.16f
        stroke.color = fill.color
        val tip = cx + r * 0.58f
        canvas.drawLine(cx - r * 0.55f, cy, tip - hl * 0.5f, cy, stroke)
        for (i in 0 until heads) {
            val t = tip - i * hl * 0.75f
            path.reset()
            path.moveTo(t, cy)
            path.lineTo(t - hl, cy - hw)
            path.lineTo(t - hl * 0.72f, cy)
            path.lineTo(t - hl, cy + hw)
            path.close()
            canvas.drawPath(path, fill)
        }
        canvas.restore()
    }

    private fun drawStatusLine(canvas: Canvas, cx: Float, baseline: Float, s: Float, state: FaceState, pulse: Float) {
        val insight = state.insight
        if (insight.current == null) {
            drawLabel(canvas, cx, baseline, s, "WAITING FOR CGM", DIM, state.isAmbient)
            return
        }
        val ageMin = (insight.ageMs / 60_000).toInt()
        if (insight.isStale) {
            drawLabel(canvas, cx, baseline, s, "SIGNAL LOST · ${formatAge(ageMin)}", AMBER, state.isAmbient)
            return
        }

        val low = insight.minutesToLow
        val high = insight.minutesToHigh
        when {
            insight.zone == GlucoseZone.URGENT_LOW ->
                drawChip(canvas, cx, baseline, s, "URGENT LOW", URGENT, pulse, state.isAmbient)
            low != null && low <= ALERT_MINUTES ->
                drawChip(canvas, cx, baseline, s, "LOW IN ~${low.coerceAtLeast(1)} MIN", RED, pulse, state.isAmbient)
            high != null && high <= ALERT_MINUTES ->
                drawChip(canvas, cx, baseline, s, "HIGH IN ~${high.coerceAtLeast(1)} MIN", AMBER, pulse, state.isAmbient)
            else -> {
                val delta = insight.delta5Min
                val deltaText = delta?.let { "${formatDelta(it, state.displayUnit)}/5m" }
                val parts = listOfNotNull(deltaText, formatAge(ageMin))
                drawLabel(canvas, cx, baseline, s, parts.joinToString("  ·  "), Color.WHITE, state.isAmbient)
            }
        }
    }

    private fun drawLabel(canvas: Canvas, cx: Float, baseline: Float, s: Float, label: String, color: Int, ambient: Boolean) {
        text.typeface = condensedLight
        text.textSize = 15f * s
        text.letterSpacing = 0.12f
        text.color = withAlpha(if (ambient) Color.WHITE else color, if (ambient) 150 else 190)
        canvas.drawText(label, cx, baseline, text)
        text.letterSpacing = 0f
    }

    private fun drawChip(
        canvas: Canvas, cx: Float, baseline: Float, s: Float,
        label: String, color: Int, pulse: Float, ambient: Boolean
    ) {
        text.typeface = condensed
        text.textSize = 15f * s
        text.letterSpacing = 0.14f
        val w = text.measureText(label) + 26 * s
        val h = 24f * s
        val rect = RectF(cx - w / 2, baseline - h * 0.72f, cx + w / 2, baseline + h * 0.28f)
        if (ambient) {
            stroke.strokeWidth = 1.5f * s
            stroke.color = Color.WHITE
            canvas.drawRoundRect(rect, h / 2, h / 2, stroke)
            text.color = Color.WHITE
        } else {
            fill.color = withAlpha(color, (150 + 90 * pulse).toInt())
            fill.setShadowLayer(14f * s * pulse, 0f, 0f, color)
            canvas.drawRoundRect(rect, h / 2, h / 2, fill)
            fill.clearShadowLayer()
            text.color = Color.parseColor("#0A0F1A")
        }
        canvas.drawText(label, cx, baseline, text)
        text.letterSpacing = 0f
    }

    // ---------------------------------------------------------------- chart

    private fun drawChart(canvas: Canvas, box: RectF, s: Float, state: FaceState) {
        val now = state.nowMs
        val start = now - CHART_PAST_MS
        val end = now + CHART_FUTURE_MS
        val points = state.history.filter { it.timestamp in start..now }
        fun x(ts: Long) = box.left + (ts - start).toFloat() / (end - start) * box.width()
        // Auto-scale to the data (and always show the target band) so small swings are visible.
        val values = points.map { it.mgDl } + state.insight.prediction.map { it.mgDl }
        val lo = (values + state.lowMgDl).min() - 12
        val hi = (values + state.highMgDl).max() + 12
        fun y(mg: Double): Float = box.bottom - ((mg - lo) / (hi - lo)).toFloat().coerceIn(0f, 1f) * box.height()

        // In-range band
        fill.color = withAlpha(MINT, 26)
        canvas.drawRect(box.left, y(state.highMgDl), box.right, y(state.lowMgDl), fill)
        stroke.strokeWidth = 1f * s
        stroke.color = withAlpha(MINT, 70)
        stroke.pathEffect = DashPathEffect(floatArrayOf(2f * s, 4f * s), 0f)
        canvas.drawLine(box.left, y(state.highMgDl), box.right, y(state.highMgDl), stroke)
        canvas.drawLine(box.left, y(state.lowMgDl), box.right, y(state.lowMgDl), stroke)

        // "Now" divider
        val nowX = x(now)
        stroke.color = withAlpha(Color.WHITE, 70)
        canvas.drawLine(nowX, box.top - 2 * s, nowX, box.bottom + 2 * s, stroke)
        stroke.pathEffect = null

        if (points.size >= 2) {
            // Area fill under the line
            path.reset()
            path.moveTo(x(points.first().timestamp), box.bottom)
            for (p in points) path.lineTo(x(p.timestamp), y(p.mgDl))
            path.lineTo(x(points.last().timestamp), box.bottom)
            path.close()
            fill.shader = LinearGradient(0f, box.top, 0f, box.bottom, withAlpha(CYAN, 90), withAlpha(CYAN, 0), Shader.TileMode.CLAMP)
            canvas.drawPath(path, fill)
            fill.shader = null

            // Neon line
            path.reset()
            points.forEachIndexed { i, p ->
                if (i == 0) path.moveTo(x(p.timestamp), y(p.mgDl)) else path.lineTo(x(p.timestamp), y(p.mgDl))
            }
            stroke.strokeWidth = 2.4f * s
            stroke.color = CYAN
            stroke.setShadowLayer(6f * s, 0f, 0f, CYAN)
            canvas.drawPath(path, stroke)
            stroke.clearShadowLayer()
        }

        // Forecast extension
        val current = state.insight.current
        if (current != null && state.insight.prediction.isNotEmpty()) {
            path.reset()
            path.moveTo(x(current.timestamp), y(current.mgDl))
            for (p in state.insight.prediction) path.lineTo(x(p.timestamp.coerceAtMost(end)), y(p.mgDl))
            stroke.strokeWidth = 2f * s
            stroke.color = withAlpha(VIOLET, 220)
            stroke.pathEffect = DashPathEffect(floatArrayOf(4f * s, 4f * s), 0f)
            canvas.drawPath(path, stroke)
            stroke.pathEffect = null
        }
        if (current != null && current.timestamp >= start) {
            fill.color = Color.WHITE
            fill.setShadowLayer(6f * s, 0f, 0f, CYAN)
            canvas.drawCircle(x(current.timestamp), y(current.mgDl), 3.2f * s, fill)
            fill.clearShadowLayer()
        }

        text.typeface = condensedLight
        text.textSize = 10f * s
        text.letterSpacing = 0.15f
        text.color = withAlpha(Color.WHITE, 110)
        text.textAlign = Paint.Align.LEFT
        canvas.drawText("-3H", box.left, box.bottom + 12 * s, text)
        text.textAlign = Paint.Align.RIGHT
        text.color = withAlpha(VIOLET, 170)
        canvas.drawText("+30M", box.right, box.bottom + 12 * s, text)
        text.textAlign = Paint.Align.CENTER
        text.letterSpacing = 0f
    }

    private fun drawTimeInRange(canvas: Canvas, cx: Float, baseline: Float, s: Float, state: FaceState) {
        val tir = state.insight.timeInRangePct ?: return
        text.typeface = condensed
        text.textSize = 13f * s
        text.letterSpacing = 0.22f
        text.color = withAlpha(Color.WHITE, 150)
        val label = "TIR "
        val value = "$tir%"
        val lw = text.measureText(label)
        val vw = text.measureText(value)
        val left = cx - (lw + vw) / 2
        text.textAlign = Paint.Align.LEFT
        canvas.drawText(label, left, baseline, text)
        text.color = if (tir >= 70) MINT else if (tir >= 50) AMBER else RED
        canvas.drawText(value, left + lw, baseline, text)
        text.textAlign = Paint.Align.CENTER
        text.letterSpacing = 0f
    }

    // ---------------------------------------------------------------- side stats

    private fun drawSideStats(canvas: Canvas, cx: Float, cy: Float, s: Float, state: FaceState) {
        val y = cy - 22 * s
        val alpha = if (state.isAmbient) 140 else 220
        drawStat(canvas, cx - 150 * s, y, s, state.heartBpm?.toString() ?: "--", "BPM", RED, alpha, state.isAmbient) { x, iy ->
            drawHeart(canvas, x, iy, 11f * s)
        }
        val steps = state.steps?.let { if (it >= 10_000) "%.1fk".format(Locale.ENGLISH, it / 1000.0) else "%,d".format(Locale.ENGLISH, it) } ?: "--"
        drawStat(canvas, cx + 150 * s, y, s, steps, "STEPS", CYAN, alpha, state.isAmbient) { x, iy ->
            drawSteps(canvas, x, iy, 11f * s)
        }
    }

    private inline fun drawStat(
        canvas: Canvas, x: Float, y: Float, s: Float, value: String, label: String,
        color: Int, alpha: Int, ambient: Boolean, icon: (Float, Float) -> Unit
    ) {
        fill.color = withAlpha(if (ambient) Color.WHITE else color, alpha)
        icon(x, y - 22 * s)
        text.typeface = condensed
        text.textSize = 20f * s
        text.color = withAlpha(Color.WHITE, alpha)
        canvas.drawText(value, x, y + 4 * s, text)
        text.typeface = condensedLight
        text.textSize = 9f * s
        text.letterSpacing = 0.3f
        text.color = withAlpha(Color.WHITE, alpha / 2)
        canvas.drawText(label, x, y + 16 * s, text)
        text.letterSpacing = 0f
    }

    private fun drawHeart(canvas: Canvas, cx: Float, cy: Float, size: Float) {
        path.reset()
        path.moveTo(cx, cy + size * 0.55f)
        path.cubicTo(cx - size * 1.1f, cy - size * 0.1f, cx - size * 0.55f, cy - size * 0.95f, cx, cy - size * 0.35f)
        path.cubicTo(cx + size * 0.55f, cy - size * 0.95f, cx + size * 1.1f, cy - size * 0.1f, cx, cy + size * 0.55f)
        path.close()
        canvas.drawPath(path, fill)
    }

    private fun drawSteps(canvas: Canvas, cx: Float, cy: Float, size: Float) {
        val w = size * 0.42f
        val h = size * 0.85f
        canvas.drawOval(cx - w * 1.6f, cy - h * 0.7f, cx - w * 0.15f, cy + h * 0.5f, fill)
        canvas.drawOval(cx + w * 0.15f, cy - h * 0.4f, cx + w * 1.6f, cy + h * 0.8f, fill)
    }

    // ---------------------------------------------------------------- helpers

    /** Log scale so the in-range band gets most of the ring. */
    fun gaugeAngle(mgDl: Double): Float {
        val v = mgDl.coerceIn(GAUGE_MIN, GAUGE_MAX)
        val frac = (ln(v / GAUGE_MIN) / ln(GAUGE_MAX / GAUGE_MIN)).toFloat()
        return GAUGE_START_DEG + frac * GAUGE_SWEEP_DEG
    }

    private fun pointOn(cx: Float, cy: Float, r: Float, angleDeg: Float): Pair<Float, Float> {
        val a = Math.toRadians(angleDeg.toDouble())
        return (cx + cos(a).toFloat() * r) to (cy + sin(a).toFloat() * r)
    }

    fun formatGlucose(mgDl: Double, unit: String): String =
        if (unit.equals("mg/dL", ignoreCase = true)) mgDl.roundToInt().toString()
        else "%.1f".format(Locale.ENGLISH, mgDl / 18.0182)

    fun formatDelta(deltaMgDl: Double, unit: String): String {
        val mg = unit.equals("mg/dL", ignoreCase = true)
        val v = if (mg) deltaMgDl.roundToInt().toDouble() else ((deltaMgDl / 18.0182) * 10).roundToInt() / 10.0
        val sign = if (v > 0) "+" else if (v < 0) "−" else "±"
        val mag = abs(v)
        return sign + if (mg) mag.toInt().toString() else "%.1f".format(Locale.ENGLISH, mag)
    }

    private fun formatAge(minutes: Int): String = when {
        minutes < 1 -> "NOW"
        minutes < 60 -> "${minutes}M AGO"
        else -> "${minutes / 60}H AGO"
    }

    private fun withAlpha(color: Int, alpha: Int): Int =
        Color.argb(alpha.coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
}
