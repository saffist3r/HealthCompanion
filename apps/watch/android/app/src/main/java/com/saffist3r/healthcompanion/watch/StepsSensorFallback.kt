package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.content.SharedPreferences
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import java.time.LocalDate
import java.time.ZoneId
import kotlin.concurrent.Volatile

/**
 * Legacy fallback when Wear Health Services is unavailable.
 * Prefer [StepsMonitor] (STEPS_DAILY) — this often undercounts vs Samsung Activity.
 */
object StepsSensorFallback {
    private const val TAG = "StepsSensorFallback"
    private const val PREFS = "steps_prefs"
    private const val KEY_DAY = "day"
    private const val KEY_BASELINE = "baseline"
    private const val KEY_DETECTOR_DAY = "detector_day"
    private const val KEY_DETECTOR_TODAY = "detector_today"

    @Volatile private var sensorManager: SensorManager? = null
    @Volatile private var counterListener: SensorEventListener? = null
    @Volatile private var detectorListener: SensorEventListener? = null

    fun start(context: Context) {
        if (counterListener != null || detectorListener != null) return
        val app = context.applicationContext
        val sm = app.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        val stepCounter = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        if (stepCounter != null) {
            try {
                val listener = object : SensorEventListener {
                    override fun onSensorChanged(event: SensorEvent) {
                        if (event.values.isEmpty()) return
                        val totalSinceBoot = event.values[0].toInt().coerceAtLeast(0)
                        StepsHolder.update(toDailySteps(prefs, totalSinceBoot))
                    }
                    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
                }
                if (sm.registerListener(listener, stepCounter, SensorManager.SENSOR_DELAY_NORMAL)) {
                    counterListener = listener
                    sensorManager = sm
                    Log.d(TAG, "Step counter fallback started")
                    return
                }
            } catch (e: SecurityException) {
                Log.w(TAG, "Step counter permission denied", e)
            }
        }

        val stepDetector = sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
        if (stepDetector != null) {
            ensureDetectorDay(prefs)
            var todaySteps = prefs.getInt(KEY_DETECTOR_TODAY, 0)
            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    if (event.values.isEmpty() || event.values[0] < 1f) return
                    ensureDetectorDay(prefs)
                    todaySteps = prefs.getInt(KEY_DETECTOR_TODAY, 0) + event.values[0].toInt()
                    prefs.edit().putInt(KEY_DETECTOR_TODAY, todaySteps).apply()
                    StepsHolder.update(todaySteps)
                }
                override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
            }
            if (sm.registerListener(listener, stepDetector, SensorManager.SENSOR_DELAY_NORMAL)) {
                detectorListener = listener
                sensorManager = sm
                StepsHolder.update(todaySteps)
                Log.d(TAG, "Step detector fallback started")
            }
        }
    }

    fun stop() {
        counterListener?.let { sensorManager?.unregisterListener(it) }
        detectorListener?.let { sensorManager?.unregisterListener(it) }
        counterListener = null
        detectorListener = null
        sensorManager = null
    }

    private fun toDailySteps(prefs: SharedPreferences, totalSinceBoot: Int): Int {
        val today = LocalDate.now(ZoneId.systemDefault()).toString()
        val storedDay = prefs.getString(KEY_DAY, null)
        var baseline = prefs.getInt(KEY_BASELINE, -1)
        val dayChanged = storedDay != today
        val rebooted = baseline >= 0 && totalSinceBoot < baseline
        if (dayChanged || baseline < 0 || rebooted) {
            baseline = totalSinceBoot
            prefs.edit().putString(KEY_DAY, today).putInt(KEY_BASELINE, baseline).apply()
        }
        return (totalSinceBoot - baseline).coerceAtLeast(0)
    }

    private fun ensureDetectorDay(prefs: SharedPreferences) {
        val today = LocalDate.now(ZoneId.systemDefault()).toString()
        if (prefs.getString(KEY_DETECTOR_DAY, null) != today) {
            prefs.edit().putString(KEY_DETECTOR_DAY, today).putInt(KEY_DETECTOR_TODAY, 0).apply()
        }
    }
}
