package com.saffist3r.healthcompanion.watch

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/** Layouts the user can pick from the watch app's settings. */
enum class FaceStyle(val wire: String, val label: String) {
    HUD("hud", "HUD"),
    CLASSIC("classic", "Classic"),
    MINIMAL("minimal", "Minimal");

    companion object {
        fun fromWire(value: String?): FaceStyle =
            entries.firstOrNull { it.wire == value } ?: HUD
    }
}

object FaceDrawers {
    private val ripple = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }

    fun draw(style: FaceStyle, canvas: Canvas, bounds: Rect, rawState: FaceState) {
        val state = ReadingAnimator.animate(rawState)
        if (state.revealProgress < 1f) drawRipple(canvas, bounds, state)
        when (style) {
            FaceStyle.HUD -> HudFaceDrawer.draw(canvas, bounds, state)
            FaceStyle.CLASSIC -> ClassicFaceDrawer.draw(canvas, bounds, state)
            FaceStyle.MINIMAL -> MinimalFaceDrawer.draw(canvas, bounds, state)
        }
    }

    /** Two rings expanding out from the reading. */
    private fun drawRipple(canvas: Canvas, bounds: Rect, state: FaceState) {
        val radius = min(bounds.width(), bounds.height()) / 2f
        val s = radius / 227f
        val accent = accentFor(state)
        for (k in 0..1) {
            val t = (state.revealProgress * 1.25f - k * 0.25f).coerceIn(0f, 1f)
            if (t <= 0f || t >= 1f) continue
            ripple.strokeWidth = (5f - 3f * t) * s
            ripple.color = HudFaceDrawer.withAlpha(accent, ((1f - t) * 170).toInt())
            canvas.drawCircle(bounds.exactCenterX(), bounds.exactCenterY(), 50f * s + (radius - 50f * s) * t, ripple)
        }
    }

    internal fun accentFor(state: FaceState): Int =
        if (state.insight.isStale) HudFaceDrawer.DIM else HudFaceDrawer.zoneColor(state.insight.zone)

    internal fun pulseFor(state: FaceState): Float =
        if (state.isAmbient) 1f else 0.5f + 0.5f * sin(2 * PI * (state.nowMs % 2400) / 2400.0).toFloat()
}

/**
 * Drives the wake-up and new-reading animations. The gauge sweeps from the bottom of the scale
 * (on wake) or from the previous reading (on a new one); the number is never interpolated, so a
 * quick glance can't catch a value that was never measured.
 */
object ReadingAnimator {
    private const val DURATION_MS = 1100L
    private const val WAKE_FROM_MG = 40.0

    private var fromMg = WAKE_FROM_MG
    private var toMg = Double.NaN
    private var toTs = -1L
    private var startMs = 0L
    private var wasAmbient = true
    private var lastFrameMs = 0L

    fun animate(state: FaceState): FaceState {
        val current = state.insight.current
        if (state.isAmbient || current == null) {
            wasAmbient = wasAmbient || state.isAmbient
            if (current != null) { toMg = current.mgDl; toTs = current.timestamp }
            return state
        }
        // Frames come every ~40 ms while visible; a long gap means the screen was off (with
        // always-on display disabled the face never reports ambient, it just stops drawing).
        val woke = wasAmbient || state.nowMs - lastFrameMs > 1500
        lastFrameMs = state.nowMs
        if (woke) {
            start(WAKE_FROM_MG, current, state.nowMs)
        } else if (current.timestamp != toTs) {
            start(if (toMg.isNaN()) current.mgDl else gaugeAt(state.nowMs), current, state.nowMs)
        }
        wasAmbient = false

        val t = ((state.nowMs - startMs).toFloat() / DURATION_MS).coerceIn(0f, 1f)
        if (t >= 1f) return state
        return state.copy(gaugeMgDl = gaugeAt(state.nowMs), revealProgress = t)
    }

    private fun start(from: Double, target: GlucoseSample, nowMs: Long) {
        fromMg = from
        toMg = target.mgDl
        toTs = target.timestamp
        startMs = nowMs
    }

    private fun gaugeAt(nowMs: Long): Double {
        val t = ((nowMs - startMs).toFloat() / DURATION_MS).coerceIn(0f, 1f)
        val eased = 1f - (1f - t) * (1f - t) * (1f - t)
        return fromMg + (toMg - fromMg) * eased
    }
}

