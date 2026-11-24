package com.saffist3r.healthcompanion.car

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.CarIcon
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * The car screen: two short rows (reading, forecast) next to the HUD panel from
 * [CarGlucoseArt]. Redraws on every new reading and once a minute for the age.
 */
class GlucoseCarScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
    private val handler = Handler(Looper.getMainLooper())
    private val listener = CarGlucoseStore.Listener { handler.post { invalidate() } }
    private val tick = object : Runnable {
        override fun run() {
            invalidate()
            handler.postDelayed(this, 60_000)
        }
    }

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        CarGlucoseStore.addListener(listener)
        handler.postDelayed(tick, 60_000)
    }

    override fun onStop(owner: LifecycleOwner) {
        CarGlucoseStore.removeListener(listener)
        handler.removeCallbacks(tick)
    }

    override fun onGetTemplate(): Template {
        val model = CarGlucoseModel.build(CarGlucoseStore.snapshot(carContext), System.currentTimeMillis())
        val pane = Pane.Builder()
        model.rows.forEachIndexed { i, (title, text) ->
            val row = Row.Builder().setTitle(title)
            if (text != null) row.addText(text)
            if (i == 0 && model.insight.current != null) row.setImage(dot(CarGlucoseArt.zoneColor(model.zone)))
            pane.addRow(row.build())
        }
        if (model.insight.current != null && carContext.carAppApiLevel >= 4) {
            pane.setImage(CarIcon.Builder(IconCompat.createWithBitmap(model.art())).build())
        }
        return PaneTemplate.Builder(pane.build())
            .setTitle("HealthCompanion")
            .build()
    }

    private fun dot(color: Int): CarIcon {
        val size = 96
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        Canvas(bmp).drawCircle(size / 2f, size / 2f, size * 0.36f, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color })
        return CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build()
    }
}

/** What the car screen shows, also used by the phone app's Android Auto preview. */
class CarGlucoseModel private constructor(
    val snapshot: CarGlucoseStore.Snapshot,
    val insight: GlucoseInsight,
    val now: Long,
    val rows: List<Pair<String, String?>>,
) {
    val zone: GlucoseZone get() = if (insight.isStale) GlucoseZone.UNKNOWN else insight.zone

    fun art(): Bitmap = CarGlucoseArt.render(snapshot.history, insight, snapshot.unit, now)

    companion object {
        fun build(snapshot: CarGlucoseStore.Snapshot, now: Long): CarGlucoseModel {
            val fr = CarGlucoseText.fr
            val unit = snapshot.unit
            val insight = GlucoseTrendEngine.analyze(
                snapshot.history, now, CarGlucoseAlerts.LOW_MG_DL, CarGlucoseAlerts.HIGH_MG_DL
            )
            val current = insight.current
            val rows = mutableListOf<Pair<String, String?>>()
            if (current == null) {
                rows += (if (fr) "Pas encore de glycémie" else "No glucose yet") to
                    (if (fr) "Elle s’affiche dès que CamAPS envoie une mesure." else "It shows up as soon as CamAPS sends a reading.")
            } else {
                val zone = if (insight.isStale) GlucoseZone.UNKNOWN else insight.zone
                val headline = buildString {
                    append(CarGlucoseText.withUnit(current.mgDl, unit))
                    if (!insight.isStale && insight.arrow != TrendArrow.NONE) append("  ").append(CarGlucoseText.arrow(insight.arrow))
                }
                val status = if (insight.isStale) {
                    (if (fr) "Pas de nouvelle mesure · " else "No new reading · ") + CarGlucoseText.ago(insight.ageMs)
                } else {
                    listOf(CarGlucoseText.zoneWord(zone), CarGlucoseText.ago(insight.ageMs)).filter { it.isNotEmpty() }.joinToString(" · ")
                }
                rows += headline to status
                val forecast = insight.prediction.lastOrNull()
                val next = when {
                    insight.minutesToLow != null -> if (fr) "Hypo dans ~${insight.minutesToLow} min" else "Low in ~${insight.minutesToLow} min"
                    insight.minutesToHigh != null -> if (fr) "Haut dans ~${insight.minutesToHigh} min" else "High in ~${insight.minutesToHigh} min"
                    forecast != null -> (if (fr) "Dans 30 min ≈ " else "In 30 min ≈ ") + CarGlucoseText.withUnit(forecast.mgDl, unit)
                    else -> null
                }
                if (next != null) rows += next to CarGlucoseText.trendWord(insight.arrow)
            }
            return CarGlucoseModel(snapshot, insight, now, rows)
        }

        /** A falling-toward-low sample, for the preview before any reading has arrived. */
        fun demo(now: Long): CarGlucoseModel {
            val history = (36 downTo 0).map { i ->
                val m = i * 5.0
                GlucoseSample(96 + m * 0.75 - 10 * kotlin.math.sin(m / 25.0), now - 60_000 - (m * 60_000).toLong())
            }
            return build(CarGlucoseStore.Snapshot("mg/dL", history), now)
        }
    }
}
