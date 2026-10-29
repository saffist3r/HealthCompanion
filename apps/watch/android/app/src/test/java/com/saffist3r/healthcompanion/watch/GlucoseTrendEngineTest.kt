package com.saffist3r.healthcompanion.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GlucoseTrendEngineTest {
    private val now = 1_800_000_000_000L
    private val min = 60_000L

    /** Readings every [stepMin] minutes ending at [endAgoMin] minutes before now, values oldest → newest. */
    private fun series(vararg values: Double, stepMin: Int = 5, endAgoMin: Int = 1): List<GlucoseSample> =
        values.mapIndexed { i, v ->
            GlucoseSample(v, now - (endAgoMin + (values.size - 1 - i) * stepMin) * min)
        }

    @Test fun steadyReadingsAreFlat() {
        val insight = GlucoseTrendEngine.analyze(series(120.0, 121.0, 119.0, 120.0, 121.0), now)
        assertEquals(TrendArrow.FLAT, insight.arrow)
        assertEquals(GlucoseZone.IN_RANGE, insight.zone)
        assertNull(insight.minutesToLow)
    }

    @Test fun slowDriftOverTwoHoursIsNotATrend() {
        // Old detector: +9 mg/dL between first and last point ⇒ "rising". It's ~0.1 mg/dL/min.
        val insight = GlucoseTrendEngine.analyze(series(110.0, 112.0, 115.0, 117.0, 119.0, stepMin = 25), now)
        assertTrue(insight.arrow == TrendArrow.FLAT || insight.arrow == TrendArrow.NONE)
    }

    @Test fun rateBandsMatchCgmArrows() {
        assertEquals(TrendArrow.FORTY_FIVE_UP, GlucoseTrendEngine.analyze(series(100.0, 107.0, 114.0, 121.0), now).arrow)
        assertEquals(TrendArrow.SINGLE_UP, GlucoseTrendEngine.analyze(series(100.0, 112.0, 124.0, 136.0), now).arrow)
        assertEquals(TrendArrow.DOUBLE_UP, GlucoseTrendEngine.analyze(series(100.0, 117.0, 134.0, 151.0), now).arrow)
        assertEquals(TrendArrow.FORTY_FIVE_DOWN, GlucoseTrendEngine.analyze(series(160.0, 153.0, 146.0, 139.0), now).arrow)
        assertEquals(TrendArrow.SINGLE_DOWN, GlucoseTrendEngine.analyze(series(160.0, 148.0, 136.0, 124.0), now).arrow)
        assertEquals(TrendArrow.DOUBLE_DOWN, GlucoseTrendEngine.analyze(series(180.0, 162.0, 144.0, 126.0), now).arrow)
    }

    @Test fun recentTurnaroundWinsOverOlderTrend() {
        // Was falling for 15 min, now clearly rising for the last 10 min.
        val insight = GlucoseTrendEngine.analyze(
            series(150.0, 140.0, 130.0, 122.0, 118.0, 120.0, 126.0, 133.0, stepMin = 2), now
        )
        assertTrue("expected rising, got ${insight.arrow} (${insight.ratePerMin})", insight.arrow.isRising)
    }

    @Test fun singleNoisySpikeDoesNotFlipTheTrend() {
        val insight = GlucoseTrendEngine.analyze(series(120.0, 121.0, 120.0, 132.0, 121.0, 120.0, stepMin = 3), now)
        assertEquals(TrendArrow.FLAT, insight.arrow)
    }

    @Test fun oneMinuteSensorJitterStaysFlat() {
        // Libre-style 1-minute readings around 120 with ±4 mg/dL noise: arrow must not flicker.
        val noise = doubleArrayOf(0.0, 3.0, -2.0, 4.0, -4.0, 1.0, -3.0, 2.0, -1.0, 4.0, -2.0, 0.0, 3.0, -4.0, 2.0)
        val all = noise.mapIndexed { i, n -> GlucoseSample(120.0 + n, now - (noise.size - i) * min) }
        for (end in 6..all.size) {
            val window = all.subList(0, end)
            val at = window.last().timestamp + min
            assertEquals("window ending $end", TrendArrow.FLAT, GlucoseTrendEngine.analyze(window, at).arrow)
        }
    }

    @Test fun oneMinuteSteadyFallIsCaught() {
        val all = (0 until 12).map { i -> GlucoseSample(140.0 - i * 2.2 + (if (i % 2 == 0) 2.0 else -2.0), now - (12 - i) * min) }
        assertEquals(TrendArrow.SINGLE_DOWN, GlucoseTrendEngine.analyze(all, now).arrow)
    }

    @Test fun staleDataHasNoTrendOrForecast() {
        val insight = GlucoseTrendEngine.analyze(series(100.0, 110.0, 120.0, 130.0, endAgoMin = 25), now)
        assertTrue(insight.isStale)
        assertEquals(TrendArrow.NONE, insight.arrow)
        assertTrue(insight.prediction.isEmpty())
    }

    @Test fun tooFewOrTooCloseReadingsHaveNoTrend() {
        assertEquals(TrendArrow.NONE, GlucoseTrendEngine.analyze(series(120.0), now).arrow)
        assertEquals(TrendArrow.NONE, GlucoseTrendEngine.analyze(series(120.0, 140.0, stepMin = 1), now).arrow)
        assertEquals(GlucoseInsight.EMPTY, GlucoseTrendEngine.analyze(emptyList(), now))
    }

    @Test fun rePostedDuplicatesAreMerged() {
        val base = series(120.0, 125.0, 130.0)
        val dupes = base + base.map { it.copy(timestamp = it.timestamp + 10_000) }
        assertEquals(3, GlucoseTrendEngine.sanitize(dupes).size)
    }

    @Test fun predictsLowBeforeItHappens() {
        // 100 mg/dL falling ~2.4 mg/dL/min → under 70 in roughly 15 min.
        val insight = GlucoseTrendEngine.analyze(series(136.0, 124.0, 112.0, 100.0), now)
        val minutes = insight.minutesToLow
        assertNotNull(minutes)
        assertTrue("minutesToLow=$minutes", minutes!! in 10..20)
        assertTrue(insight.predicted20Min!! < 70.0)
        assertNull(insight.minutesToHigh)
    }

    @Test fun forecastIsDampedNotLinear() {
        val insight = GlucoseTrendEngine.analyze(series(100.0, 110.0, 120.0, 130.0), now)
        val linear30 = 130.0 + insight.ratePerMin!! * 30
        val damped30 = insight.prediction.last().mgDl
        assertTrue(damped30 > 130.0 && damped30 < linear30)
        assertEquals(6, insight.prediction.size)
    }

    @Test fun predictsHighWhenRisingTowardsCeiling() {
        val insight = GlucoseTrendEngine.analyze(series(130.0, 142.0, 154.0, 166.0), now)
        assertNotNull(insight.minutesToHigh)
        assertNull(insight.minutesToLow)
    }

    @Test fun zonesAndTimeInRange() {
        assertEquals(GlucoseZone.URGENT_LOW, GlucoseTrendEngine.zoneFor(50.0, 70.0, 180.0))
        assertEquals(GlucoseZone.LOW, GlucoseTrendEngine.zoneFor(65.0, 70.0, 180.0))
        assertEquals(GlucoseZone.HIGH, GlucoseTrendEngine.zoneFor(200.0, 70.0, 180.0))
        assertEquals(GlucoseZone.VERY_HIGH, GlucoseTrendEngine.zoneFor(260.0, 70.0, 180.0))
        val insight = GlucoseTrendEngine.analyze(series(60.0, 100.0, 150.0, 200.0), now)
        assertEquals(50, insight.timeInRangePct)
    }
}
