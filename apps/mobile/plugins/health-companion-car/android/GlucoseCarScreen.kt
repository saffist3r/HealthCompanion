package com.saffist3r.healthcompanion.car

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
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
 * The car screen: current glucose with trend arrow, how old it is, the 30-minute forecast and
 * the last 3 hours as a small chart. Redraws on every new reading and once a minute for the age.
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
        val fr = CarGlucoseText.fr
        val snapshot = CarGlucoseStore.snapshot(carContext)
        val now = System.currentTimeMillis()
        val insight = GlucoseTrendEngine.analyze(
            snapshot.history, now, CarGlucoseAlerts.LOW_MG_DL, CarGlucoseAlerts.HIGH_MG_DL
        )
        val unit = snapshot.unit
        val pane = Pane.Builder()
        val current = insight.current

        if (current == null) {
            pane.addRow(
                Row.Builder()
                    .setTitle(if (fr) "Pas encore de glycémie" else "No glucose yet")
                    .addText(if (fr) "Elle s’affiche dès que CamAPS envoie une mesure." else "It shows up as soon as CamAPS sends a reading.")
                    .build()
            )
        } else {
            val headline = buildString {
                append(CarGlucoseText.withUnit(current.mgDl, unit))
                if (!insight.isStale && insight.arrow != TrendArrow.NONE) append("  ").append(CarGlucoseText.arrow(insight.arrow))
            }
            val status = if (insight.isStale) {
                (if (fr) "Pas de nouvelle mesure · " else "No new reading · ") + CarGlucoseText.ago(insight.ageMs)
            } else {
                listOf(CarGlucoseText.zoneWord(insight.zone), CarGlucoseText.trendWord(insight.arrow), CarGlucoseText.ago(insight.ageMs))
                    .filter { it.isNotEmpty() }
                    .joinToString(" · ")
            }
            pane.addRow(
                Row.Builder()
                    .setTitle(headline)
                    .addText(status)
                    .setImage(dot(zoneColor(if (insight.isStale) GlucoseZone.UNKNOWN else insight.zone)))
                    .build()
            )

            val forecast = insight.prediction.lastOrNull()
            if (forecast != null) {
                val warning = when {
                    insight.minutesToLow != null -> if (fr) "Hypo dans ~${insight.minutesToLow} min" else "Low in ~${insight.minutesToLow} min"
                    insight.minutesToHigh != null -> if (fr) "Haut dans ~${insight.minutesToHigh} min" else "High in ~${insight.minutesToHigh} min"
                    else -> null
                }
                pane.addRow(
                    Row.Builder()
                        .setTitle((if (fr) "Dans 30 min ≈ " else "In 30 min ≈ ") + CarGlucoseText.withUnit(forecast.mgDl, unit))
                        .apply { if (warning != null) addText(warning) }
                        .build()
                )
            }

            insight.timeInRangePct?.let { tir ->
                pane.addRow(
                    Row.Builder()
                        .setTitle((if (fr) "Dans la cible (3 h) : " else "In range (3 h): ") + "$tir %")
                        .build()
                )
            }

            if (carContext.carAppApiLevel >= 4 && snapshot.history.size >= 2) {
                pane.setImage(CarIcon.Builder(IconCompat.createWithBitmap(chart(snapshot.history, insight, now))).build())
            }
        }

        return PaneTemplate.Builder(pane.build())
            .setTitle("HealthCompanion")
            .build()
    }

    private fun zoneColor(zone: GlucoseZone): Int = when (zone) {
        GlucoseZone.URGENT_LOW, GlucoseZone.LOW -> RED
        GlucoseZone.IN_RANGE -> MINT
        GlucoseZone.HIGH -> AMBER
        GlucoseZone.VERY_HIGH -> RED
        GlucoseZone.UNKNOWN -> Color.GRAY
    }

    private fun dot(color: Int): CarIcon {
        val size = 96
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
        Canvas(bmp).drawCircle(size / 2f, size / 2f, size * 0.36f, paint)
        return CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build()
    }

    /** Last 3 h with the target band, the 30-min forecast dashed, latest dot in its zone colour. */
    private fun chart(history: List<GlucoseSample>, insight: GlucoseInsight, now: Long): Bitmap {
        val w = 960
        val h = 480
        val pad = 24f
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(NAVY)

        val start = now - 3L * 60 * 60 * 1000
        val end = now + 30L * 60 * 1000
        val samples = GlucoseTrendEngine.sanitize(history).filter { it.timestamp >= start }
        val all = samples + insight.prediction
        val minV = minOf(55.0, all.minOfOrNull { it.mgDl } ?: 55.0) - 10
        val maxV = maxOf(220.0, all.maxOfOrNull { it.mgDl } ?: 220.0) + 10
        fun x(t: Long) = pad + (t - start).toFloat() / (end - start) * (w - 2 * pad)
        fun y(v: Double) = (h - pad - (v - minV) / (maxV - minV) * (h - 2 * pad)).toFloat()

        val band = Paint().apply { color = Color.argb(40, 46, 242, 181) }
        c.drawRect(pad, y(CarGlucoseAlerts.HIGH_MG_DL), w - pad, y(CarGlucoseAlerts.LOW_MG_DL), band)
        val guide = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(90, 255, 255, 255)
            strokeWidth = 2f
            pathEffect = DashPathEffect(floatArrayOf(10f, 10f), 0f)
        }
        c.drawLine(x(now), pad, x(now), h - pad, guide)

        val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = CYAN
            style = Paint.Style.STROKE
            strokeWidth = 7f
            strokeJoin = Paint.Join.ROUND
            strokeCap = Paint.Cap.ROUND
        }
        if (samples.size >= 2) {
            val path = Path()
            samples.forEachIndexed { i, s ->
                if (i == 0) path.moveTo(x(s.timestamp), y(s.mgDl)) else path.lineTo(x(s.timestamp), y(s.mgDl))
            }
            c.drawPath(path, line)
        }
        val last = samples.lastOrNull()
        if (last != null && insight.prediction.isNotEmpty()) {
            val path = Path().apply { moveTo(x(last.timestamp), y(last.mgDl)) }
            insight.prediction.forEach { path.lineTo(x(it.timestamp), y(it.mgDl)) }
            c.drawPath(path, Paint(line).apply {
                alpha = 150
                strokeWidth = 5f
                pathEffect = DashPathEffect(floatArrayOf(16f, 12f), 0f)
            })
        }
        if (last != null) {
            val zone = if (insight.isStale) GlucoseZone.UNKNOWN else insight.zone
            c.drawCircle(x(last.timestamp), y(last.mgDl), 14f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = zoneColor(zone) })
        }
        return bmp
    }

    private companion object {
        val NAVY = Color.parseColor("#070B14")
        val CYAN = Color.parseColor("#00E5FF")
        val MINT = Color.parseColor("#2EF2B5")
        val AMBER = Color.parseColor("#FFB547")
        val RED = Color.parseColor("#FF4D6D")
    }
}
