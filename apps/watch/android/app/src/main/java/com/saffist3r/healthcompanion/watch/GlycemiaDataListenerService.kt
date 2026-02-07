package com.saffist3r.healthcompanion.watch

import android.content.Intent
import android.util.Log
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService

private const val TAG = "GlycemiaDataListener"
private const val GLYCEMIA_PATH = "/health_companion/glycemia"
private const val SYNC_MESSAGE_PATH = "/health_companion/sync"
private const val KEY_VALUE = "value"
private const val KEY_UNIT = "unit"
private const val KEY_TIMESTAMP = "timestamp"

class GlycemiaDataListenerService : WearableListenerService() {

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        if (messageEvent.path == SYNC_MESSAGE_PATH) {
            Log.d(TAG, "Sync message received, fetching glycemia")
            fetchFromDataLayer()
        }
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        super.onDataChanged(dataEvents)
        Log.d(TAG, "onDataChanged received")
        for (event in dataEvents) {
            if (event.type == com.google.android.gms.wearable.DataEvent.TYPE_CHANGED &&
                event.dataItem.uri.path == GLYCEMIA_PATH
            ) {
                val dataMap = com.google.android.gms.wearable.DataMapItem.fromDataItem(event.dataItem).dataMap
                val value = dataMap.getDouble(KEY_VALUE)
                val unit = dataMap.getString(KEY_UNIT) ?: "mmol/L"
                val timestamp = dataMap.getLong(KEY_TIMESTAMP, 0L)
                GlycemiaHolder.update(value, unit, timestamp)
                Log.d(TAG, "Glycemia updated from Data Layer: $value $unit ts=$timestamp")
            }
        }
        dataEvents.release()
    }

    private fun fetchFromDataLayer() {
        Wearable.getDataClient(this).getDataItems()
            .addOnSuccessListener { buffer ->
                try {
                    var latestTs = 0L
                    for (item in buffer) {
                        val path = item.uri.path ?: continue
                        if (path == GLYCEMIA_PATH || path.startsWith("$GLYCEMIA_PATH/")) {
                            val dataMap = com.google.android.gms.wearable.DataMapItem.fromDataItem(item).dataMap
                            val value = dataMap.getDouble(KEY_VALUE)
                            val unit = dataMap.getString(KEY_UNIT) ?: "mmol/L"
                            val timestamp = dataMap.getLong(KEY_TIMESTAMP, 0L)
                            if (timestamp >= latestTs) {
                                latestTs = timestamp
                                GlycemiaHolder.update(value, unit, timestamp)
                                Log.d(TAG, "Glycemia updated from sync fetch: $value $unit ts=$timestamp")
                            }
                        }
                    }
                    if (latestTs == 0L) Log.d(TAG, "Sync fetch: no glycemia in Data Layer")
                } catch (e: Exception) {
                    Log.e(TAG, "fetchFromDataLayer error", e)
                } finally {
                    buffer.release()
                }
            }
            .addOnFailureListener { e -> Log.e(TAG, "fetchFromDataLayer failed", e) }
    }
}
