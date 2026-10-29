package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient
import kotlin.math.cos
import kotlin.math.sin

object BackgroundCanvasRenderer {
    private val overlayPaint = Paint()
    private val shapePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val gradientPaint = Paint()
    private val sweepMatrix = Matrix()

    fun draw(
        canvas: Canvas,
        bounds: Rect,
        isAmbient: Boolean,
        statusColor: Int,
        settings: BackgroundSettings,
        context: Context
    ) {
        if (isAmbient) {
            // True black keeps OLED pixels off in ambient mode
            canvas.drawColor(Color.BLACK)
            return
        }

        val w = bounds.width().toFloat()
        val h = bounds.height().toFloat()
        val cx = bounds.exactCenterX()
        val cy = bounds.exactCenterY()

        when (settings.type) {
            BackgroundType.SOLID -> canvas.drawColor(BackgroundPresets.solidColorFor(settings.solidColor))
            BackgroundType.GRADIENT -> drawGradient(canvas, bounds, settings.gradientId)
            BackgroundType.IMAGE -> drawImage(canvas, bounds, settings, context)
            BackgroundType.ANIMATED -> drawAnimated(canvas, bounds, cx, cy, w, h)
        }

        if (settings.statusTint) {
            drawStatusTint(canvas, cx, cy, w, h, statusColor)
        }
    }

    private fun drawGradient(canvas: Canvas, bounds: Rect, gradientId: String) {
        val preset = BackgroundPresets.gradientFor(gradientId)
        val paint = Paint()
        paint.shader = LinearGradient(
            bounds.left.toFloat(), bounds.top.toFloat(),
            bounds.right.toFloat(), bounds.bottom.toFloat(),
            preset.colors,
            null,
            Shader.TileMode.CLAMP
        )
        canvas.drawRect(bounds, paint)
    }

    private fun drawImage(canvas: Canvas, bounds: Rect, settings: BackgroundSettings, context: Context) {
        val activeId = settings.slideshowImageId()
        val bmp = BackgroundSettingsHolder.resolveImageBitmap(
            context,
            activeId,
            bounds.width(),
            bounds.height()
        )
        if (bmp != null) {
            val dst = RectF(bounds)
            canvas.drawBitmap(bmp, null, dst, null)
            overlayPaint.color = Color.argb(100, 0, 0, 0)
            canvas.drawRect(bounds, overlayPaint)
        } else {
            canvas.drawColor(Color.BLACK)
        }
    }

    /**
     * HUD backdrop: deep-space gradient, faint range rings and spokes, and a slow radar
     * sweep (one turn every 12 s). One shader per layer per frame; no bitmaps.
     */
    private fun drawAnimated(canvas: Canvas, bounds: Rect, cx: Float, cy: Float, w: Float, h: Float) {
        val now = System.currentTimeMillis()
        val r = minOf(w, h) / 2f
        val s = r / 227f

        gradientPaint.shader = RadialGradient(
            cx, cy * 0.85f, r * 1.25f,
            intArrayOf(Color.parseColor("#0B1830"), Color.parseColor("#050A16"), Color.BLACK),
            floatArrayOf(0f, 0.6f, 1f),
            Shader.TileMode.CLAMP
        )
        canvas.drawRect(bounds, gradientPaint)
        gradientPaint.shader = null

        // Range rings + spokes (static grid)
        shapePaint.style = Paint.Style.STROKE
        shapePaint.strokeWidth = 1f * s
        shapePaint.color = Color.argb(26, 0, 229, 255)
        for (i in 1..4) canvas.drawCircle(cx, cy, r * (0.22f + i * 0.17f), shapePaint)
        for (i in 0 until 12) {
            val a = Math.toRadians(i * 30.0)
            canvas.drawLine(
                cx + cos(a).toFloat() * r * 0.39f, cy + sin(a).toFloat() * r * 0.39f,
                cx + cos(a).toFloat() * r * 0.9f, cy + sin(a).toFloat() * r * 0.9f,
                shapePaint
            )
        }

        // Radar sweep: bright leading edge fading behind it
        val angle = (now % 12_000L) / 12_000f * 360f
        sweepMatrix.setRotate(angle, cx, cy)
        val sweep = SweepGradient(
            cx, cy,
            intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT, Color.argb(46, 0, 229, 255), Color.TRANSPARENT),
            floatArrayOf(0f, 0.82f, 0.995f, 1f)
        )
        sweep.setLocalMatrix(sweepMatrix)
        shapePaint.style = Paint.Style.FILL
        shapePaint.shader = sweep
        canvas.drawCircle(cx, cy, r * 0.9f, shapePaint)
        shapePaint.shader = null

        // A few slow-drifting data motes
        for (i in 0 until 6) {
            val t = now / 1000f
            val orbit = r * (0.45f + 0.07f * i)
            val a = t * (0.05f + 0.013f * i) + i * 1.7f
            val twinkle = 0.5f + 0.5f * sin(t * (0.9f + 0.2f * i) + i)
            shapePaint.color = Color.argb((40 + 70 * twinkle).toInt(), 157, 140, 255)
            canvas.drawCircle(cx + cos(a) * orbit, cy + sin(a) * orbit, (1.4f + twinkle) * s, shapePaint)
        }
    }

    private fun drawStatusTint(canvas: Canvas, cx: Float, cy: Float, w: Float, h: Float, statusColor: Int) {
        overlayPaint.shader = RadialGradient(
            cx, cy, w.coerceAtLeast(h) * 0.6f,
            intArrayOf(Color.argb(22, Color.red(statusColor), Color.green(statusColor), Color.blue(statusColor)), Color.TRANSPARENT),
            floatArrayOf(0f, 1f),
            Shader.TileMode.CLAMP
        )
        canvas.drawRect(0f, 0f, w, h, overlayPaint)
        overlayPaint.shader = null
    }
}