/** The original layout: big time and date, glucose in the middle, heart rate and steps below. */
object ClassicFaceDrawer {
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val bold: Typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")
    private val dateFormat = DateTimeFormatter.ofPattern("dd/MM/yyyy")

    fun draw(canvas: Canvas, bounds: Rect, state: FaceState) {
        val cx = bounds.exactCenterX()
        val cy = bounds.exactCenterY()
        val s = min(bounds.width(), bounds.height()) / 2f / 227f
        val alpha = if (state.isAmbient) 179 else 255

        text.typeface = bold
        text.textSize = 68f * s
        text.color = HudFaceDrawer.withAlpha(state.textColor, alpha)
        canvas.drawText(state.time.format(timeFormat), cx, cy - 74 * s, text)

        text.typeface = Typeface.DEFAULT
        text.textSize = 22f * s
        text.color = HudFaceDrawer.withAlpha(state.textColor, alpha * 3 / 4)
        canvas.drawText(state.time.format(dateFormat), cx, cy - 40 * s, text)

        val accent = FaceDrawers.accentFor(state)
        val pulse = FaceDrawers.pulseFor(state)
        HudFaceDrawer.drawReadout(canvas, cx, cy + 30 * s, s, state, accent, pulse, scale = 0.72f)
        HudFaceDrawer.drawStatusLine(canvas, cx, cy + 66 * s, s, state, pulse)
        HudFaceDrawer.drawSideStats(canvas, cx, cy + 122 * s, s, state, spread = 64f)
    }
}

/** Glucose first: an oversized reading inside a zone-coloured ring, with only the time above it. */
object MinimalFaceDrawer {
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val arc = android.graphics.RectF()
    private val thin: Typeface = Typeface.create("sans-serif-thin", Typeface.NORMAL)
    private val condensed: Typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")
    private val dateFormat = DateTimeFormatter.ofPattern("EEE dd", Locale.ENGLISH)

    fun draw(canvas: Canvas, bounds: Rect, state: FaceState) {
        val cx = bounds.exactCenterX()
        val cy = bounds.exactCenterY()
        val radius = min(bounds.width(), bounds.height()) / 2f
        val s = radius / 227f
        val accent = FaceDrawers.accentFor(state)
        val pulse = FaceDrawers.pulseFor(state)

        ring.strokeWidth = 4f * s
        ring.color = if (state.isAmbient) HudFaceDrawer.withAlpha(Color.WHITE, 70) else HudFaceDrawer.withAlpha(accent, 150)
        if (!state.isAmbient) ring.setShadowLayer(10f * s * pulse, 0f, 0f, accent)
        canvas.drawCircle(cx, cy, radius - 10 * s, ring)
        ring.clearShadowLayer()

        if (!state.isAmbient) {
            // Scanner arc orbiting the ring every 4 s, bright head with a fading tail
            val head = (state.nowMs % 4000) / 4000f * 360f - 90f
            arc.set(cx - radius + 10 * s, cy - radius + 10 * s, cx + radius - 10 * s, cy + radius - 10 * s)
            ring.strokeCap = Paint.Cap.ROUND
            for (k in 0 until 8) {
                ring.strokeWidth = (7f - k * 0.6f) * s
                ring.color = HudFaceDrawer.withAlpha(if (k == 0) Color.WHITE else accent, 230 - k * 28)
                canvas.drawArc(arc, head - (k + 1) * 6f, 6f, false, ring)
            }
            ring.strokeCap = Paint.Cap.BUTT
        }

        text.typeface = condensed
        text.textSize = 15f * s
        text.letterSpacing = 0.28f
        text.color = HudFaceDrawer.withAlpha(if (state.isAmbient) Color.WHITE else HudFaceDrawer.CYAN, if (state.isAmbient) 150 else 200)
        canvas.drawText(state.time.format(dateFormat).uppercase(Locale.ENGLISH), cx, cy - 136 * s, text)

        text.typeface = thin
        text.textSize = 48f * s
        text.letterSpacing = 0.02f
        text.color = HudFaceDrawer.withAlpha(state.textColor, if (state.isAmbient) 200 else 255)
        canvas.drawText(state.time.format(timeFormat), cx, cy - 88 * s, text)
        text.letterSpacing = 0f

        HudFaceDrawer.drawReadout(canvas, cx, cy + 46 * s, s, state, accent, pulse, scale = 1.45f)
        HudFaceDrawer.drawStatusLine(canvas, cx, cy + 108 * s, s, state, pulse)
    }
}
