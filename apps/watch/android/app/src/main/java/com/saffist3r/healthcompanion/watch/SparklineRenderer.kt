package com.saffist3r.healthcompanion.watch

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path

object SparklineRenderer {
    private const val WINDOW_MS = 12L * 60 * 60 * 1000
    private const val Y_MIN_MG_DL = 50.0
    private const val Y_MAX_MG_DL = 300.0

    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    private val bandPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1f
    }

    fun draw(
        canvas: Canvas,
        centerX: Float,
        centerY: Float,
        screenWidth: Float,
        lineColor: Int
    ) {
        val inWindow = GlycemiaHolder.getSparklinePoints12h()
        if (inWindow.size < 2) return

        val sparkW = screenWidth * 0.55f
        val sparkH = 24f
        val sparkLeft = centerX - sparkW / 2
        val sparkTop = centerY + 56f
        val now = System.currentTimeMillis()
        val windowStart = now - WINDOW_MS

        // In-range band (70–180 mg/dL) for context
        val y70 = yForMgDl(70.0, sparkTop, sparkH)
        val y180 = yForMgDl(180.0, sparkTop, sparkH)
        bandPaint.color = Color.argb(40, 129, 199, 132)
        canvas.drawLine(sparkLeft, y70, sparkLeft + sparkW, y70, bandPaint)
        canvas.drawLine(sparkLeft, y180, sparkLeft + sparkW, y180, bandPaint)

        val path = Path()
        var started = false
        for ((v, ts) in inWindow) {
            val xFrac = ((ts - windowStart).toFloat() / WINDOW_MS).coerceIn(0f, 1f)
            val x = sparkLeft + xFrac * sparkW
            val y = yForMgDl(v, sparkTop, sparkH)
            if (!started) {
                path.moveTo(x, y)
                started = true
            } else {
                path.lineTo(x, y)
            }
        }

        linePaint.strokeWidth = 2.5f
        linePaint.color = Color.argb(220, Color.red(lineColor), Color.green(lineColor), Color.blue(lineColor))
        canvas.drawPath(path, linePaint)
        linePaint.strokeWidth = 2f

        // 12h window labels
        val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(140, 255, 255, 255)
            textSize = 10f
            textAlign = Paint.Align.LEFT
        }
        canvas.drawText("-12h", sparkLeft, sparkTop + sparkH + 12f, labelPaint)
        labelPaint.textAlign = Paint.Align.RIGHT
        canvas.drawText("now", sparkLeft + sparkW, sparkTop + sparkH + 12f, labelPaint)
    }

    private fun yForMgDl(mgDl: Double, top: Float, height: Float): Float {
        val norm = ((mgDl - Y_MIN_MG_DL) / (Y_MAX_MG_DL - Y_MIN_MG_DL)).toFloat().coerceIn(0f, 1f)
        return top + height - norm * height
    }
}
