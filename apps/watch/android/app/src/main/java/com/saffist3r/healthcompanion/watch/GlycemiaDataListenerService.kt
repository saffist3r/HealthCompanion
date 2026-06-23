package com.saffist3r.healthcompanion.watch

import android.util.Log
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONArray
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import com.google.android.gms.tasks.Tasks

private const val TAG = "GlycemiaDataListener"
private const val GLYCEMIA_PATH = "/health_companion/glycemia"
private const val GLYCEMIA_HISTORY_PATH = "/health_companion/glycemia_history"
private const val BACKGROUND_PATH = "/health_companion/background"
private const val SYNC_MESSAGE_PATH = "/health_companion/sync"
private const val KEY_VALUE = "value"
private const val KEY_UNIT = "unit"
private const val KEY_TIMESTAMP = "timestamp"
private const val KEY_HISTORY_JSON = "history_json"

class GlycemiaDataListenerService : WearableListenerService() {

    private val backgroundExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate() {
        super.onCreate()
        GlycemiaHolder.init(applicationContext)
        BackgroundSettingsHolder.init(applicationContext)
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        if (messageEvent.path == SYNC_MESSAGE_PATH) {
            Log.d(TAG, "Sync message received, fetching from Data Layer")
            fetchFromDataLayer()
        }
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        super.onDataChanged(dataEvents)
        for (event in dataEvents) {
            if (event.type != com.google.android.gms.wearable.DataEvent.TYPE_CHANGED) continue
            val path = event.dataItem.uri.path ?: continue
            val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
            when {
                path == GLYCEMIA_PATH || path.startsWith("$GLYCEMIA_PATH/") -> applyGlycemia(dataMap)
                path == GLYCEMIA_HISTORY_PATH || path.startsWith("$GLYCEMIA_HISTORY_PATH/") -> applyHistory(dataMap)
                path == BACKGROUND_PATH || path.startsWith("$BACKGROUND_PATH/") -> applyBackground(dataMap)
            }
        }
        dataEvents.release()
    }

    private fun applyGlycemia(dataMap: DataMap) {
        val value = dataMap.getDouble(KEY_VALUE)
        val unit = dataMap.getString(KEY_UNIT) ?: "mmol/L"
        val timestamp = dataMap.getLong(KEY_TIMESTAMP, 0L)
        GlycemiaHolder.update(value, unit, timestamp)
        Log.d(TAG, "Glycemia updated: $value $unit ts=$timestamp")
    }

    private fun applyHistory(dataMap: DataMap) {
        val json = dataMap.getString(KEY_HISTORY_JSON) ?: return
        try {
            val arr = JSONArray(json)
            val points = mutableListOf<Pair<Double, Long>>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                points.add(o.getDouble("v") to o.getLong("t"))
            }
            GlycemiaHolder.mergeHistoryFromPhone(points)
            Log.d(TAG, "History merged: ${points.size} points")
        } catch (e: Exception) {
            Log.e(TAG, "applyHistory failed", e)
        }
    }

    private fun applyBackground(dataMap: DataMap) {
        val imageIdsJson = dataMap.getString("imageIdsJson")
        val legacyImageId = dataMap.getString("imageId") ?: "teal"
        val imageIds = parseImageIdsJson(imageIdsJson).ifEmpty { listOf(legacyImageId) }

        val settings = BackgroundSettings(
            type = BackgroundType.fromWire(dataMap.getString("type")),
            solidColor = dataMap.getString("solidColor") ?: "#0D1117",
            gradientId = dataMap.getString("gradientId") ?: "mint",
            imageId = imageIds.first(),
            imageIds = imageIds,
            statusTint = dataMap.getBoolean("statusTint", true),
            textColor = dataMap.getString("textColor") ?: "#FFFFFF",
            slideshowIntervalSec = dataMap.getInt("slideshowIntervalSec", 30),
            updatedAt = dataMap.getLong("updatedAt", System.currentTimeMillis())
        )
        BackgroundSettingsHolder.update(settings, fromSync = true)
        Log.d(TAG, "Background updated: ${settings.type.wire} images=${imageIds.size}")

        backgroundExecutor.execute {
            loadBackgroundImages(dataMap)
        }
    }

    private fun loadBackgroundImages(dataMap: DataMap) {
        val client = Wearable.getDataClient(this)
        val count = dataMap.getInt("customImageCount", -1)
        if (count > 0) {
            val images = mutableListOf<ByteArray>()
            for (i in 0 until count) {
                val asset = dataMap.getAsset("image_$i") ?: continue
                try {
                    val response = Tasks.await(client.getFdForAsset(asset), 30, TimeUnit.SECONDS)
                    val bytes = response.inputStream.use { it.readBytes() }
                    if (bytes.isNotEmpty()) images.add(bytes)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to load image_$i", e)
                }
            }
            if (images.isNotEmpty()) {
                BackgroundSettingsHolder.saveCustomImages(images)
            }
            return
        }
        val legacy = dataMap.getAsset("image") ?: return
        try {
            val response = Tasks.await(client.getFdForAsset(legacy), 30, TimeUnit.SECONDS)
            val bytes = response.inputStream.use { it.readBytes() }
            if (bytes.isNotEmpty()) {
                BackgroundSettingsHolder.saveCustomImages(listOf(bytes))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read background image asset", e)
        }
    }

    private fun parseImageIdsJson(json: String?): List<String> {
        if (json.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(json)
            buildList {
                for (i in 0 until arr.length()) {
                    val id = arr.optString(i)
                    if (id.isNotBlank()) add(id)
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun fetchFromDataLayer() {
        Wearable.getDataClient(this).getDataItems()
            .addOnSuccessListener { buffer ->
                try {
                    var latestGlycemiaTs = 0L
                    var latestBackgroundTs = 0L
                    for (item in buffer) {
                        val path = item.uri.path ?: continue
                        val dataMap = DataMapItem.fromDataItem(item).dataMap
                        when {
                            path == GLYCEMIA_PATH || path.startsWith("$GLYCEMIA_PATH/") -> {
                                val timestamp = dataMap.getLong(KEY_TIMESTAMP, 0L)
                                if (timestamp >= latestGlycemiaTs) {
                                    latestGlycemiaTs = timestamp
                                    applyGlycemia(dataMap)
                                }
                            }
                            path == GLYCEMIA_HISTORY_PATH || path.startsWith("$GLYCEMIA_HISTORY_PATH/") -> {
                                applyHistory(dataMap)
                            }
                            path == BACKGROUND_PATH || path.startsWith("$BACKGROUND_PATH/") -> {
                                val timestamp = dataMap.getLong("updatedAt", 0L)
                                if (timestamp >= latestBackgroundTs) {
                                    latestBackgroundTs = timestamp
                                    applyBackground(dataMap)
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "fetchFromDataLayer error", e)
                } finally {
                    buffer.release()
                }
            }
            .addOnFailureListener { e -> Log.e(TAG, "fetchFromDataLayer failed", e) }
    }
}
