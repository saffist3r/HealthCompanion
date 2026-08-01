package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.PassiveListenerCallback
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.PassiveListenerConfig
import androidx.health.services.client.PassiveMonitoringClient
import com.google.common.util.concurrent.FutureCallback
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.Volatile

/**
 * Reads **today's** steps from Wear Health Services ([DataType.STEPS_DAILY]), which is
 * the same platform source Samsung Health / Activity uses on Galaxy Watch.
 *
 * Falls back to the legacy [Sensor.TYPE_STEP_COUNTER] path only if Health Services
 * is unavailable.
 */
object StepsMonitor {
    private const val TAG = "StepsMonitor"
    private const val ACTIVITY_RECOGNITION = android.Manifest.permission.ACTIVITY_RECOGNITION

    @Volatile private var appContext: Context? = null
    @Volatile private var passiveClient: PassiveMonitoringClient? = null
    private val started = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()

    private val listener = object : PassiveListenerCallback {
        override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
            val points = dataPoints.getData(DataType.STEPS_DAILY)
            val latest = points.maxByOrNull { it.endDurationFromBoot.toMillis() } ?: return
            val steps = latest.value.toInt().coerceAtLeast(0)
            Log.d(TAG, "STEPS_DAILY=$steps")
            StepsHolder.update(steps)
        }

        override fun onPermissionLost() {
            Log.w(TAG, "Health Services permission lost")
        }
    }

    fun start(context: Context) {
        if (!started.compareAndSet(false, true)) return
        val app = context.applicationContext
        appContext = app

        if (!hasPermission(app)) {
            Log.w(TAG, "ACTIVITY_RECOGNITION not granted — will retry")
            started.set(false)
            // Keep sensor fallback so the face still shows something
            StepsSensorFallback.start(app)
            return
        }

        try {
            val client = HealthServices.getClient(app).passiveMonitoringClient
            passiveClient = client
            Futures.addCallback(
                client.getCapabilitiesAsync(),
                object : FutureCallback<androidx.health.services.client.data.PassiveMonitoringCapabilities> {
                    override fun onSuccess(
                        result: androidx.health.services.client.data.PassiveMonitoringCapabilities?
                    ) {
                        val supported =
                            result?.supportedDataTypesPassiveMonitoring?.contains(DataType.STEPS_DAILY) == true
                        if (!supported) {
                            Log.w(TAG, "STEPS_DAILY not supported — using sensor fallback")
                            StepsSensorFallback.start(app)
                            return
                        }
                        val config = PassiveListenerConfig.builder()
                            .setDataTypes(setOf(DataType.STEPS_DAILY))
                            .build()
                        client.setPassiveListenerCallback(config, listener)
                        // Pull latest buffered daily total ASAP
                        Futures.addCallback(
                            client.flushAsync(),
                            object : FutureCallback<Void> {
                                override fun onSuccess(result: Void?) {
                                    Log.d(TAG, "Health Services flush requested")
                                }
                                override fun onFailure(t: Throwable) {
                                    Log.w(TAG, "Health Services flush failed", t)
                                }
                            },
                            MoreExecutors.directExecutor()
                        )
                        Log.d(TAG, "Health Services STEPS_DAILY listener registered")
                    }

                    override fun onFailure(t: Throwable) {
                        Log.w(TAG, "Health Services capabilities failed — sensor fallback", t)
                        StepsSensorFallback.start(app)
                    }
                },
                executor
            )
        } catch (e: Exception) {
            Log.w(TAG, "Health Services unavailable — sensor fallback", e)
            StepsSensorFallback.start(app)
        }
    }

    fun stop() {
        started.set(false)
        try {
            passiveClient?.clearPassiveListenerCallbackAsync()
        } catch (_: Exception) {
            /* ignore */
        }
        passiveClient = null
        StepsSensorFallback.stop()
        Log.d(TAG, "Steps monitor stopped")
    }

    fun restart(context: Context) {
        stop()
        start(context)
    }

    /** Ask Health Services to deliver the latest daily total (e.g. on watch-face tick). */
    fun flush() {
        val client = passiveClient ?: return
        Futures.addCallback(
            client.flushAsync(),
            object : FutureCallback<Void> {
                override fun onSuccess(result: Void?) {}
                override fun onFailure(t: Throwable) {
                    Log.w(TAG, "flush failed", t)
                }
            },
            MoreExecutors.directExecutor()
        )
    }

    private fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, ACTIVITY_RECOGNITION) ==
            PackageManager.PERMISSION_GRANTED
}
