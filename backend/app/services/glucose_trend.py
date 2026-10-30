"""CGM trend engine, server side. Mirrors the watch's GlucoseTrendEngine.kt and the phone's
packages/shared/src/glucoseTrend.ts so the live page shows the same arrow, forecast and alerts.

Rate = recency-weighted least-squares slope over the last ~10 minutes (wider when readings are
sparse), classified with the standard CGM rate bands; the forecast damps that rate.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

STALE_AFTER_MS = 15 * 60 * 1000
PREDICTION_MINUTES = 30

_FIT_WINDOW_MS = 10 * 60 * 1000
_FIT_WINDOW_SPARSE_MS = 35 * 60 * 1000
_MIN_FIT_SPAN_MS = 4 * 60 * 1000
_MERGE_WITHIN_MS = 45_000
_RECENCY_TAU_MIN = 5.0  # recent readings count more: weight halves every ~3.5 min
_MAX_RATE = 6.0  # glucose rarely changes faster; larger slopes are sensor glitches
_DAMPING_TAU_MIN = 35.0
_MIN_ALERT_RATE = 0.4
_URGENT_LOW = 54.0
_VERY_HIGH = 250.0


@dataclass
class Sample:
    mg_dl: float
    timestamp: int  # ms


@dataclass
class Insight:
    current: Sample | None
    age_ms: int = 0
    is_stale: bool = True
    rate_per_min: float | None = None
    arrow: str = "none"
    confidence: float = 0.0
    zone: str = "unknown"
    prediction: list[Sample] = field(default_factory=list)
    predicted_20_min: float | None = None
    minutes_to_low: int | None = None
    minutes_to_high: int | None = None
    time_in_range_pct: int | None = None


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def analyze(history: list[Sample], now_ms: int, low: float = 70.0, high: float = 180.0) -> Insight:
    samples = sanitize(history)
    if not samples:
        return Insight(current=None)
    current = samples[-1]
    age_ms = max(0, now_ms - current.timestamp)
    is_stale = age_ms > STALE_AFTER_MS
    tir = _time_in_range(samples, low, high)
    zone = zone_for(current.mg_dl, low, high)

    fit = None if is_stale else _fit_rate(samples, current)
    if fit is None:
        return Insight(current=current, age_ms=age_ms, is_stale=is_stale, zone=zone, time_in_range_pct=tir)

    rate, confidence = fit
    prediction = [
        Sample(project(current.mg_dl, rate, step * 5.0), current.timestamp + step * 5 * 60_000)
        for step in range(1, PREDICTION_MINUTES // 5 + 1)
    ]
    to_low = _minutes_until(current.mg_dl, rate, low) if rate <= -_MIN_ALERT_RATE and current.mg_dl >= low else None
    to_high = _minutes_until(current.mg_dl, rate, high) if rate >= _MIN_ALERT_RATE and current.mg_dl <= high else None
    return Insight(
        current=current,
        age_ms=age_ms,
        is_stale=False,
        rate_per_min=rate,
        arrow=arrow_for(rate),
        confidence=confidence,
        zone=zone,
        prediction=prediction,
        predicted_20_min=project(current.mg_dl, rate, 20.0),
        minutes_to_low=to_low,
        minutes_to_high=to_high,
        time_in_range_pct=tir,
    )


def arrow_for(rate: float) -> str:
    if rate >= 3:
        return "doubleUp"
    if rate >= 2:
        return "singleUp"
    if rate >= 1:
        return "fortyFiveUp"
    if rate > -1:
        return "flat"
    if rate > -2:
        return "fortyFiveDown"
    if rate > -3:
        return "singleDown"
    return "doubleDown"


def zone_for(mg_dl: float, low: float = 70.0, high: float = 180.0) -> str:
    if mg_dl < _URGENT_LOW:
        return "urgentLow"
    if mg_dl < low:
        return "low"
    if mg_dl <= high:
        return "inRange"
    if mg_dl <= _VERY_HIGH:
        return "high"
    return "veryHigh"


def project(current: float, rate: float, minutes: float) -> float:
    """Damped projection: v0 + r·τ·(1 − e^(−t/τ)), clamped to what sensors report."""
    travelled = rate * _DAMPING_TAU_MIN * (1 - math.exp(-minutes / _DAMPING_TAU_MIN))
    return _clamp(current + travelled, 39.0, 401.0)


def _minutes_until(current: float, rate: float, target: float) -> int | None:
    needed = target - current
    ratio = 1 - needed / (rate * _DAMPING_TAU_MIN)
    if ratio <= 0 or ratio >= 1 + 1e-9:
        return 0 if abs(needed) < 1e-9 else None
    minutes = -_DAMPING_TAU_MIN * math.log(ratio)
    return int(minutes) if 0 <= minutes <= PREDICTION_MINUTES else None


def _fit_rate(samples: list[Sample], current: Sample) -> tuple[float, float] | None:
    window = [s for s in samples if s.timestamp >= current.timestamp - _FIT_WINDOW_MS]
    if len(window) < 3:
        window = [s for s in samples if s.timestamp >= current.timestamp - _FIT_WINDOW_SPARSE_MS]
    if len(window) < 2:
        return None
    span_ms = current.timestamp - window[0].timestamp
    if span_ms < _MIN_FIT_SPAN_MS:
        return None

    xs = [(s.timestamp - current.timestamp) / 60_000 for s in window]
    ys = [s.mg_dl for s in window]
    ws = [math.exp(x / _RECENCY_TAU_MIN) for x in xs]
    w_sum = sum(ws)
    x_mean = sum(w * x for w, x in zip(ws, xs, strict=True)) / w_sum
    y_mean = sum(w * y for w, y in zip(ws, ys, strict=True)) / w_sum
    sxx = sum(w * (x - x_mean) ** 2 for w, x in zip(ws, xs, strict=True))
    sxy = sum(w * (x - x_mean) * (y - y_mean) for w, x, y in zip(ws, xs, ys, strict=True))
    if sxx <= 1e-9:
        return None
    rate = _clamp(sxy / sxx, -_MAX_RATE, _MAX_RATE)
    residual = sum(w * (y - (y_mean + rate * (x - x_mean))) ** 2 for w, x, y in zip(ws, xs, ys, strict=True))
    rms = math.sqrt(residual / w_sum)
    fit_quality = _clamp(1 - rms / 12, 0, 1)
    count_factor = min(len(window) / 4, 1)
    span_factor = min(span_ms / (10 * 60_000), 1)
    return rate, fit_quality * count_factor * (0.5 + 0.5 * span_factor)


def sanitize(history: list[Sample]) -> list[Sample]:
    """Oldest → newest, plausible values only, near-duplicate re-posts merged (latest wins)."""
    ordered = sorted((s for s in history if s.timestamp > 0 and 20 <= s.mg_dl <= 600), key=lambda s: s.timestamp)
    out: list[Sample] = []
    for s in ordered:
        if out and s.timestamp - out[-1].timestamp < _MERGE_WITHIN_MS:
            out[-1] = s
        else:
            out.append(s)
    return out


def _time_in_range(samples: list[Sample], low: float, high: float) -> int | None:
    if len(samples) < 3:
        return None
    # Round half up, like Math.round on the watch and phone (Python's round() rounds to even)
    return int(sum(1 for s in samples if low <= s.mg_dl <= high) * 100 / len(samples) + 0.5)
