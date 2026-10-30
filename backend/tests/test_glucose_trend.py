"""Same cases as the watch's GlucoseTrendEngineTest.kt and the shared TypeScript tests."""

from app.services.glucose_trend import Sample, analyze, sanitize, zone_for

NOW = 1_800_000_000_000
MIN = 60_000

RISING = {"doubleUp", "singleUp", "fortyFiveUp"}


def series(values, step_min=5, end_ago_min=1):
    n = len(values)
    return [Sample(v, NOW - (end_ago_min + (n - 1 - i) * step_min) * MIN) for i, v in enumerate(values)]


def test_steady_readings_are_flat():
    i = analyze(series([120, 121, 119, 120, 121]), NOW)
    assert i.arrow == "flat"
    assert i.zone == "inRange"
    assert i.minutes_to_low is None


def test_slow_drift_over_two_hours_is_not_a_trend():
    i = analyze(series([110, 112, 115, 117, 119], step_min=25), NOW)
    assert i.arrow in ("flat", "none")


def test_rate_bands_match_cgm_arrows():
    assert analyze(series([100, 107, 114, 121]), NOW).arrow == "fortyFiveUp"
    assert analyze(series([100, 112, 124, 136]), NOW).arrow == "singleUp"
    assert analyze(series([100, 117, 134, 151]), NOW).arrow == "doubleUp"
    assert analyze(series([160, 153, 146, 139]), NOW).arrow == "fortyFiveDown"
    assert analyze(series([160, 148, 136, 124]), NOW).arrow == "singleDown"
    assert analyze(series([180, 162, 144, 126]), NOW).arrow == "doubleDown"


def test_recent_turnaround_wins_over_older_trend():
    i = analyze(series([150, 140, 130, 122, 118, 120, 126, 133], step_min=2), NOW)
    assert i.arrow in RISING, (i.arrow, i.rate_per_min)


def test_single_noisy_spike_does_not_flip_the_trend():
    assert analyze(series([120, 121, 120, 132, 121, 120], step_min=3), NOW).arrow == "flat"


def test_one_minute_sensor_jitter_stays_flat():
    noise = [0, 3, -2, 4, -4, 1, -3, 2, -1, 4, -2, 0, 3, -4, 2]
    all_ = [Sample(120 + n, NOW - (len(noise) - i) * MIN) for i, n in enumerate(noise)]
    for end in range(6, len(all_) + 1):
        window = all_[:end]
        assert analyze(window, window[-1].timestamp + MIN).arrow == "flat", end


def test_one_minute_steady_fall_is_caught():
    all_ = [Sample(140 - i * 2.2 + (2 if i % 2 == 0 else -2), NOW - (12 - i) * MIN) for i in range(12)]
    assert analyze(all_, NOW).arrow == "singleDown"


def test_stale_data_has_no_trend_or_forecast():
    i = analyze(series([100, 110, 120, 130], end_ago_min=25), NOW)
    assert i.is_stale
    assert i.arrow == "none"
    assert i.prediction == []


def test_too_few_or_too_close_readings_have_no_trend():
    assert analyze(series([120]), NOW).arrow == "none"
    assert analyze(series([120, 140], step_min=1), NOW).arrow == "none"
    assert analyze([], NOW).current is None


def test_re_posted_duplicates_are_merged():
    base = series([120, 125, 130])
    dupes = base + [Sample(s.mg_dl, s.timestamp + 10_000) for s in base]
    assert len(sanitize(dupes)) == 3


def test_predicts_low_before_it_happens():
    i = analyze(series([136, 124, 112, 100]), NOW)
    assert i.minutes_to_low is not None and 10 <= i.minutes_to_low <= 20
    assert i.predicted_20_min < 70
    assert i.minutes_to_high is None


def test_forecast_is_damped_not_linear():
    i = analyze(series([100, 110, 120, 130]), NOW)
    linear30 = 130 + i.rate_per_min * 30
    damped30 = i.prediction[-1].mg_dl
    assert 130 < damped30 < linear30
    assert len(i.prediction) == 6


def test_predicts_high_when_rising_towards_ceiling():
    i = analyze(series([130, 142, 154, 166]), NOW)
    assert i.minutes_to_high is not None
    assert i.minutes_to_low is None


def test_zones_and_time_in_range():
    assert zone_for(50) == "urgentLow"
    assert zone_for(65) == "low"
    assert zone_for(200) == "high"
    assert zone_for(260) == "veryHigh"
    assert analyze(series([60, 100, 150, 200]), NOW).time_in_range_pct == 50
