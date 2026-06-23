package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

object GlycemiaHolder {
    private const val PREFS = "health_companion_glycemia"
    private const val KEY_HISTORY_JSON = "history_json"
    private const val MAX_HISTORY = 150
    private const val SPARKLINE_WINDOW_MS = 12L * 60 * 60 * 1000
    private const val DUPLICATE_MS = 5_000L

    /** Same band as status "Low" (mg/dL < 70); vibrate once per new reading from the phone. */
    private const val LOW_MG_DL_THRESHOLD = 70.0

    private var appContext: Context? = null
    private var previousTimestamp: Long = -1L

    private val _glycemia = MutableLiveData<GlycemiaData>()
    val glycemia: LiveData<GlycemiaData> = _glycemia

    private val _glycemiaDisplay = MutableLiveData<String>("--")
    val glycemiaDisplay: LiveData<String> = _glycemiaDisplay

    private val _timeAgo = MutableLiveData<String>("")
    val timeAgo: LiveData<String> = _timeAgo

    private val _statusColor = MutableLiveData<Int>(0xFF80CBC4.toInt())
    val statusColor: LiveData<Int> = _statusColor

    private val _statusLabel = MutableLiveData<String>("")
    val statusLabel: LiveData<String> = _statusLabel

    private val _historyRevision = MutableLiveData(0)
    val historyRevision: LiveData<Int> = _historyRevision

    private var lastTimestamp: Long = 0

    /** (mg/dL, timestamp) newest first */
    private val _history = CopyOnWriteArrayList<Pair<Double, Long>>()

    fun init(context: Context) {
        appContext = context.applicationContext
        loadHistoryFromPrefs()
        pruneOldHistory()
    }

    @Deprecated("Use getSparklinePoints12h()")
    fun getHistoryForSparkline(): List<Pair<Double, Long>> = getSparklinePoints12h()

    /** Oldest → newest, fixed 12h window ending at now. */
    fun getSparklinePoints12h(): List<Pair<Double, Long>> {
        val now = System.currentTimeMillis()
        val start = now - SPARKLINE_WINDOW_MS
        return _history
            .filter { it.second in start..now }
            .sortedBy { it.second }
    }

    fun mergeHistoryFromPhone(points: List<Pair<Double, Long>>) {
        if (points.isEmpty()) return
        for ((v, ts) in points) {
            if (ts <= 0) continue
            val dup = _history.any { Math.abs(it.second - ts) < DUPLICATE_MS }
            if (!dup) _history.add(0, v to ts)
        }
        sortAndPruneHistory()
        persistHistory()
    }

    fun update(value: Double, unit: String, timestamp: Long) {
        val isNewSample = timestamp > 0 && timestamp != previousTimestamp
        previousTimestamp = timestamp
        lastTimestamp = timestamp
        val mgDl = if (unit.equals("mg/dL", true)) value else value * 18.0182

        if (isNewSample) {
            val dup = _history.any { Math.abs(it.second - timestamp) < DUPLICATE_MS }
            if (!dup) {
                _history.add(0, mgDl to timestamp)
                sortAndPruneHistory()
                persistHistory()
            }
        }

        _glycemia.postValue(GlycemiaData(value, unit, timestamp))
        _glycemiaDisplay.postValue("%.1f %s".format(value, unit))
        _timeAgo.postValue(formatTimeAgo(timestamp))
        _statusColor.postValue(colorForValue(value, unit))
        _statusLabel.postValue(statusLabelForValue(value, unit))

        if (isNewSample && mgDl < LOW_MG_DL_THRESHOLD) {
            vibrateLowAlert()
        }
    }

    private fun sortAndPruneHistory() {
        val now = System.currentTimeMillis()
        val start = now - SPARKLINE_WINDOW_MS
        val sorted = _history
            .filter { it.second >= start }
            .distinctBy { it.second }
            .sortedByDescending { it.second }
            .take(MAX_HISTORY)
        _history.clear()
        _history.addAll(sorted)
        _historyRevision.postValue((_historyRevision.value ?: 0) + 1)
    }

    private fun pruneOldHistory() {
        sortAndPruneHistory()
    }

    private fun persistHistory() {
        val ctx = appContext ?: return
        try {
            val arr = JSONArray()
            for ((v, ts) in _history.sortedBy { it.second }) {
                arr.put(JSONObject().put("v", v).put("t", ts))
            }
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_HISTORY_JSON, arr.toString())
                .apply()
        } catch (_: Exception) {
        }
    }

    private fun loadHistoryFromPrefs() {
        val ctx = appContext ?: return
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_HISTORY_JSON, null) ?: return
        try {
            val arr = JSONArray(raw)
            _history.clear()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                _history.add(o.getDouble("v") to o.getLong("t"))
            }
            sortAndPruneHistory()
        } catch (_: Exception) {
        }
    }

    private fun vibrateLowAlert() {
        val ctx = appContext ?: return
        val vibrator = getVibrator(ctx) ?: return
        if (!vibrator.hasVibrator()) return

        val pattern = longArrayOf(0, 280, 140, 280)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, -1)
        }
    }

    private fun getVibrator(context: Context): Vibrator? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    private fun formatTimeAgo(timestamp: Long): String {
        if (timestamp <= 0) return ""
        val diff = System.currentTimeMillis() - timestamp
        val min = diff / 60000
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
            mgDl < 70 -> 0xFFE57373.toInt()
            mgDl <= 180 -> 0xFF81C784.toInt()
            mgDl <= 250 -> 0xFFFFB74D.toInt()
            else -> 0xFFE57373.toInt()
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
