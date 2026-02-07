package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import androidx.core.content.ContextCompat

object HeartRateMonitor {
    private const val TAG = "HeartRateMonitor"

    @Volatile
    private var sensorManager: SensorManager? = null

    @Volatile
    private var listener: SensorEventListener? = null

    private const val BODY_SENSORS = android.Manifest.permission.BODY_SENSORS

    fun start(context: Context) {
        if (listener != null) return
        if (!hasPermission(context)) {
            Log.w(TAG, "BODY_SENSORS permission not granted")
            return
        }
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        val sensor = sm?.getDefaultSensor(Sensor.TYPE_HEART_RATE)
        if (sensor == null) {
            Log.w(TAG, "No heart rate sensor available")
            return
        }
        val eventListener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (event.values.isNotEmpty()) {
                    val raw = event.values[0]
                    val bpm = raw.toInt()
                    if (bpm in 30..250) HeartRateHolder.update(bpm)
                }
            }
            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
        }
        sm.registerListener(
            eventListener,
            sensor,
            SensorManager.SENSOR_DELAY_NORMAL
        )
        sensorManager = sm
        listener = eventListener
        Log.d(TAG, "Heart rate monitor started")
    }

    fun stop() {
        listener?.let { sensorManager?.unregisterListener(it) }
        listener = null
        sensorManager = null
        Log.d(TAG, "Heart rate monitor stopped")
    }

    /** Restart monitor (e.g. after user grants permission) */
    fun restart(context: Context) {
        stop()
        start(context)
    }

    private fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, BODY_SENSORS) == PackageManager.PERMISSION_GRANTED
}
