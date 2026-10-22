package com.saffist3r.healthcompanion.samsunghealth

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.HealthDataStore
import com.samsung.android.sdk.health.data.error.AuthorizationException
import com.samsung.android.sdk.health.data.error.ErrorCode
import com.samsung.android.sdk.health.data.error.HealthDataException
import com.samsung.android.sdk.health.data.error.ResolvablePlatformException
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalDateFilter
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import com.samsung.android.sdk.health.data.request.LocalTimeGroup
import com.samsung.android.sdk.health.data.request.LocalTimeGroupUnit
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class SamsungHealthModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun getName(): String = "SamsungHealth"

    private fun corePermissions() = setOf(
        Permission.of(DataTypes.STEPS, AccessType.READ),
        Permission.of(DataTypes.ACTIVITY_SUMMARY, AccessType.READ),
        Permission.of(DataTypes.EXERCISE, AccessType.READ),
    )

    private fun optionalPermissions() = setOf(
        Permission.of(DataTypes.ENERGY_SCORE, AccessType.READ),
        Permission.of(DataTypes.HEART_RATE, AccessType.READ),
    )

    private fun allPermissions() = corePermissions() + optionalPermissions()

    @ReactMethod
    fun isAvailable(promise: Promise) {
        executor.execute {
            try {
                promise.resolve(isSamsungHealthInstalled())
            } catch (_: Exception) {
                promise.resolve(false)
            }
        }
    }

    @ReactMethod
    fun requestPermissions(promise: Promise) {
        executor.execute {
            try {
                if (!isSamsungHealthInstalled()) {
                    promise.reject("UNAVAILABLE", "Samsung Health is not installed or too old")
                    return@execute
                }
                val activity: Activity = reactContext.currentActivity
                    ?: run {
                        promise.reject("NO_ACTIVITY", "Open the app and try again")
                        return@execute
                    }

                val store = HealthDataService.getStore(reactContext)

                // Prefer full set (incl. Energy Score). If policy blocks optionals, still get core.
                var granted = emptySet<Permission>()
                try {
                    granted = requestPermissionsBlocking(store, allPermissions(), activity)
                } catch (e: Exception) {
                    Log.w(TAG, "Full permission set failed, retrying core only: ${e.message}")
                    granted = requestPermissionsBlocking(store, corePermissions(), activity)
                }

                // Always try Energy Score on its own — of(today,today) used to fail silently; still need the grant.
                if (!granted.any { it.dataType == DataTypes.ENERGY_SCORE }) {
                    try {
                        val energyGranted = requestPermissionsBlocking(store, optionalPermissions(), activity)
                        granted = granted + energyGranted
                    } catch (e: Exception) {
                        Log.w(TAG, "Optional Energy Score permission failed: ${e.message}")
                    }
                }

                if (granted.isEmpty()) {
                    granted = store.getGrantedPermissionsAsync(corePermissions())
                        .get(20, TimeUnit.SECONDS)
                }
                if (granted.isEmpty()) {
                    promise.reject(
                        "DENIED",
                        "No Samsung Health permissions granted. Allow Steps / Activity in the popup."
                    )
                    return@execute
                }

                val map = Arguments.createMap()
                map.putBoolean("granted", true)
                map.putInt("count", granted.size)
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "requestPermissions failed", e)
                promise.reject(errorCode(e), friendlyMessage(e), e)
            }
        }
    }

    @ReactMethod
    fun getTodayActivity(promise: Promise) {
        getActivityForDate(LocalDate.now().toString(), promise)
    }

    @ReactMethod
    fun getActivityForDate(dateKey: String, promise: Promise) {
        executor.execute {
            try {
                if (!isSamsungHealthInstalled()) {
                    promise.reject("UNAVAILABLE", "Samsung Health is not installed")
                    return@execute
                }
                val day = try {
                    LocalDate.parse(dateKey.trim())
                } catch (_: Exception) {
                    promise.reject("BAD_DATE", "date must be YYYY-MM-DD")
                    return@execute
                }

                val store = HealthDataService.getStore(reactContext)
                val already = store.getGrantedPermissionsAsync(corePermissions())
                    .get(20, TimeUnit.SECONDS)
                if (already.isEmpty()) {
                    promise.reject("DENIED", "Samsung Health permissions not granted")
                    return@execute
                }

                val steps = readStepsForDay(store, day)
                val calories = readCaloriesForDay(store, day)
                val exercise = readExercisesForDay(store, day)

                val map = Arguments.createMap()
                map.putBoolean("available", true)
                map.putInt("steps", steps.toInt().coerceAtLeast(0))
                map.putString("date", day.toString())
                map.putString("source", "samsung_health")
                if (calories != null) {
                    map.putDouble("caloriesBurned", calories)
                }
                map.putArray("workouts", exercise.workouts)
                map.putInt("activeMinutes", exercise.totalMinutes)
                map.putInt("workoutCount", exercise.workouts.size())

                val energyGranted = hasPermission(store, DataTypes.ENERGY_SCORE)
                map.putBoolean("energyScoreGranted", energyGranted)
                // Energy Score is a daily score — only attach when reading today (or nearest day).
                if (day == LocalDate.now()) {
                    val energy = readEnergyScore(store)
                    if (energy != null) {
                        map.putDouble("energyScore", energy.first)
                        map.putString("energyScoreDate", energy.second.toString())
                    } else if (!energyGranted) {
                        map.putString(
                            "energyScoreNote",
                            "Energy Score permission not granted. Tap Connect Samsung Health again and allow Energy Score.",
                        )
                    }
                }

                Log.i(
                    TAG,
                    "Activity $day steps=$steps calories=$calories " +
                        "workouts=${exercise.workouts.size()} activeMin=${exercise.totalMinutes} " +
                        "aggMin=${exercise.aggregateMinutes}"
                )
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "getActivityForDate failed", e)
                promise.reject(errorCode(e), friendlyMessage(e), e)
            }
        }
    }

    private data class ExerciseRead(
        val workouts: WritableArray,
        val totalMinutes: Int,
        val aggregateMinutes: Int,
    )

    private fun dayFilter(day: LocalDate): LocalTimeFilter {
        val start = day.atStartOfDay()
        val end = if (day == LocalDate.now()) {
            LocalDateTime.now()
        } else {
            day.plusDays(1).atStartOfDay()
        }
        return LocalTimeFilter.of(start, end)
    }

    private fun readStepsForDay(store: HealthDataStore, day: LocalDate): Long {
        val filter = dayFilter(day)

        // Prefer hourly buckets then sum — matches Samsung Health pedometer total more reliably.
        try {
            val hourly = DataType.StepsType.TOTAL.requestBuilder
                .setLocalTimeFilterWithGroup(
                    filter,
                    LocalTimeGroup.of(LocalTimeGroupUnit.HOURLY, 1),
                )
                .build()
            val response = store.aggregateDataAsync(hourly).get(30, TimeUnit.SECONDS)
            var total = 0L
            for (item in response.dataList) {
                total += toLong(item.value)
            }
            if (total > 0L) return total
        } catch (e: Exception) {
            Log.w(TAG, "Hourly steps failed: ${e.message}")
        }

        val request = DataType.StepsType.TOTAL.requestBuilder
            .setLocalTimeFilter(filter)
            .build()
        val response = store.aggregateDataAsync(request).get(30, TimeUnit.SECONDS)
        var steps = 0L
        for (item in response.dataList) {
            steps += toLong(item.value)
        }
        return steps
    }

    private fun readCaloriesForDay(store: HealthDataStore, day: LocalDate): Double? {
        return try {
            val filter = dayFilter(day)
            val request = DataType.ActivitySummaryType.TOTAL_ACTIVE_CALORIES_BURNED.requestBuilder
                .setLocalTimeFilter(filter)
                .build()
            val response = store.aggregateDataAsync(request).get(20, TimeUnit.SECONDS)
            var total = 0.0
            for (item in response.dataList) {
                total += toDouble(item.value)
            }
            if (total > 0) total else null
        } catch (e: Exception) {
            Log.w(TAG, "Calories unavailable: ${e.message}")
            null
        }
    }

    private fun readExercisesForDay(store: HealthDataStore, day: LocalDate): ExerciseRead {
        val filter = dayFilter(day)
        val workouts = Arguments.createArray()
        var sessionMinutes = 0

        // TOTAL_DURATION uses LocalDateFilter (not LocalTimeFilter). Value is Float minutes.
        val aggregateMinutes = try {
            val dateFilter = LocalDateFilter.of(day, day, true, true)
            val agg = DataType.ExerciseType.TOTAL_DURATION.requestBuilder
                .setLocalDateFilter(dateFilter)
                .build()
            val response = store.aggregateDataAsync(agg).get(30, TimeUnit.SECONDS)
            var total = 0
            for (item in response.dataList) {
                total += when (val v = item.value) {
                    is Float -> floatToMinutes(v)
                    is Double -> floatToMinutes(v.toFloat())
                    else -> durationToMinutes(v)
                }
            }
            total
        } catch (e: Exception) {
            Log.w(TAG, "Exercise TOTAL_DURATION failed: ${e.message}")
            0
        }

        try {
            val request = DataTypes.EXERCISE.readDataRequestBuilder
                .setLocalTimeFilter(filter)
                .build()
            val response = store.readDataAsync(request).get(30, TimeUnit.SECONDS)
            for (point in response.dataList) {
                val customTitle = try {
                    point.getValue(DataType.ExerciseType.CUSTOM_TITLE)?.toString()?.trim()
                } catch (_: Exception) {
                    null
                }
                val exerciseType = try {
                    point.getValue(DataType.ExerciseType.EXERCISE_TYPE)
                } catch (_: Exception) {
                    null
                }
                val typeLabel = exerciseType?.toString()?.replace('_', ' ')?.lowercase()
                    ?.replaceFirstChar { it.titlecase() }
                    ?: "Workout"
                val baseName = when {
                    !customTitle.isNullOrBlank() -> customTitle
                    else -> typeLabel
                }

                val sessions = try {
                    point.getValue(DataType.ExerciseType.SESSIONS)
                } catch (_: Exception) {
                    null
                }

                if (!sessions.isNullOrEmpty()) {
                    for (session in sessions) {
                        val mins = durationToMinutes(session.duration).coerceAtLeast(
                            wallClockMinutes(session.startTime, session.endTime)
                        )
                        if (mins <= 0) continue
                        val sessionType = session.exerciseType?.name
                            ?.replace('_', ' ')
                            ?.lowercase()
                            ?.replaceFirstChar { it.titlecase() }
                        val calories = session.calories?.toDouble()
                        sessionMinutes += mins
                        workouts.pushMap(
                            workoutMap(
                                name = sessionType?.takeIf { it.isNotBlank() } ?: baseName,
                                durationMin = mins,
                                calories = calories,
                            )
                        )
                    }
                } else {
                    val mins = wallClockMinutes(point.startTime, point.endTime)
                    if (mins > 0) {
                        sessionMinutes += mins
                        workouts.pushMap(workoutMap(baseName, mins, null))
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Exercise read failed: ${e.message}")
        }

        // If aggregate total is clearly higher than session sum (common when some
        // auto-detected sessions lack detail), add a catch-up row so reports match Samsung.
        val totalMinutes = maxOf(sessionMinutes, aggregateMinutes)
        if (aggregateMinutes > sessionMinutes + 5) {
            val gap = aggregateMinutes - sessionMinutes
            workouts.pushMap(
                workoutMap(
                    name = "Other exercise",
                    durationMin = gap,
                    calories = null,
                )
            )
            Log.i(TAG, "Exercise aggregate $aggregateMinutes > sessions $sessionMinutes; added ${gap}m gap")
        }

        return ExerciseRead(
            workouts = workouts,
            totalMinutes = totalMinutes,
            aggregateMinutes = aggregateMinutes,
        )
    }

    private fun workoutMap(name: String, durationMin: Int, calories: Double?): WritableMap {
        val m = Arguments.createMap()
        m.putString("name", name.ifBlank { "Workout" })
        m.putInt("durationMin", durationMin)
        if (calories != null && calories > 0) {
            m.putDouble("calories", calories)
        }
        return m
    }

    private fun wallClockMinutes(start: Any?, end: Any?): Int {
        if (start == null || end == null) return 0
        return try {
            when {
                start is Instant && end is Instant ->
                    Duration.between(start, end).toMinutes().toInt().coerceAtLeast(0)
                start is LocalDateTime && end is LocalDateTime ->
                    Duration.between(start, end).toMinutes().toInt().coerceAtLeast(0)
                else -> {
                    val sm = instantMillis(start) ?: return 0
                    val em = instantMillis(end) ?: return 0
                    ((em - sm) / 60000L).toInt().coerceAtLeast(0)
                }
            }
        } catch (_: Exception) {
            0
        }
    }

    private fun instantMillis(value: Any): Long? {
        return when (value) {
            is Instant -> value.toEpochMilli()
            is Long -> value
            is Number -> value.toLong()
            else -> null
        }
    }

    private fun floatToMinutes(value: Float): Int {
        if (value <= 0f) return 0
        // TOTAL_DURATION is documented as duration; SDKs sometimes return seconds as Float.
        return if (value > 24f * 60f) (value / 60f).toInt().coerceAtLeast(0)
        else value.toInt().coerceAtLeast(0)
    }

    private fun durationToMinutes(value: Any?): Int {
        if (value == null) return 0
        return try {
            when (value) {
                is Duration -> value.toMinutes().toInt().coerceAtLeast(0)
                is Long -> {
                    // SDK may return millis or minutes — treat large values as millis.
                    if (value > 24L * 60L) (value / 60000L).toInt().coerceAtLeast(0)
                    else value.toInt().coerceAtLeast(0)
                }
                is Int -> {
                    if (value > 24 * 60) (value / 60000).coerceAtLeast(0)
                    else value.coerceAtLeast(0)
                }
                is Number -> durationToMinutes(value.toLong())
                else -> {
                    // Reflective Duration-like
                    try {
                        val mins = value.javaClass.getMethod("toMinutes").invoke(value) as? Long
                        mins?.toInt()?.coerceAtLeast(0) ?: 0
                    } catch (_: Exception) {
                        0
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "durationToMinutes failed for ${value::class.java.name}: ${e.message}")
            0
        }
    }

    private fun requestPermissionsBlocking(
        store: HealthDataStore,
        perms: Set<Permission>,
        activity: Activity,
    ): Set<Permission> {
        return try {
            store.requestPermissionsAsync(perms, activity).get(90, TimeUnit.SECONDS)
        } catch (e: Exception) {
            val cause = unwrap(e)
            if (cause is ResolvablePlatformException && cause.hasResolution) {
                mainHandler.post { cause.resolve(activity) }
            }
            throw cause
        }
    }

    private fun hasPermission(store: HealthDataStore, type: DataType): Boolean {
        return try {
            val granted = store.getGrantedPermissionsAsync(setOf(Permission.of(type, AccessType.READ)))
                .get(10, TimeUnit.SECONDS)
            granted.isNotEmpty()
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Energy Score uses LocalDateFilter. The 2-arg of(start, end) has inclusiveEnd=false,
     * so of(today, today) matches nothing — always pass inclusive end, or use a range.
     */
    private fun readEnergyScore(store: HealthDataStore): Pair<Double, LocalDate>? {
        return try {
            val today = LocalDate.now()
            val start = today.minusDays(7)
            val filter = LocalDateFilter.of(start, today, true, true)
            val request = DataTypes.ENERGY_SCORE.readDataRequestBuilder
                .setLocalDateFilter(filter)
                .build()
            val response = store.readDataAsync(request).get(20, TimeUnit.SECONDS)
            var best: Pair<Double, LocalDate>? = null
            for (point in response.dataList) {
                val value = point.getValue(DataType.EnergyScoreType.ENERGY_SCORE) ?: continue
                val score = toDouble(value)
                if (score <= 0.0) continue
                val day = try {
                    point.startTime.atZone(java.time.ZoneId.systemDefault()).toLocalDate()
                } catch (_: Exception) {
                    today
                }
                if (best == null || !day.isBefore(best.second)) {
                    best = score to day
                }
            }
            if (best != null) {
                Log.i(TAG, "Energy Score ${best.first} for ${best.second} (${response.dataList.size} points)")
            } else {
                Log.w(TAG, "Energy Score: no points in last 7 days (filter inclusive)")
            }
            best
        } catch (e: Exception) {
            Log.w(TAG, "Energy Score unavailable: ${e.message}")
            null
        }
    }

    private fun toLong(value: Any?): Long {
        return when (value) {
            null -> 0L
            is Long -> value
            is Int -> value.toLong()
            is Number -> value.toLong()
            else -> value.toString().toLongOrNull() ?: 0L
        }
    }

    private fun toDouble(value: Any?): Double {
        return when (value) {
            null -> 0.0
            is Double -> value
            is Float -> value.toDouble()
            is Number -> value.toDouble()
            else -> value.toString().toDoubleOrNull() ?: 0.0
        }
    }

    private fun unwrap(e: Throwable): Throwable {
        var cur = e
        while (cur.cause != null && cur !is HealthDataException) {
            cur = cur.cause!!
        }
        return cur
    }

    private fun asHealthException(e: Throwable): HealthDataException? =
        e as? HealthDataException ?: (unwrap(e) as? HealthDataException)

    private fun errorCode(e: Throwable): String {
        val hde = asHealthException(e)
        return when (hde?.errorCode) {
            ErrorCode.ERR_ACCESS_CONTROL,
            ErrorCode.ERR_INVALID_PLATFORM_SIGNATURE,
            -> "POLICY"
            ErrorCode.ERR_NO_USER_PERMISSION -> "DENIED"
            ErrorCode.ERR_PLATFORM_NOT_INSTALLED -> "UNAVAILABLE"
            ErrorCode.ERR_OLD_VERSION_PLATFORM -> "OLD_PLATFORM"
            else -> if (
                e is AuthorizationException ||
                unwrap(e) is AuthorizationException ||
                (e.message?.contains("policy", true) == true)
            ) {
                "POLICY"
            } else {
                "PERMISSION_ERROR"
            }
        }
    }

    private fun friendlyMessage(e: Throwable): String {
        val hde = asHealthException(e)
        val msg = hde?.errorMessage ?: e.message.orEmpty()
        val code = hde?.errorCode
        if (
            code == ErrorCode.ERR_ACCESS_CONTROL ||
            code == ErrorCode.ERR_INVALID_PLATFORM_SIGNATURE ||
            msg.contains("policy", ignoreCase = true) ||
            e is AuthorizationException ||
            unwrap(e) is AuthorizationException
        ) {
            return "Samsung blocked this app (policy). In Samsung Health: Settings → About Samsung Health → tap the version 10+ times → Developer Mode (Samsung Health Data SDK) → turn on Developer Mode for Data Read. Then try Connect again."
        }
        if (unwrap(e) is ResolvablePlatformException || e is ResolvablePlatformException) {
            return "Samsung Health needs an update or install. Follow the on-screen prompt, then try again."
        }
        return msg.ifBlank { "Samsung Health permission request failed" }
    }

    private fun isSamsungHealthInstalled(): Boolean {
        return try {
            val info = reactContext.packageManager.getPackageInfo(SAMSUNG_HEALTH_PACKAGE, 0)
            @Suppress("DEPRECATION")
            info.versionCode >= MIN_VERSION
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    companion object {
        private const val TAG = "SamsungHealth"
        private const val SAMSUNG_HEALTH_PACKAGE = "com.sec.android.app.shealth"
        private const val MIN_VERSION = 6030002
    }
}
