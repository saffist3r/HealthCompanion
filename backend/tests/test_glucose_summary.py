from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.glucose_stats import find_hypo_events, summarize_glucose, to_mg_dl

T0 = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)


def sample(minutes: int, value: float, unit: str = "mg/dL") -> SimpleNamespace:
    return SimpleNamespace(timestamp=T0 + timedelta(minutes=minutes), value=value, unit=unit)


def point(minutes: int, mg: float) -> dict:
    return {"timestamp": int((T0 + timedelta(minutes=minutes)).timestamp() * 1000), "mgDl": mg}


def test_empty_day_has_no_tir() -> None:
    out = summarize_glucose("2026-01-01", [])
    assert out["readingCount"] == 0
    assert out["timeInRangePct"] is None


def test_time_in_range_uses_inclusive_bounds() -> None:
    samples = [sample(0, 70), sample(5, 180), sample(10, 69), sample(15, 181)]
    out = summarize_glucose("2026-01-01", samples)
    assert out["timeInRangePct"] == 50.0
    assert out["lowCount"] == 1
    assert out["highCount"] == 1
    assert out["minMgDl"] == 69
    assert out["maxMgDl"] == 181


def test_custom_tir_targets() -> None:
    samples = [sample(0, 75), sample(5, 150), sample(10, 165)]
    out = summarize_glucose("2026-01-01", samples, tir_low=80, tir_high=160)
    assert out["timeInRangePct"] == round(1 / 3 * 1000) / 10
    assert out["tirLowMgDl"] == 80
    assert out["tirHighMgDl"] == 160


def test_mmol_readings_are_converted() -> None:
    assert to_mg_dl(5.5, "mmol/L") == 5.5 * 18.0182
    assert to_mg_dl(100, "mg/dL") == 100
    out = summarize_glucose("2026-01-01", [sample(0, 5.5, "mmol/L")])
    assert out["avgMgDl"] == 99.1


def test_unsorted_samples_are_ordered() -> None:
    out = summarize_glucose("2026-01-01", [sample(10, 120), sample(0, 100)])
    assert [r["mgDl"] for r in out["readings"]] == [100, 120]


def test_hypo_readings_collapse_into_one_episode() -> None:
    events = find_hypo_events([point(0, 65), point(5, 58), point(10, 62), point(15, 90)])
    assert len(events) == 1
    assert events[0]["minMgDl"] == 58
    assert events[0]["readingCount"] == 3
    assert events[0]["durationMin"] == 10


def test_hypo_gap_starts_new_episode() -> None:
    events = find_hypo_events([point(0, 60), point(45, 60)])
    assert len(events) == 2


def test_recovery_between_lows_splits_episodes() -> None:
    events = find_hypo_events([point(0, 60), point(5, 100), point(10, 60)])
    assert len(events) == 2
