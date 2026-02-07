package com.saffist3r.healthcompanion.watch

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.Wearable
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.Timer
import java.util.TimerTask

private const val GLYCEMIA_PATH = "/health_companion/glycemia"
private const val KEY_VALUE = "value"
private const val KEY_UNIT = "unit"
private const val KEY_TIMESTAMP = "timestamp"

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val _currentTime = MutableLiveData<String>()
    val currentTime: LiveData<String> = _currentTime

    val glycemia: LiveData<String> = GlycemiaHolder.glycemiaDisplay
    val timeAgo: LiveData<String> = GlycemiaHolder.timeAgo
    val statusColor: LiveData<Int> = GlycemiaHolder.statusColor
    val statusLabel: LiveData<String> = GlycemiaHolder.statusLabel

    private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())

    fun refresh() = fetchLatestGlycemia()

    init {
        _currentTime.value = timeFormat.format(Date())
        Timer().scheduleAtFixedRate(object : TimerTask() {
            override fun run() {
                _currentTime.postValue(timeFormat.format(Date()))
            }
        }, 1000 - (System.currentTimeMillis() % 1000), 1000)
        Timer().scheduleAtFixedRate(object : TimerTask() {
            override fun run() { GlycemiaHolder.refreshTimeAgo() }
        }, 30_000, 30_000)
        Timer().scheduleAtFixedRate(object : TimerTask() {
            override fun run() { fetchLatestGlycemia() }
        }, 0, 15_000)
        fetchLatestGlycemia()
    }

    private fun fetchLatestGlycemia() {
        Log.d("HC", "fetchLatestGlycemia: requesting Data Layer")
        val dataClient = Wearable.getDataClient(getApplication<Application>())
        dataClient.getDataItems()
            .addOnSuccessListener { buffer ->
                try {
                    var found = false
                    var latestTs = 0L
                    val healthPaths = mutableListOf<String>()
                    for (item in buffer) {
                        val path = item.uri.path ?: continue
                        if (path.contains("health_companion")) healthPaths.add(path)
                        if (path == GLYCEMIA_PATH || path.startsWith("$GLYCEMIA_PATH/")) {
                            val dataMap = com.google.android.gms.wearable.DataMapItem.fromDataItem(item).dataMap
                            val value = dataMap.getDouble(KEY_VALUE)
                            val unit = dataMap.getString(KEY_UNIT) ?: "mmol/L"
                            val timestamp = dataMap.getLong(KEY_TIMESTAMP, 0L)
                            if (timestamp >= latestTs) {
                                latestTs = timestamp
                                GlycemiaHolder.update(value, unit, timestamp)
                                Log.d("HC", "fetchLatestGlycemia: updated value=$value $unit ts=$timestamp")
                                found = true
                            }
                        }
                    }
                    if (!found) {
                        Log.d("HC", "fetchLatestGlycemia: no glycemia (health_companion paths: $healthPaths)")
                    }
                } catch (e: Exception) {
                    Log.e("HC", "fetchLatestGlycemia error", e)
                } finally {
                    buffer.release()
                }
            }
            .addOnFailureListener { e -> Log.e("HC", "fetchLatestGlycemia failed", e) }
    }
}

class MainViewModelFactory(private val application: Application) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return MainViewModel(application) as T
    }
}
