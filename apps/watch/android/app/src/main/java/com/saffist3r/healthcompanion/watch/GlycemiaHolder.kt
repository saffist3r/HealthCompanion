package com.saffist3r.healthcompanion.watch

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import java.util.concurrent.CopyOnWriteArrayList

object GlycemiaHolder {
    private const val HISTORY_SIZE = 48

    private val _glycemia = MutableLiveData<GlycemiaData>()
    val glycemia: LiveData<GlycemiaData> = _glycemia

    private val _glycemiaDisplay = MutableLiveData<String>("--")
    val glycemiaDisplay: LiveData<String> = _glycemiaDisplay

    private val _timeAgo = MutableLiveData<String>("")
    val timeAgo: LiveData<String> = _timeAgo

    private val _statusColor = MutableLiveData<Int>(0xFF80CBC4.toInt()) // Mint default
    val statusColor: LiveData<Int> = _statusColor

    private val _statusLabel = MutableLiveData<String>("")
    val statusLabel: LiveData<String> = _statusLabel

    private var lastTimestamp: Long = 0

    /** Thread-safe history for sparkline: (mg/dL, timestamp) - x-axis uses time for spacing */
    private val _history = CopyOnWriteArrayList<Pair<Double, Long>>()

    fun getHistoryForSparkline(): List<Pair<Double, Long>> = _history.toList()

    fun update(value: Double, unit: String, timestamp: Long) {
        lastTimestamp = timestamp
        val mgDl = if (unit.equals("mg/dL", true)) value else value * 18.0182
        _history.add(0, mgDl to timestamp)
        while (_history.size > HISTORY_SIZE) _history.removeAt(_history.size - 1)
        _glycemia.postValue(GlycemiaData(value, unit, timestamp))
        _glycemiaDisplay.postValue("%.1f %s".format(value, unit))
        _timeAgo.postValue(formatTimeAgo(timestamp))
        _statusColor.postValue(colorForValue(value, unit))
        _statusLabel.postValue(statusLabelForValue(value, unit))
    }

    private fun formatTimeAgo(timestamp: Long): String {
        if (timestamp <= 0) return ""
        val diff = System.currentTimeMillis() - timestamp
        val sec = diff / 1000
        val min = sec / 60
        val hr = min / 60
        return when {
            min < 1 -> "now"
            min < 60 -> "${min}m ago"
            hr < 24 -> "${hr}h ago"
            else -> "${hr / 24}d ago"
        }
    }

    fun refreshTimeAgo() {
        if (lastTimestamp > 0) {
            _timeAgo.postValue(formatTimeAgo(lastTimestamp))
        }
    }

    private fun colorForValue(value: Double, unit: String): Int {
        val mgDl = if (unit.equals("mg/dL", true)) value else value * 18.0182
        return when {
            mgDl < 70 -> 0xFFE57373.toInt()   // Red - low
            mgDl <= 180 -> 0xFF81C784.toInt() // Green - in range
            mgDl <= 250 -> 0xFFFFB74D.toInt() // Orange - high
            else -> 0xFFE57373.toInt()        // Red - very high
        }
    }

    private fun statusLabelForValue(value: Double, unit: String): String {
        val mgDl = if (unit.equals("mg/dL", true)) value else value * 18.0182
        return when {
            mgDl < 70 -> "Low"
            mgDl <= 180 -> "In range"
            mgDl <= 250 -> "High"
            else -> "Very high"
        }
    }
}

data class GlycemiaData(
    val value: Double,
    val unit: String,
    val timestamp: Long
)
