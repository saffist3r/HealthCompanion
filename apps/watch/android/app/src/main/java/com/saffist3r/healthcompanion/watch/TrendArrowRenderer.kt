package com.saffist3r.healthcompanion.watch

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import kotlin.math.sin

enum class GlycemiaTrend {
    RISING,
    FALLING,
    STEADY,
    UNKNOWN
}

object GlycemiaTrendDetector {
    private const val MIN_DELTA_MG_DL = 8.0
    private const val RECENT_POINTS = 8
    private const val RECENT_WINDOW_MS = 2L * 60 * 60 * 1000

    fun detect(): GlycemiaTrend {
        val now = System.currentTimeMillis()
        val points = GlycemiaHolder.getSparklinePoints12h()
            .filter { it.second >= now - RECENT_WINDOW_MS }
        if (points.size < 2) return GlycemiaTrend.UNKNOWN

        val recent = points.takeLast(RECENT_POINTS.coerceAtMost(points.size))
        val delta = recent.last().first - recent.first().first
        return when {
            delta >= MIN_DELTA_MG_DL -> GlycemiaTrend.RISING
            delta <= -MIN_DELTA_MG_DL -> GlycemiaTrend.FALLING
            else -> GlycemiaTrend.STEADY
        }
    }
}

/**
 * Playful bouncing chevron arrows for rising / falling glucose on the watch face.
 */
object TrendArrowRenderer {
    private const val ARROW_COUNT = 4
    private val arrowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        textSize = 16f
        typeface = android.graphics.Typeface.create(
            android.graphics.Typeface.DEFAULT,
            android.graphics.Typeface.BOLD
        )
    }
    private val chevronPath = Path()

    fun draw(
        canvas: Canvas,
        centerX: Float,
        baseY: Float,
        trend: GlycemiaTrend,
        accentColor: Int,
        isAmbient: Boolean
    ) {
        when (trend) {
            GlycemiaTrend.UNKNOWN -> return
            GlycemiaTrend.STEADY -> drawSteady(canvas, centerX, baseY, accentColor, isAmbient)
            GlycemiaTrend.RISING -> drawAnimated(
                canvas, centerX, baseY, up = true,
                color = blendColor(accentColor, Color.parseColor("#FFD54F")),
                label = if (isAmbient) "—" else "↑ up",
                isAmbient = isAmbient
            )
            GlycemiaTrend.FALLING -> drawAnimated(
                canvas, centerX, baseY, up = false,
                color = blendColor(accentColor, Color.parseColor("#4DD0E1")),
                label = if (isAmbient) "—" else "↓ down",
                isAmbient = isAmbient
            )
        }
    }

    private fun drawAnimated(
        canvas: Canvas,
        centerX: Float,
        baseY: Float,
        up: Boolean,
        color: Int,
        label: String,
        isAmbient: Boolean
    ) {
        val t = System.currentTimeMillis() / 1000.0
        val spacing = 22f
        val totalW = (ARROW_COUNT - 1) * spacing
        val startX = centerX - totalW / 2f
        val size = if (isAmbient) 11f else 15f
        val amp = if (isAmbient) 0f else 9f

        for (i in 0 until ARROW_COUNT) {
            val phase = t * 4.2 + i * 0.65
            val bounce = (sin(phase) * amp).toFloat()
            val drift = if (isAmbient) 0f else (sin(t * 2.8 + i * 0.4) * 2.5f).toFloat()
            val x = startX + i * spacing + drift
            val y = baseY + if (up) -bounce else bounce
            val alpha = if (isAmbient) 200 else (160 + (sin(phase + 1) * 60)).toInt().coerceIn(120, 255)
            arrowPaint.color = Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
            drawChevron(canvas, x, y, size, up, arrowPaint)
        }

        if (!isAmbient && label.isNotEmpty()) {
            labelPaint.color = Color.argb(210, Color.red(color), Color.green(color), Color.blue(color))
            labelPaint.textSize = 16f
            canvas.drawText(label, centerX, baseY + 30f, labelPaint)
        }
    }

    private fun drawSteady(canvas: Canvas, centerX: Float, baseY: Float, color: Int, isAmbient: Boolean) {
        val pulse = if (isAmbient) 1f else (0.85f + 0.15f * sin(System.currentTimeMillis() / 900.0)).toFloat()
        labelPaint.color = Color.argb((160 * pulse).toInt(), Color.red(color), Color.green(color), Color.blue(color))
        labelPaint.textSize = if (isAmbient) 14f else 18f
        canvas.drawText("→ steady", centerX, baseY + 10f, labelPaint)
        labelPaint.textSize = 16f
    }

    private fun drawChevron(canvas: Canvas, cx: Float, cy: Float, size: Float, up: Boolean, paint: Paint) {
        chevronPath.reset()
        val dir = if (up) -1f else 1f
        val tipY = cy + dir * size
        val wingY = cy - dir * size * 0.35f
        chevronPath.moveTo(cx, tipY)
        chevronPath.lineTo(cx - size * 0.85f, wingY)
        chevronPath.lineTo(cx - size * 0.35f, wingY)
        chevronPath.lineTo(cx - size * 0.35f, cy - dir * size * 0.15f)
        chevronPath.lineTo(cx + size * 0.35f, cy - dir * size * 0.15f)
        chevronPath.lineTo(cx + size * 0.35f, wingY)
        chevronPath.lineTo(cx + size * 0.85f, wingY)
        chevronPath.close()
        canvas.drawPath(chevronPath, paint)
    }

    private fun blendColor(a: Int, b: Int): Int {
        val mix = 0.45f
        return Color.rgb(
            (Color.red(a) * (1 - mix) + Color.red(b) * mix).toInt(),
            (Color.green(a) * (1 - mix) + Color.green(b) * mix).toInt(),
            (Color.blue(a) * (1 - mix) + Color.blue(b) * mix).toInt()
        )
    }
}
