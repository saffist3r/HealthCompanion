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
 * Low / going-low / very-high alerts shown on the car screen while Android Auto is connected.
 * Off the car, the phone's own notifications and the watch already cover this.
 */
object CarGlucoseAlerts {
    const val LOW_MG_DL = 70.0
    const val HIGH_MG_DL = 180.0

    private const val CHANNEL = "hc-car-alerts"
    private const val NOTIFICATION_ID = 4710
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
                projected = type == CarConnection.CONNECTION_TYPE_PROJECTION
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
                return
            }
        }
        val body = when (kind) {
            "fallingLow" -> (if (fr) "Maintenant $now. Gardez du sucre à portée." else "Now $now. Keep sugar close.")
            "low" -> if (fr) "Arrêtez-vous dès que possible et resucrez-vous." else "Pull over when safe and treat it."
            else -> CarGlucoseText.trendWord(insight.arrow)
        }
        if (!due(context, kind)) return
        notify(context, title, body)
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

    @SuppressLint("MissingPermission")
    private fun notify(context: Context, title: String, body: String) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL,
                if (CarGlucoseText.fr) "Alertes voiture" else "Car alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply { description = "Glucose alerts on the Android Auto screen" }
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
            .takeIf { it != 0 } ?: context.applicationInfo.icon
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(icon)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
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
        manager.notify(NOTIFICATION_ID, notification)
    }
}
