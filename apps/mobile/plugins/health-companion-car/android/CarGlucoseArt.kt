package com.saffist3r.healthcompanion.car

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import kotlin.math.ln

/**
 * The HUD panel on the car screen, drawn in the app's style (the template only gives us one
 * picture): a gauge ring with the reading and trend badge, three stat tiles, and a 3-hour
 * chart with the target band and the dashed 30-minute forecast.
 */
object CarGlucoseArt {
    private const val W = 1200
    private const val H = 900

    private val NAVY = Color.parseColor("#070B14")
    private val PANEL = Color.parseColor("#0E1524")
    private val CYAN = Color.parseColor("#00E5FF")
    private val MINT = Color.parseColor("#2EF2B5")
    private val AMBER = Color.parseColor("#FFB547")
    private val RED = Color.parseColor("#FF4D6D")
    private val MUTED = Color.parseColor("#7C8AA5")
    private val GRAY = Color.parseColor("#4A5568")

    private val condensed = Typeface.create("sans-serif-condensed", Typeface.NORMAL)
    private val condensedBold = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val light = Typeface.create("sans-serif-light", Typeface.NORMAL)

    fun zoneColor(zone: GlucoseZone): Int = when (zone) {
        GlucoseZone.URGENT_LOW, GlucoseZone.LOW, GlucoseZone.VERY_HIGH -> RED
        GlucoseZone.IN_RANGE -> MINT
        GlucoseZone.HIGH -> AMBER
        GlucoseZone.UNKNOWN -> GRAY
    }

    fun render(history: List<GlucoseSample>, insight: GlucoseInsight, unit: String, now: Long): Bitmap {
        val bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(NAVY)
        val zone = if (insight.isStale) GlucoseZone.UNKNOWN else insight.zone
        val accent = zoneColor(zone)
        gauge(c, insight, unit, accent)
        tiles(c, insight, unit)
        chart(c, history, insight, now, accent)
        return bmp
    }

    /** Log-scale ring 40–400 mg/dL over 270°, coloured range segments, progress arc and knob. */
    private fun gauge(c: Canvas, insight: GlucoseInsight, unit: String, accent: Int) {
        val cx = 300f
        val cy = 300f
        val r = 230f
        val oval = RectF(cx - r, cy - r, cx + r, cy + r)
        val start = 135f
        val sweep = 270f
        fun angle(mg: Double): Float {
            val t = ((ln(mg.coerceIn(40.0, 400.0)) - ln(40.0)) / (ln(400.0) - ln(40.0))).toFloat()
            return start + t * sweep
        }

        val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 34f
            strokeCap = Paint.Cap.ROUND
            color = PANEL
        }
        c.drawArc(oval, start, sweep, false, track)

