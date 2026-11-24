package com.saffist3r.healthcompanion.car

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

/**
 * The readings the Android Auto screen draws from. Filled by the same call that feeds the
 * watch (every CamAPS reading), kept in SharedPreferences so the car screen has data even
 * when Android Auto starts the app cold.
 */
object CarGlucoseStore {
    private const val PREFS = "hc_car_glucose"
    private const val KEY_HISTORY = "history"
    private const val KEY_UNIT = "unit"
    private const val KEEP_MS = 3L * 60 * 60 * 1000

    fun interface Listener {
        fun onGlucoseChanged()
    }

    data class Snapshot(val unit: String, val history: List<GlucoseSample>)

    private val listeners = CopyOnWriteArraySet<Listener>()
    private val lock = Any()

    fun addListener(listener: Listener) {
        listeners.add(listener)
    }

    fun removeListener(listener: Listener) {
        listeners.remove(listener)
    }

    /** Store a new reading (mg/dL) plus whatever recent history came with it. */
    fun update(context: Context, latest: GlucoseSample, unit: String, history: List<GlucoseSample>) {
        val merged = synchronized(lock) {
            val cutoff = System.currentTimeMillis() - KEEP_MS
            val byTime = LinkedHashMap<Long, GlucoseSample>()
            (load(context).history + history + latest)
                .filter { it.timestamp >= cutoff }
                .sortedBy { it.timestamp }
                .forEach { byTime[it.timestamp] = it }
            val list = byTime.values.toList()
            save(context, unit, list)
            list
        }
        listeners.forEach { it.onGlucoseChanged() }
        CarGlucoseAlerts.check(context, merged, unit)
    }

    fun snapshot(context: Context): Snapshot = synchronized(lock) { load(context) }

    private fun load(context: Context): Snapshot {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val unit = prefs.getString(KEY_UNIT, null) ?: "mg/dL"
        val history = try {
            val arr = JSONArray(prefs.getString(KEY_HISTORY, "[]"))
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                GlucoseSample(o.getDouble("v"), o.getLong("t"))
            }
        } catch (_: Exception) {
            emptyList()
        }
        return Snapshot(unit, history)
    }

    private fun save(context: Context, unit: String, history: List<GlucoseSample>) {
        val arr = JSONArray()
        history.forEach { arr.put(JSONObject().put("v", it.mgDl).put("t", it.timestamp)) }
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_UNIT, unit)
            .putString(KEY_HISTORY, arr.toString())
            .apply()
    }
}
