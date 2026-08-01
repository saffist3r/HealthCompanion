package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
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
    private val stepsFlushRunnable = object : Runnable {
        override fun run() {
            StepsMonitor.flush()
            handler.postDelayed(this, 60_000L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        GlycemiaHolder.init(applicationContext)
        BackgroundSettingsHolder.init(applicationContext)
        StepsHolder.bind(applicationContext)
        HeartRateMonitor.start(applicationContext)
        StepsMonitor.start(applicationContext)
        handler.postDelayed(retryRunnable, 5_000L) // First retry after 5s
        handler.postDelayed(stepsFlushRunnable, 10_000L)
    }

    override fun onDestroy() {
        handler.removeCallbacks(retryRunnable)
        handler.removeCallbacks(stepsFlushRunnable)
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
            applicationContext,
            surfaceHolder,
            currentUserStyleRepository,
            watchState,
            CanvasType.SOFTWARE,
            1000L
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
    private val appContext: Context,
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
        textSize = 68f
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private val glycemiaPaint = Paint().apply {
        isAntiAlias = true
        textSize = 46f
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
        textSize = 26f
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.NORMAL)
    }
    private val datePaint = Paint().apply {
        isAntiAlias = true
        color = Color.argb(180, 255, 255, 255)
        textSize = 24f
        textAlign = Paint.Align.CENTER
    }
    private val statsPaint = Paint().apply {
        isAntiAlias = true
        color = Color.argb(180, 210, 210, 210)
        textSize = 28f
        textAlign = Paint.Align.LEFT
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private val glowPaint = Paint().apply { isAntiAlias = true }

    private val defaultColor = Color.parseColor("#81C784")
    @Volatile private var glycemiaDisplay = "--"
    @Volatile private var timeAgoDisplay = ""
    @Volatile private var glycemiaColor = Color.parseColor("#81C784")
    @Volatile private var heartBpm: Int? = null
    @Volatile private var stepsCount: Int? = null
    @Volatile private var backgroundSettings = BackgroundSettings()
    private val tickHandler = Handler(Looper.getMainLooper())
    private val tickRunnable = object : Runnable {
        override fun run() {
            val settings = backgroundSettings
            val trend = GlycemiaTrendDetector.detect()
            val isAmbient = try {
                watchState.isAmbient.value == true
            } catch (_: Exception) {
                false
            }
            val needsArrowTick = !isAmbient && trend != GlycemiaTrend.UNKNOWN
            val needsFastTick = settings.type == BackgroundType.ANIMATED ||
                (settings.type == BackgroundType.IMAGE && settings.effectiveImageIds().size > 1) ||
                needsArrowTick
            if (needsFastTick) {
                invalidate()
            }
            val delayMs = when {
                needsArrowTick -> 80L
                settings.type == BackgroundType.ANIMATED -> 350L
                settings.type == BackgroundType.IMAGE && settings.effectiveImageIds().size > 1 ->
                    1000L
                else -> 60_000L
            }
            tickHandler.postDelayed(this, delayMs)
        }
    }

    init {
        Handler(Looper.getMainLooper()).post {
            GlycemiaHolder.glycemiaDisplay.observeForever { glycemiaDisplay = it ?: "--" }
            GlycemiaHolder.timeAgo.observeForever { timeAgoDisplay = it ?: "" }
            GlycemiaHolder.statusColor.observeForever { glycemiaColor = it ?: defaultColor }
            BackgroundSettingsHolder.settings.observeForever { backgroundSettings = it ?: BackgroundSettings() }
            HeartRateHolder.bpm.observeForever { heartBpm = it }
            StepsHolder.steps.observeForever { stepsCount = it }
        }
        tickHandler.postDelayed(tickRunnable, 1000L)
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

            val w = bounds.width().toFloat()
            val h = bounds.height().toFloat()

            BackgroundCanvasRenderer.draw(
                canvas,
                bounds,
                isAmbient,
                glycemiaColor,
                backgroundSettings,
                appContext
            )

            if (!isAmbient) {
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
            } else {
                glycemiaPaint.color = Color.argb(179, 255, 255, 255)
                glycemiaPaint.setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
            }

            val textBase = BackgroundPresets.solidColorFor(backgroundSettings.textColor)
            val textAlpha = if (isAmbient) 179 else 255
            timePaint.color = Color.argb(textAlpha, Color.red(textBase), Color.green(textBase), Color.blue(textBase))
            timePaint.setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
            datePaint.color = Color.argb((textAlpha * 0.75f).toInt(), Color.red(textBase), Color.green(textBase), Color.blue(textBase))
            timeAgoPaint.color = Color.argb((textAlpha * 0.8f).toInt(), Color.red(textBase), Color.green(textBase), Color.blue(textBase))
            statsPaint.color = Color.argb((textAlpha * 0.82f).toInt(), Color.red(textBase), Color.green(textBase), Color.blue(textBase))

            // Time (big)
            val timeStr = zonedDateTime.format(DateTimeFormatter.ofPattern("HH:mm"))
            canvas.drawText(timeStr, centerX, centerY - 74f, timePaint)

            // Date under time
            val dateStr = zonedDateTime.format(DateTimeFormatter.ofPattern("dd/MM/yyyy"))
            canvas.drawText(dateStr, centerX, centerY - 36f, datePaint)

            if (!isAmbient) glycemiaPaint.color = glycemiaColor
            canvas.drawText(glycemiaDisplay, centerX, centerY + 14f, glycemiaPaint)

            if (timeAgoDisplay.isNotEmpty()) {
                canvas.drawText(timeAgoDisplay, centerX, centerY + 48f, timeAgoPaint)
            }

            val trend = GlycemiaTrendDetector.detect()
            if (trend != GlycemiaTrend.UNKNOWN) {
                TrendArrowRenderer.draw(
                    canvas,
                    centerX,
                    centerY + 62f,
                    trend,
                    glycemiaColor,
                    isAmbient
                )
            }

            // Stats: heart left, steps right
            val statsY = centerY + 118f
            statsPaint.textSize = 28f
            StatsIconsRenderer.drawStatsRow(
                canvas,
                centerX,
                statsY,
                w,
                heartBpm,
                stepsCount,
                statsPaint
            )
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
