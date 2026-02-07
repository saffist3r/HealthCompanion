package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import androidx.core.content.ContextCompat
import kotlin.concurrent.Volatile

object StepsMonitor {
    private const val TAG = "StepsMonitor"
    private const val PREFS = "steps_prefs"
    private const val KEY_ACCUMULATED = "accumulated_steps"

    @Volatile private var sensorManager: SensorManager? = null
    @Volatile private var counterListener: SensorEventListener? = null
    @Volatile private var detectorListener: SensorEventListener? = null

    private const val ACTIVITY_RECOGNITION = android.Manifest.permission.ACTIVITY_RECOGNITION

    fun start(context: Context) {
        if (counterListener != null || detectorListener != null) return
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return

        // Try TYPE_STEP_COUNTER first (cumulative since boot)
        val stepCounter = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        if (stepCounter != null) {
            try {
                val listener = object : SensorEventListener {
                    override fun onSensorChanged(event: SensorEvent) {
                        if (event.values.isNotEmpty()) {
                            val steps = event.values[0].toInt()
                            if (steps >= 0) StepsHolder.update(steps)
                        }
                    }
                    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
                }
                if (sm.registerListener(listener, stepCounter, SensorManager.SENSOR_DELAY_NORMAL)) {
                    counterListener = listener
                    sensorManager = sm
                    Log.d(TAG, "Step counter started")
                    return
                }
            } catch (e: SecurityException) {
                Log.w(TAG, "Step counter needs ACTIVITY_RECOGNITION permission", e)
            }
        }

        // Fallback: TYPE_STEP_DETECTOR (fires per step, we accumulate)
        val stepDetector = sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
        if (stepDetector != null) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            var accumulated = prefs.getInt(KEY_ACCUMULATED, 0)

            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    if (event.values.isNotEmpty() && event.values[0] >= 1f) {
                        accumulated += event.values[0].toInt()
                        prefs.edit().putInt(KEY_ACCUMULATED, accumulated).apply()
                        StepsHolder.update(accumulated)
                    }
                }
                override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
            }
            if (sm.registerListener(listener, stepDetector, SensorManager.SENSOR_DELAY_NORMAL)) {
                detectorListener = listener
                sensorManager = sm
                StepsHolder.update(accumulated)
                Log.d(TAG, "Step detector started (accumulated=$accumulated)")
            }
        } else {
            Log.w(TAG, "No step sensor available")
        }
    }

    fun stop() {
        counterListener?.let { sensorManager?.unregisterListener(it) }
        detectorListener?.let { sensorManager?.unregisterListener(it) }
        counterListener = null
        detectorListener = null
        sensorManager = null
        Log.d(TAG, "Steps monitor stopped")
    }

    private fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

    fun restart(context: Context) {
        stop()
        start(context)
    }
}
