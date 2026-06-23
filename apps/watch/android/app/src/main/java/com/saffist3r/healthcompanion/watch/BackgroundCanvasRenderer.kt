package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import kotlin.math.cos
import kotlin.math.sin

object BackgroundCanvasRenderer {
    private val overlayPaint = Paint()
    private val shapePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val gradientPaint = Paint()

    fun draw(
        canvas: Canvas,
        bounds: Rect,
        isAmbient: Boolean,
        statusColor: Int,
        settings: BackgroundSettings,
        context: Context
    ) {
        if (isAmbient) {
            canvas.drawColor(Color.parseColor("#0A1628"))
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

    private fun drawAnimated(canvas: Canvas, bounds: Rect, cx: Float, cy: Float, w: Float, h: Float) {
        val t = System.currentTimeMillis() / 1000f
        val pulse = 0.78f + 0.22f * sin(t * 1.4).toFloat()

        // Single static base gradient (cheap — one shader per frame)
        gradientPaint.shader = LinearGradient(
            0f, 0f, w, h,
            intArrayOf(Color.parseColor("#0A1628"), Color.parseColor("#152A4A")),
            null,
            Shader.TileMode.CLAMP
        )
        canvas.drawRect(bounds, gradientPaint)
        gradientPaint.shader = null

        // Four soft orbs — solid circles, no per-orb shaders
        val orbColors = intArrayOf(
            Color.argb((52 * pulse).toInt(), 77, 208, 225),
            Color.argb((46 * pulse).toInt(), 179, 157, 219),
            Color.argb((44 * pulse).toInt(), 129, 199, 132),
            Color.argb((48 * pulse).toInt(), 255, 171, 145)
        )
        val baseRadii = floatArrayOf(36f, 28f, 42f, 32f)
        for (i in 0..3) {
            val phaseH = t * (0.38f + i * 0.09f) + i * 1.4f
            val phaseV = t * (0.32f + i * 0.07f) + i * 0.85f
            val x = cx + w * 0.4f * sin(phaseH)
            val y = cy + h * 0.36f * cos(phaseV)
            val radius = baseRadii[i] + 6f * sin(t * 0.35f + i * 0.6f)
            shapePaint.color = orbColors[i]
            canvas.drawCircle(x, y, radius.coerceAtLeast(20f), shapePaint)
        }
    }

    private fun drawStatusTint(canvas: Canvas, cx: Float, cy: Float, w: Float, h: Float, statusColor: Int) {
        overlayPaint.shader = RadialGradient(
            cx, cy, w.coerceAtLeast(h),
            intArrayOf(Color.argb(38, Color.red(statusColor), Color.green(statusColor), Color.blue(statusColor)), Color.TRANSPARENT),
            floatArrayOf(0.2f, 1f),
            Shader.TileMode.CLAMP
        )
        canvas.drawRect(0f, 0f, w, h, overlayPaint)
        overlayPaint.shader = null
    }
}
