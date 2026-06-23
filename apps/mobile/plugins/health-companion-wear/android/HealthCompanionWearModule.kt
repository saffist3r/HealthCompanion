package com.saffist3r.healthcompanion.wearbridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

class HealthCompanionWearModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val executor = Executors.newSingleThreadExecutor()

    override fun getName(): String = "HealthCompanionWear"

    @ReactMethod
    fun sendGlycemiaToWatch(reading: ReadableMap, promise: Promise) {
        executor.execute {
            try {
                val value = reading.getDouble("value")
                val unit = reading.getString("unit") ?: "mmol/L"
                val timestamp = if (reading.hasKey("timestamp")) {
                    reading.getDouble("timestamp").toLong()
                } else {
                    System.currentTimeMillis()
                }
                val req = PutDataMapRequest.create("/health_companion/glycemia")
                req.dataMap.putDouble("value", value)
                req.dataMap.putString("unit", unit)
                req.dataMap.putLong("timestamp", timestamp)
                val client = Wearable.getDataClient(reactContext)
                client.putDataItem(req.asPutDataRequest().setUrgent())
                syncHistoryIfPresent(reading, client)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("SYNC_ERROR", e.message, e)
            }
        }
    }

    private fun syncHistoryIfPresent(
        reading: ReadableMap,
        client: com.google.android.gms.wearable.DataClient
    ) {
        if (!reading.hasKey("history")) return
        val historyArr = reading.getArray("history") ?: return
        val json = JSONArray()
        for (i in 0 until historyArr.size()) {
            val item = historyArr.getMap(i) ?: continue
            val v = item.getDouble("value")
            val unit = item.getString("unit") ?: "mg/dL"
            val mg = if (unit.equals("mg/dL", ignoreCase = true)) v else v * 18.0182
            val ts = item.getDouble("timestamp").toLong()
            json.put(JSONObject().put("v", mg).put("t", ts))
        }
        if (json.length() == 0) return
        val histReq = PutDataMapRequest.create("/health_companion/glycemia_history")
        histReq.dataMap.putString("history_json", json.toString())
        histReq.dataMap.putLong("timestamp", System.currentTimeMillis())
        client.putDataItem(histReq.asPutDataRequest().setUrgent())
    }

    @ReactMethod
    fun sendBackgroundToWatch(settings: ReadableMap, promise: Promise) {
        executor.execute {
            try {
                val type = settings.getString("type") ?: "animated"
                val solidColor = settings.getString("solidColor") ?: "#0D1117"
                val gradientId = settings.getString("gradientId") ?: "mint"
                val imageId = settings.getString("imageId") ?: "teal"
                val statusTint = if (settings.hasKey("statusTint")) settings.getBoolean("statusTint") else true
                val textColor = settings.getString("textColor") ?: "#FFFFFF"
                val slideshowIntervalSec = if (settings.hasKey("slideshowIntervalSec")) {
                    settings.getInt("slideshowIntervalSec")
                } else {
                    30
                }
                val updatedAt = if (settings.hasKey("updatedAt")) {
                    settings.getDouble("updatedAt").toLong()
                } else {
                    System.currentTimeMillis()
                }

                val imageIdsJson = if (settings.hasKey("imageIds")) {
                    val arr = settings.getArray("imageIds")
                    if (arr != null) {
                        val json = JSONArray()
                        for (i in 0 until arr.size()) {
                            val id = arr.getString(i)
                            if (!id.isNullOrBlank()) json.put(id)
                        }
                        json.toString()
                    } else {
                        JSONArray().put(imageId).toString()
                    }
                } else {
                    JSONArray().put(imageId).toString()
                }

                val customUris = mutableListOf<String>()
                if (settings.hasKey("customImageUris")) {
                    val arr = settings.getArray("customImageUris")
                    if (arr != null) {
                        for (i in 0 until arr.size()) {
                            val uri = arr.getString(i)
                            if (!uri.isNullOrBlank()) customUris.add(uri)
                        }
                    }
                }
                val legacyUri = settings.getString("customImageUri")
                if (customUris.isEmpty() && !legacyUri.isNullOrBlank()) {
                    customUris.add(legacyUri)
                }

                val req = PutDataMapRequest.create("/health_companion/background")
                req.dataMap.putString("type", type)
                req.dataMap.putString("solidColor", solidColor)
                req.dataMap.putString("gradientId", gradientId)
                req.dataMap.putString("imageId", imageId)
                req.dataMap.putString("imageIdsJson", imageIdsJson)
                req.dataMap.putBoolean("statusTint", statusTint)
                req.dataMap.putString("textColor", textColor)
                req.dataMap.putInt("slideshowIntervalSec", slideshowIntervalSec)
                req.dataMap.putLong("updatedAt", updatedAt)

                if (type == "image" && customUris.isNotEmpty()) {
                    req.dataMap.putInt("customImageCount", customUris.size)
                    customUris.take(10).forEachIndexed { index, uri ->
                        val bytes = loadImageBytes(uri)
                        if (bytes != null) {
                            req.dataMap.putAsset("image_$index", Asset.createFromBytes(bytes))
                        }
                    }
                } else if (!legacyUri.isNullOrBlank() && type == "image" && imageId == "custom") {
                    val bytes = loadImageBytes(legacyUri)
                    if (bytes != null) {
                        req.dataMap.putAsset("image", Asset.createFromBytes(bytes))
                    }
                }

                Wearable.getDataClient(reactContext)
                    .putDataItem(req.asPutDataRequest().setUrgent())
                    .addOnSuccessListener { promise.resolve(true) }
                    .addOnFailureListener { e -> promise.reject("SYNC_ERROR", e.message, e) }
            } catch (e: Exception) {
                promise.reject("SYNC_ERROR", e.message, e)
            }
        }
    }

    private fun loadImageBytes(uriString: String): ByteArray? {
        val uri = Uri.parse(uriString)
        val input = reactContext.contentResolver.openInputStream(uri) ?: return null
        val original = input.use { BitmapFactory.decodeStream(it) } ?: return null
        val maxSide = 512
        val scale = minOf(
            maxSide.toFloat() / original.width,
            maxSide.toFloat() / original.height,
            1f
        )
        val bmp: Bitmap = if (scale < 1f) {
            Bitmap.createScaledBitmap(
                original,
                (original.width * scale).toInt().coerceAtLeast(1),
                (original.height * scale).toInt().coerceAtLeast(1),
                true
            )
        } else {
            original
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
        if (bmp !== original) bmp.recycle()
        return out.toByteArray()
    }
}

class GlycemiaStorageModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "GlycemiaStorage"

    @ReactMethod
    fun getLastGlycemia(promise: Promise) {
        val json = reactApplicationContext
            .getSharedPreferences("health_companion", Context.MODE_PRIVATE)
            .getString("last_glycemia", null)
        promise.resolve(json)
    }
}
