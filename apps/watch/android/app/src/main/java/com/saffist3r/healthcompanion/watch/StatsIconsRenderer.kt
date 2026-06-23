package com.saffist3r.healthcompanion.watch

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect

object StatsIconsRenderer {
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val heartPath = Path()

    /**
     * Heart on the left third, steps on the right — balanced on a round face.
     */
    fun drawStatsRow(
        canvas: Canvas,
        centerX: Float,
        baselineY: Float,
        screenWidth: Float,
        heartBpm: Int?,
        steps: Int?,
        textPaint: Paint
    ) {
        fillPaint.color = textPaint.color
        val leftCenter = centerX - screenWidth * 0.26f
        val rightCenter = centerX + screenWidth * 0.26f
        drawGroup(
            canvas,
            leftCenter,
            baselineY,
            heartBpm?.toString() ?: "--",
            textPaint,
            icon = Icon.HEART
        )
        drawGroup(
            canvas,
            rightCenter,
            baselineY,
            steps?.let { "%,d".format(it) } ?: "--",
            textPaint,
            icon = Icon.FOOTPRINTS
        )
    }

    private enum class Icon { HEART, FOOTPRINTS }

    private val textBounds = Rect()

    private fun textVisualCenterY(baselineY: Float, value: String, paint: Paint): Float {
        paint.getTextBounds(value, 0, value.length, textBounds)
        return baselineY + textBounds.exactCenterY()
    }

    private fun drawGroup(
        canvas: Canvas,
        groupCenterX: Float,
        baselineY: Float,
        value: String,
        textPaint: Paint,
        icon: Icon
    ) {
        val fm = textPaint.fontMetrics
        val textHeight = fm.descent - fm.ascent
        val textMidY = textVisualCenterY(baselineY, value, textPaint)
        val iconSize = textHeight * 1.12f
        val gap = 12f
        val textW = textPaint.measureText(value)
        val iconSlot = iconSize * 1.15f
        val groupW = iconSlot + gap + textW
        var x = groupCenterX - groupW / 2f
        val iconCx = x + iconSlot / 2f
        // Heart glyph sits slightly low in its box; footprints are symmetric
        val iconCy = when (icon) {
            Icon.HEART -> textMidY - iconSize * 0.06f
            Icon.FOOTPRINTS -> textMidY
        }

        when (icon) {
            Icon.HEART -> drawHeart(canvas, iconCx, iconCy, iconSize, fillPaint)
            Icon.FOOTPRINTS -> drawFootprints(canvas, iconCx, iconCy, iconSize, fillPaint)
        }
        x += iconSlot + gap
        canvas.drawText(value, x, baselineY, textPaint)
    }

    private fun drawHeart(canvas: Canvas, cx: Float, cy: Float, size: Float, paint: Paint) {
        heartPath.reset()
        val w = size * 0.95f
        val h = size
        // Symmetric around cy so centering matches the digit cap height
        heartPath.moveTo(cx, cy + h * 0.28f)
        heartPath.cubicTo(
            cx - w * 0.52f, cy - h * 0.02f,
            cx - w * 0.52f, cy - h * 0.46f,
            cx, cy - h * 0.22f
        )
        heartPath.cubicTo(
            cx + w * 0.52f, cy - h * 0.46f,
            cx + w * 0.52f, cy - h * 0.02f,
            cx, cy + h * 0.28f
        )
        heartPath.close()
        canvas.drawPath(heartPath, paint)
    }

    private fun drawFootprints(canvas: Canvas, cx: Float, cy: Float, size: Float, paint: Paint) {
        val footW = size * 0.36f
        val footH = size * 0.72f
        val gap = size * 0.16f
        canvas.drawOval(cx - footW - gap / 2f, cy - footH / 2f, cx - gap / 2f, cy + footH / 2f, paint)
        canvas.drawOval(cx + gap / 2f, cy - footH / 2f, cx + footW + gap / 2f, cy + footH / 2f, paint)
    }
}