        // Thin outer band: where low / target / high sit on the ring
        val bandOval = RectF(cx - r - 34, cy - r - 34, cx + r + 34, cy + r + 34)
        val band = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 8f }
        listOf(
            Triple(40.0, CarGlucoseAlerts.LOW_MG_DL, RED),
            Triple(CarGlucoseAlerts.LOW_MG_DL, CarGlucoseAlerts.HIGH_MG_DL, MINT),
            Triple(CarGlucoseAlerts.HIGH_MG_DL, 250.0, AMBER),
            Triple(250.0, 400.0, RED),
        ).forEach { (from, to, color) ->
            band.color = color
            band.alpha = 150
            c.drawArc(bandOval, angle(from) + 1, angle(to) - angle(from) - 2, false, band)
        }

        val current = insight.current
        if (current != null) {
            val end = angle(current.mgDl)
            val progress = Paint(track).apply {
                shader = LinearGradient(cx - r, cy + r, cx + r, cy - r, withAlpha(accent, 90), accent, Shader.TileMode.CLAMP)
            }
            c.drawArc(oval, start, end - start, false, progress)
            val rad = Math.toRadians(end.toDouble())
            val kx = cx + r * Math.cos(rad).toFloat()
            val ky = cy + r * Math.sin(rad).toFloat()
            c.drawCircle(kx, ky, 30f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = withAlpha(accent, 70) })
            c.drawCircle(kx, ky, 18f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
        }

        val big = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = light
            textAlign = Paint.Align.CENTER
            color = if (insight.isStale) MUTED else Color.WHITE
            textSize = if (CarGlucoseText.isMmol(unit)) 170f else 190f
        }
        val valueText = current?.let { CarGlucoseText.value(it.mgDl, unit) } ?: "--"
        c.drawText(valueText, cx, cy + 50f, big)
        c.drawText(
            CarGlucoseText.unitLabel(unit),
            cx, cy + 105f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = condensed; textAlign = Paint.Align.CENTER; color = MUTED; textSize = 38f; letterSpacing = 0.08f
            }
        )

        // Trend badge under the number
        val label = when {
            current == null -> ""
            insight.isStale -> if (CarGlucoseText.fr) "PAS DE SIGNAL" else "NO SIGNAL"
            else -> "${CarGlucoseText.arrow(insight.arrow)}  ${CarGlucoseText.trendWord(insight.arrow).uppercase()}"
        }
        if (label.isNotEmpty()) {
            val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = condensedBold; textAlign = Paint.Align.CENTER; textSize = 34f; letterSpacing = 0.06f
                color = accent
            }
            val w = text.measureText(label) + 56f
            val pill = RectF(cx - w / 2, cy + 140f, cx + w / 2, cy + 196f)
            c.drawRoundRect(pill, 28f, 28f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = withAlpha(accent, 40) })
            c.drawRoundRect(pill, 28f, 28f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; strokeWidth = 3f; color = withAlpha(accent, 160)
            })
            c.drawText(label, cx, cy + 180f, text)
        }
    }

    private fun tiles(c: Canvas, insight: GlucoseInsight, unit: String) {
        val fr = CarGlucoseText.fr
        val forecast = insight.prediction.lastOrNull()
        val first = when {
            insight.isStale && insight.current != null -> Triple("SIGNAL", if (fr) "perdu" else "lost", AMBER)
            insight.minutesToLow != null ->
                Triple(if (fr) "HYPO DANS" else "LOW IN", "~${insight.minutesToLow} min", RED)
            insight.minutesToHigh != null ->
                Triple(if (fr) "HAUT DANS" else "HIGH IN", "~${insight.minutesToHigh} min", AMBER)
            forecast != null ->
                Triple(if (fr) "DANS 30 MIN" else "IN 30 MIN", "≈ ${CarGlucoseText.value(forecast.mgDl, unit)}", Color.WHITE)
            else -> Triple(if (fr) "DANS 30 MIN" else "IN 30 MIN", "—", MUTED)
        }
        val tir = insight.timeInRangePct
        val rows = listOf(
            first,
            Triple(if (fr) "DANS LA CIBLE · 3 H" else "IN RANGE · 3 H", tir?.let { "$it %" } ?: "—", if (tir == null) MUTED else Color.WHITE),
            Triple(
                if (fr) "MESURE" else "UPDATED",
                insight.current?.let { CarGlucoseText.ago(insight.ageMs) } ?: "—",
                if (insight.isStale) AMBER else Color.WHITE
            ),
        )
        val left = 640f
        val right = 1160f
        val tileH = 150f
        val gap = 22f
        val top = 60f
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = PANEL }
        val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = condensedBold; color = MUTED; textSize = 30f; letterSpacing = 0.12f
        }
        val valuePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = condensed; textSize = 66f }
        rows.forEachIndexed { i, (label, value, color) ->
            val y = top + i * (tileH + gap)
            c.drawRoundRect(RectF(left, y, right, y + tileH), 26f, 26f, bg)
            c.drawRoundRect(RectF(left, y + 28f, left + 8f, y + tileH - 28f), 4f, 4f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.color = if (color == Color.WHITE) CYAN else color
            })
            c.drawText(label, left + 40f, y + 52f, labelPaint)
            valuePaint.color = color
            c.drawText(value, left + 40f, y + 124f, valuePaint)
        }
    }

    private fun chart(c: Canvas, history: List<GlucoseSample>, insight: GlucoseInsight, now: Long, accent: Int) {
        val box = RectF(40f, 600f, 1160f, 860f)
        c.drawRoundRect(RectF(box.left - 16, box.top - 20, box.right + 16, box.bottom + 24), 26f, 26f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = PANEL })

        val start = now - 3L * 60 * 60 * 1000
        val end = now + 30L * 60 * 1000
        val samples = GlucoseTrendEngine.sanitize(history).filter { it.timestamp >= start }
        val all = samples + insight.prediction
        val minV = minOf(55.0, all.minOfOrNull { it.mgDl } ?: 55.0) - 10
        val maxV = maxOf(220.0, all.maxOfOrNull { it.mgDl } ?: 220.0) + 10
        fun x(t: Long) = box.left + (t - start).toFloat() / (end - start) * box.width()
        fun y(v: Double) = (box.bottom - (v - minV) / (maxV - minV) * box.height()).toFloat()

        c.drawRect(box.left, y(CarGlucoseAlerts.HIGH_MG_DL), box.right, y(CarGlucoseAlerts.LOW_MG_DL), Paint().apply { color = withAlpha(MINT, 26) })
        val guide = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = withAlpha(MINT, 90); strokeWidth = 2f; pathEffect = DashPathEffect(floatArrayOf(6f, 10f), 0f) }
        c.drawLine(box.left, y(CarGlucoseAlerts.HIGH_MG_DL), box.right, y(CarGlucoseAlerts.HIGH_MG_DL), guide)
        c.drawLine(box.left, y(CarGlucoseAlerts.LOW_MG_DL), box.right, y(CarGlucoseAlerts.LOW_MG_DL), guide)
        c.drawLine(x(now), box.top, x(now), box.bottom, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = withAlpha(Color.WHITE, 70); strokeWidth = 2f; pathEffect = DashPathEffect(floatArrayOf(8f, 8f), 0f)
        })

        val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = condensed; color = MUTED; textSize = 26f }
        c.drawText("−3 h", box.left, box.bottom + 2f, small.apply { textAlign = Paint.Align.LEFT })
        c.drawText(if (CarGlucoseText.fr) "maint." else "now", x(now), box.bottom + 2f, small.apply { textAlign = Paint.Align.CENTER })
        c.drawText("+30", box.right, box.bottom + 2f, small.apply { textAlign = Paint.Align.RIGHT })

        if (samples.size >= 2) {
            val line = Path()
            samples.forEachIndexed { i, s -> if (i == 0) line.moveTo(x(s.timestamp), y(s.mgDl)) else line.lineTo(x(s.timestamp), y(s.mgDl)) }
            val fill = Path(line).apply {
                lineTo(x(samples.last().timestamp), box.bottom)
                lineTo(x(samples.first().timestamp), box.bottom)
                close()
            }
            c.drawPath(fill, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                shader = LinearGradient(0f, box.top, 0f, box.bottom, withAlpha(CYAN, 90), withAlpha(CYAN, 0), Shader.TileMode.CLAMP)
            })
            c.drawPath(line, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = CYAN; style = Paint.Style.STROKE; strokeWidth = 6f; strokeJoin = Paint.Join.ROUND; strokeCap = Paint.Cap.ROUND
            })
        }
        val last = samples.lastOrNull() ?: return
        if (insight.prediction.isNotEmpty()) {
            val path = Path().apply { moveTo(x(last.timestamp), y(last.mgDl)) }
            insight.prediction.forEach { path.lineTo(x(it.timestamp), y(it.mgDl)) }
            c.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = withAlpha(CYAN, 170); style = Paint.Style.STROKE; strokeWidth = 5f
                strokeCap = Paint.Cap.ROUND; pathEffect = DashPathEffect(floatArrayOf(14f, 12f), 0f)
            })
        }
        c.drawCircle(x(last.timestamp), y(last.mgDl), 22f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = withAlpha(accent, 70) })
        c.drawCircle(x(last.timestamp), y(last.mgDl), 11f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent })
    }

    private fun withAlpha(color: Int, alpha: Int) = Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
}
