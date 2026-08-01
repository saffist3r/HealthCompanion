package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Pushes today's step count to the phone via the Wearable Data Layer.
 */
object StepsPublisher {
    private const val TAG = "StepsPublisher"
    private const val PATH = "/health_companion/steps"
    private const val MIN_STEP_DELTA = 5
    private const val MIN_INTERVAL_MS = 15_000L

    private val executor = Executors.newSingleThreadExecutor()
    private val lastPublished = AtomicInteger(-1)
    private val lastPublishedAt = AtomicLong(0)

    fun publish(context: Context, steps: Int) {
        val now = System.currentTimeMillis()
        val prev = lastPublished.get()
        val elapsed = now - lastPublishedAt.get()
        if (prev == steps) return
        if (prev >= 0 && kotlin.math.abs(steps - prev) < MIN_STEP_DELTA && elapsed < MIN_INTERVAL_MS) {
            return
        }

        val app = context.applicationContext
        executor.execute {
            try {
                val date = LocalDate.now(ZoneId.systemDefault()).toString()
                val req = PutDataMapRequest.create(PATH)
                req.dataMap.putInt("steps", steps.coerceAtLeast(0))
                req.dataMap.putString("date", date)
                req.dataMap.putLong("timestamp", System.currentTimeMillis())
                Wearable.getDataClient(app)
                    .putDataItem(req.asPutDataRequest().setUrgent())
                    .addOnSuccessListener {
                        lastPublished.set(steps)
                        lastPublishedAt.set(System.currentTimeMillis())
                        Log.d(TAG, "Published steps=$steps date=$date")
                    }
                    .addOnFailureListener { e ->
                        Log.w(TAG, "Failed to publish steps", e)
                    }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to publish steps", e)
            }
        }
    }
}
