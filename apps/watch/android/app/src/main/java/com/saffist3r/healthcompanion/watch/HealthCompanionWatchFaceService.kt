package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
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
import java.time.ZonedDateTime

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
    @Volatile private var heartBpm: Int? = null
    @Volatile private var stepsCount: Int? = null
    @Volatile private var backgroundSettings = BackgroundSettings()

    /** Trend analysis is cheap but only changes when a reading arrives or the minute rolls over. */
    private var cachedInsight = GlucoseInsight.EMPTY
    private var cachedHistory = emptyList<GlucoseSample>()
    private var cachedRevision = -1
    private var cachedMinute = -1L

    init {
        Handler(Looper.getMainLooper()).post {
            BackgroundSettingsHolder.settings.observeForever {
                backgroundSettings = it ?: BackgroundSettings()
                // Radar sweep needs ~10 fps; everything else only changes each second.
                this.interactiveDrawModeUpdateDelayMillis =
                    if (backgroundSettings.type == BackgroundType.ANIMATED) 100L else 1000L
            }
            HeartRateHolder.bpm.observeForever { heartBpm = it }
            StepsHolder.steps.observeForever { stepsCount = it }
        }
    }

    private fun insightFor(nowMs: Long): GlucoseInsight {
        val revision = GlycemiaHolder.historyRevision.value ?: 0
        val minute = nowMs / 60_000
        if (revision != cachedRevision || minute != cachedMinute) {
            cachedHistory = GlycemiaHolder.samples()
            cachedInsight = GlucoseTrendEngine.analyze(cachedHistory, nowMs)
            cachedRevision = revision
            cachedMinute = minute
        }
        return cachedInsight
    }

    override fun render(canvas: Canvas, bounds: Rect, zonedDateTime: ZonedDateTime) {
        try {
            if (bounds.width() <= 0 || bounds.height() <= 0) return
            val isAmbient = watchState.isAmbient.value == true
            val nowMs = zonedDateTime.toInstant().toEpochMilli()
            val insight = insightFor(nowMs)
            val settings = backgroundSettings

            BackgroundCanvasRenderer.draw(
                canvas,
                bounds,
                isAmbient,
                HudFaceDrawer.zoneColor(if (insight.isStale) GlucoseZone.UNKNOWN else insight.zone),
                settings,
                appContext
            )
            HudFaceDrawer.draw(
                canvas,
                bounds,
                FaceState(
                    time = zonedDateTime,
                    nowMs = nowMs,
                    insight = insight,
                    history = cachedHistory,
                    displayUnit = GlycemiaHolder.displayUnit,
                    heartBpm = heartBpm,
                    steps = stepsCount,
                    textColor = BackgroundPresets.solidColorFor(settings.textColor),
                    isAmbient = isAmbient
                )
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
