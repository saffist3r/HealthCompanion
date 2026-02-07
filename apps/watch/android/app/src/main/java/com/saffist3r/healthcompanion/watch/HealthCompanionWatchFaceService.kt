package com.saffist3r.healthcompanion.watch

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.Shader
import android.view.SurfaceHolder
import androidx.wear.watchface.CanvasType
import androidx.wear.watchface.ComplicationSlotsManager
import androidx.wear.watchface.Renderer
import androidx.wear.watchface.WatchFace
import androidx.wear.watchface.WatchFaceService
import androidx.wear.watchface.WatchFaceType
import androidx.wear.watchface.WatchState
import androidx.wear.watchface.style.CurrentUserStyleRepository
import androidx.wear.watchface.style.UserStyleSchema
import kotlin.concurrent.Volatile
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

class HealthCompanionWatchFaceService : WatchFaceService() {

    private val handler = Handler(Looper.getMainLooper())
    private val retryRunnable = object : Runnable {
        override fun run() {
            HeartRateMonitor.restart(applicationContext)
            StepsMonitor.restart(applicationContext)
            handler.postDelayed(this, 30_000L) // Retry every 30s (picks up permission grant)
        }
    }

    override fun onCreate() {
        super.onCreate()
        HeartRateMonitor.start(applicationContext)
        StepsMonitor.start(applicationContext)
        handler.postDelayed(retryRunnable, 5_000L) // First retry after 5s
    }

    override fun onDestroy() {
        handler.removeCallbacks(retryRunnable)
        HeartRateMonitor.stop()
        StepsMonitor.stop()
        super.onDestroy()
    }

    override fun createUserStyleSchema(): UserStyleSchema = UserStyleSchema(emptyList())

    override suspend fun createWatchFace(
        surfaceHolder: SurfaceHolder,
        watchState: WatchState,
        complicationSlotsManager: ComplicationSlotsManager,
        currentUserStyleRepository: CurrentUserStyleRepository
    ): WatchFace {
        val renderer = HealthCompanionRenderer(
            surfaceHolder,
            currentUserStyleRepository,
            watchState,
            CanvasType.SOFTWARE,
            0L
        )
        return WatchFace(WatchFaceType.DIGITAL, renderer)
    }

    override fun createComplicationSlotsManager(
        currentUserStyleRepository: CurrentUserStyleRepository
    ): ComplicationSlotsManager {
        // Complication slots can be added here - requires ComplicationSlot bounds,
        // CanvasComplicationFactory, and DefaultComplicationDataSourcePolicy
        return ComplicationSlotsManager(emptyList(), currentUserStyleRepository)
    }
}

