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
        executor.execute {
            try {
                if (!isSamsungHealthInstalled()) {
                    promise.reject("UNAVAILABLE", "Samsung Health is not installed")
                    return@execute
                }
                val store = HealthDataService.getStore(reactContext)
                val already = store.getGrantedPermissionsAsync(corePermissions())
                    .get(20, TimeUnit.SECONDS)
                if (already.isEmpty()) {
                    promise.reject("DENIED", "Samsung Health permissions not granted")
                    return@execute
                }

                val steps = readTodaySteps(store)
                val calories = readTodayCalories(store)

                val map = Arguments.createMap()
                map.putBoolean("available", true)
                map.putInt("steps", steps.toInt().coerceAtLeast(0))
                map.putString("date", LocalDate.now().toString())
                map.putString("source", "samsung_health")
                if (calories != null) {
                    map.putDouble("caloriesBurned", calories)
                }

                val energyGranted = hasPermission(store, DataTypes.ENERGY_SCORE)
                map.putBoolean("energyScoreGranted", energyGranted)
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

                Log.i(TAG, "Today activity steps=$steps calories=$calories energy=${energy?.first}")
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "getTodayActivity failed", e)
                promise.reject(errorCode(e), friendlyMessage(e), e)
            }
        }
    }

    private fun readTodaySteps(store: HealthDataStore): Long {
        val start = LocalDate.now().atStartOfDay()
        val end = LocalDateTime.now()
        val filter = LocalTimeFilter.of(start, end)

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

    private fun readTodayCalories(store: HealthDataStore): Double? {
        return try {
            val start = LocalDate.now().atStartOfDay()
            val end = LocalDateTime.now()
            val filter = LocalTimeFilter.of(start, end)
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
