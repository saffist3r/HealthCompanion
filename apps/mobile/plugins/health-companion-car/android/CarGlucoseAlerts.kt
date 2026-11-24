package com.saffist3r.healthcompanion.car

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.car.app.connection.CarConnection
import androidx.car.app.notification.CarAppExtender
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Car notifications while Android Auto is connected, shown over Waze / music without opening
 * the app: low / going-low / very-high alerts (with sound), and silent updates when the range
 * or the trend changes. Off the car, the phone's own notifications and the watch cover this.
 */
object CarGlucoseAlerts {
    const val LOW_MG_DL = 70.0
    const val HIGH_MG_DL = 180.0

    private const val CHANNEL = "hc-car-alerts"
    private const val UPDATE_CHANNEL = "hc-car-updates"
    private const val NOTIFICATION_ID = 4710
    private const val UPDATE_ID = 4711
    private const val UPDATE_PREFS = "hc_car_updates"
    private const val TREND_UPDATE_GAP_MS = 10L * 60 * 1000
    private const val PREFS = "hc_car_alerts"
    private const val REPEAT_MS = 20L * 60 * 1000
    private const val GOING_LOW_WITHIN_MIN = 20

    @Volatile
    private var projected = false

    @Volatile
    private var watching = false

    /** Follow whether Android Auto is projecting; called from the bridge and the car session. */
    fun watchConnection(context: Context) {
        if (watching) return
        watching = true
        val app = context.applicationContext
        Handler(Looper.getMainLooper()).post {
            CarConnection(app).type.observeForever { type ->
                val was = projected
                projected = type == CarConnection.CONNECTION_TYPE_PROJECTION
                // New drive: the first reading sets the baseline instead of posting an update
                if (projected && !was) app.getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE).edit().clear().apply()
            }
        }
    }

    fun markProjected() {
        projected = true
    }

    fun check(context: Context, history: List<GlucoseSample>, unit: String) {
        watchConnection(context)
        if (!projected) return
        val insight = GlucoseTrendEngine.analyze(history, System.currentTimeMillis(), LOW_MG_DL, HIGH_MG_DL)
        val current = insight.current ?: return
        if (insight.isStale) return
        val fr = CarGlucoseText.fr
        val now = CarGlucoseText.withUnit(current.mgDl, unit) + " " + CarGlucoseText.arrow(insight.arrow)
        val (kind, title) = when {
            insight.zone == GlucoseZone.URGENT_LOW || insight.zone == GlucoseZone.LOW ->
                "low" to (if (fr) "Hypo : $now" else "Low: $now")
            insight.minutesToLow != null && insight.minutesToLow <= GOING_LOW_WITHIN_MIN ->
                "fallingLow" to (if (fr) "Hypo dans ~${insight.minutesToLow} min" else "Low in ~${insight.minutesToLow} min")
            insight.zone == GlucoseZone.VERY_HIGH ->
                "veryHigh" to (if (fr) "Très haut : $now" else "Very high: $now")
            else -> {
                clear(context)
                maybeUpdate(context, insight, unit, now)
                return
            }
        }
        val body = when (kind) {
            "fallingLow" -> (if (fr) "Maintenant $now. Gardez du sucre à portée." else "Now $now. Keep sugar close.")
            "low" -> if (fr) "Arrêtez-vous dès que possible et resucrez-vous." else "Pull over when safe and treat it."
            else -> CarGlucoseText.trendWord(insight.arrow)
        }
        // An alert already says it all; remember the state so no update repeats it.
        remember(context, insight)
        if (!due(context, kind)) return
        notify(context, CHANNEL, NOTIFICATION_ID, title, body)
    }

    /** Coarse trend so 45° wobble between readings doesn't post an update each time. */
    private fun trendGroup(arrow: TrendArrow) = when (arrow) {
        TrendArrow.DOUBLE_UP -> "fastUp"
        TrendArrow.SINGLE_UP, TrendArrow.FORTY_FIVE_UP -> "up"
        TrendArrow.FLAT -> "flat"
        TrendArrow.FORTY_FIVE_DOWN, TrendArrow.SINGLE_DOWN -> "down"
        TrendArrow.DOUBLE_DOWN -> "fastDown"
        TrendArrow.NONE -> "none"
    }

    private fun remember(context: Context, insight: GlucoseInsight) {
        context.getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE).edit()
            .putString("zone", insight.zone.name)
            .putString("trend", trendGroup(insight.arrow))
            .apply()
    }

    /**
     * Silent update when the reading moves into another range (in range ↔ high, back from a low)
     * or the trend changes (steady → falling, rising fast...). Range changes post right away;
     * trend changes at most every 10 minutes. The first reading of a drive only sets the baseline.
     */
    private fun maybeUpdate(context: Context, insight: GlucoseInsight, unit: String, now: String) {
        val prefs = context.getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE)
        val lastZone = prefs.getString("zone", null)
        val lastTrend = prefs.getString("trend", null)
        val lastAt = prefs.getLong("at", 0)
        val zone = insight.zone.name
        val trend = trendGroup(insight.arrow)
        remember(context, insight)
        if (lastZone == null || trend == "none") return
        val zoneChanged = zone != lastZone
        val trendChanged = trend != lastTrend && System.currentTimeMillis() - lastAt >= TREND_UPDATE_GAP_MS
        if (!zoneChanged && !trendChanged) return
        prefs.edit().putLong("at", System.currentTimeMillis()).apply()
        val fr = CarGlucoseText.fr
        val title = now
        val body = if (zoneChanged) {
            val word = CarGlucoseText.zoneWord(insight.zone)
            val back = insight.zone == GlucoseZone.IN_RANGE
            (if (back) (if (fr) "De retour dans la cible" else "Back in range") else word) + " · " + CarGlucoseText.trendWord(insight.arrow)
        } else {
            CarGlucoseText.trendWord(insight.arrow) + forecastSuffix(insight, unit, fr)
        }
        notify(context, UPDATE_CHANNEL, UPDATE_ID, title, body)
    }

    private fun forecastSuffix(insight: GlucoseInsight, unit: String, fr: Boolean): String {
        val f = insight.prediction.lastOrNull() ?: return ""
        return (if (fr) " · dans 30 min ≈ " else " · in 30 min ≈ ") + CarGlucoseText.withUnit(f.mgDl, unit)
    }

    private fun due(context: Context, kind: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (prefs.getString("kind", null) == kind && now - prefs.getLong("at", 0) < REPEAT_MS) return false
        prefs.edit().putString("kind", kind).putLong("at", now).apply()
        return true
    }

    /** Back in a safe range: forget the last alert so the next one fires right away. */
    private fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val fr = CarGlucoseText.fr
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, if (fr) "Alertes voiture" else "Car alerts", NotificationManager.IMPORTANCE_HIGH)
                .apply { description = "Glucose alerts on the Android Auto screen" }
        )
        // High importance so Android Auto shows it over the split screen, but no sound or buzz.
        manager.createNotificationChannel(
            NotificationChannel(UPDATE_CHANNEL, if (fr) "Glycémie en voiture" else "Car glucose updates", NotificationManager.IMPORTANCE_HIGH)
                .apply {
                    description = "Silent updates on the Android Auto screen when your range or trend changes"
                    setSound(null, null)
                    enableVibration(false)
                }
        )
    }

    @SuppressLint("MissingPermission")
    private fun notify(context: Context, channel: String, id: Int, title: String, body: String) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        ensureChannels(context)
        val silent = channel == UPDATE_CHANNEL
        val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
            .takeIf { it != 0 } ?: context.applicationInfo.icon
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(icon)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(if (silent) NotificationCompat.CATEGORY_STATUS else NotificationCompat.CATEGORY_ALARM)
            .setSilent(silent)
            .setTimeoutAfter(if (silent) 15L * 60 * 1000 else 0L)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOnlyAlertOnce(false)
            .setAutoCancel(true)
            .extend(
                CarAppExtender.Builder()
                    .setContentTitle(title)
                    .setContentText(body)
                    .setSmallIcon(icon)
                    .setImportance(NotificationManagerCompat.IMPORTANCE_HIGH)
                    .build()
            )
            .build()
        manager.notify(id, notification)
    }
}