class HealthCompanionRenderer(
    surfaceHolder: SurfaceHolder,
    currentUserStyleRepository: CurrentUserStyleRepository,
    private val watchState: WatchState,
    canvasType: Int,
    interactiveDrawModeUpdateDelayMillis: Long
) : Renderer.CanvasRenderer(
    surfaceHolder,
    currentUserStyleRepository,
    watchState,
    canvasType,
    interactiveDrawModeUpdateDelayMillis
) {
    private val timePaint = Paint().apply {
        isAntiAlias = true
        color = Color.WHITE
        textSize = 60f
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.NORMAL)
    }
    private val glycemiaPaint = Paint().apply {
        isAntiAlias = true
        textSize = 38f
        textAlign = Paint.Align.CENTER
        typeface = try {
            android.graphics.Typeface.create("sans-serif-light", android.graphics.Typeface.NORMAL)
        } catch (_: Exception) {
            android.graphics.Typeface.DEFAULT
        }
    }
    private val timeAgoPaint = Paint().apply {
        isAntiAlias = true
        color = Color.argb(180, 255, 255, 255)
        textSize = 22f
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.NORMAL)
    }
    private val datePaint = Paint().apply {
        isAntiAlias = true
        color = Color.argb(180, 255, 255, 255)
        textSize = 20f
        textAlign = Paint.Align.CENTER
    }
    private val statsPaint = Paint().apply {
        isAntiAlias = true
        color = Color.argb(180, 210, 210, 210)
        textSize = 24f
        textAlign = Paint.Align.CENTER
    }
    private val glowPaint = Paint().apply { isAntiAlias = true }
    private val shapePaint = Paint().apply { isAntiAlias = true }
    private val sparklinePaint = Paint().apply {
        isAntiAlias = true
        style = Paint.Style.STROKE
        strokeWidth = 2f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    private val defaultColor = Color.parseColor("#81C784")
    @Volatile private var glycemiaDisplay = "--"
    @Volatile private var timeAgoDisplay = ""
    @Volatile private var glycemiaColor = Color.parseColor("#81C784")
    @Volatile private var heartBpm: Int? = null
    @Volatile private var stepsCount: Int? = null

    init {
        Handler(Looper.getMainLooper()).post {
            GlycemiaHolder.glycemiaDisplay.observeForever { glycemiaDisplay = it ?: "--" }
            GlycemiaHolder.timeAgo.observeForever { timeAgoDisplay = it ?: "" }
            GlycemiaHolder.statusColor.observeForever { glycemiaColor = it ?: defaultColor }
            HeartRateHolder.bpm.observeForever { heartBpm = it }
            StepsHolder.steps.observeForever { stepsCount = it }
        }
    }

    override fun render(canvas: Canvas, bounds: Rect, zonedDateTime: ZonedDateTime) {
        try {
            if (bounds.width() <= 0 || bounds.height() <= 0) return

            val centerX = bounds.exactCenterX()
            val centerY = bounds.exactCenterY()
            val isAmbient = try {
                watchState.isAmbient.value == true
            } catch (e: Exception) {
                false
            }

            // Black background
            canvas.drawColor(Color.BLACK)

            if (!isAmbient) {
                // Animated floating shapes - faster drift
                val t = System.currentTimeMillis() / 1000f
                val w = bounds.width().toFloat()
                val h = bounds.height().toFloat()
                val colors = intArrayOf(
                    Color.argb(40, 77, 208, 225),   // teal
                    Color.argb(30, 255, 171, 145),  // coral
                    Color.argb(25, 179, 157, 219),  // lavender
                    Color.argb(35, 129, 199, 132)   // green
                )
                val baseRadii = floatArrayOf(38f, 22f, 48f, 28f, 42f, 18f, 52f, 32f, 45f, 25f)
                for (i in 0..9) {
                    val phaseH = t * (0.55f + i * 0.08f) + i * 1.2f
                    val phaseV = t * (0.45f + i * 0.06f) + i * 0.7f
                    val x = centerX + (w * 0.45f) * kotlin.math.sin(phaseH)
                    val y = centerY + (h * 0.4f) * kotlin.math.cos(phaseV * 1.1f + i * 0.5f)
                    val baseR = baseRadii[i % baseRadii.size]
                    val radius = baseR + 6f * kotlin.math.sin(t * 0.3f + i * 0.8f).toFloat()
                    shapePaint.color = colors[i % colors.size]
                    canvas.drawCircle(x, y, radius.coerceAtLeast(12f), shapePaint)
                }

                // Sparkline (glycemia trend) - oldest left, newest right
                val history = GlycemiaHolder.getHistoryForSparkline().reversed()
                if (history.size >= 2) {
                    val sparkW = w * 0.55f
                    val sparkH = 24f
                    val sparkLeft = centerX - sparkW / 2
                    val sparkTop = centerY + 56f
                    val min = history.minOrNull() ?: 0.0
                    val max = history.maxOrNull() ?: 100.0
                    val range = (max - min).coerceAtLeast(20.0)
                    val path = Path()
                    val stepX = sparkW / (history.size - 1).coerceAtLeast(1)
                    for ((i, v) in history.withIndex()) {
                        val x = sparkLeft + i * stepX
                        val norm = ((v - min) / range).toFloat().coerceIn(0f, 1f)
                        val y = sparkTop + sparkH - norm * sparkH
                        if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                    }
                    sparklinePaint.strokeWidth = 2.5f
                    sparklinePaint.color = Color.argb(200, Color.red(glycemiaColor), Color.green(glycemiaColor), Color.blue(glycemiaColor))
                    canvas.drawPath(path, sparklinePaint)
                    sparklinePaint.strokeWidth = 2f
                }

                // Glow pulse
                val pulse = 0.6f + 0.4f * kotlin.math.sin(2 * Math.PI * System.currentTimeMillis() / 2500).toFloat()
                val haloRadius = 44f + 10f * pulse
                val glowColors = intArrayOf(
                    Color.argb((35 * pulse).toInt(), Color.red(glycemiaColor), Color.green(glycemiaColor), Color.blue(glycemiaColor)),
                    Color.TRANSPARENT
                )
                glowPaint.shader = RadialGradient(centerX, centerY + 8f, haloRadius, glowColors, floatArrayOf(0.3f, 1f), Shader.TileMode.CLAMP)
                canvas.drawCircle(centerX, centerY + 8f, haloRadius, glowPaint)
                glowPaint.shader = null

                glycemiaPaint.color = glycemiaColor
                glycemiaPaint.setShadowLayer(8f + 4f * pulse, 0f, 0f, glycemiaColor)
                timeAgoPaint.color = Color.argb(200, 255, 255, 255)
            } else {
                timePaint.color = Color.argb(179, 255, 255, 255)
                glycemiaPaint.color = Color.argb(179, 255, 255, 255)
                glycemiaPaint.setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
                timeAgoPaint.color = Color.argb(128, 255, 255, 255)
            }

            timePaint.color = Color.WHITE
            timePaint.setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)

            // Time (big)
            val timeStr = zonedDateTime.format(DateTimeFormatter.ofPattern("HH:mm"))
            canvas.drawText(timeStr, centerX, centerY - 66f, timePaint)

            // Date under time, smaller (dd/MM/yyyy)
            val dateStr = zonedDateTime.format(DateTimeFormatter.ofPattern("dd/MM/yyyy"))
            if (isAmbient) datePaint.color = Color.argb(140, 255, 255, 255)
            canvas.drawText(dateStr, centerX, centerY - 34f, datePaint)
            if (isAmbient) datePaint.color = Color.argb(180, 255, 255, 255)

            if (!isAmbient) glycemiaPaint.color = glycemiaColor
            canvas.drawText(glycemiaDisplay, centerX, centerY + 16f, glycemiaPaint)

            if (timeAgoDisplay.isNotEmpty()) {
                canvas.drawText(timeAgoDisplay, centerX, centerY + 46f, timeAgoPaint)
            }

            // Stats row under chart: heart + steps (bigger, readable)
            val statsY = centerY + 112f
            statsPaint.textSize = 22f
            if (isAmbient) statsPaint.color = Color.argb(140, 220, 220, 220)
            val hrStr = heartBpm?.let { "♥ $it" } ?: "♥ --"
            val stepsStr = stepsCount?.let { "👣 %,d".format(it) } ?: "👣 --"
            val statsText = "$hrStr   $stepsStr"
            canvas.drawText(statsText, centerX, statsY, statsPaint)
            if (isAmbient) statsPaint.color = Color.argb(180, 210, 210, 210)
            statsPaint.textSize = 24f
        } catch (e: Exception) {
            Log.e("HCWatchFace", "Render error", e)
            canvas.drawColor(Color.BLACK)
        }
    }

    override fun renderHighlightLayer(
        canvas: Canvas,
        bounds: Rect,
        zonedDateTime: ZonedDateTime
    ) {
        // No highlight layer
    }
}
