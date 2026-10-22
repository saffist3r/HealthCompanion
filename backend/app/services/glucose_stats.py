"""Glucose statistics: time in range, hypo episodes, overnight summary."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.models import (
    GlucoseSample,
)


PARIS = ZoneInfo("Europe/Paris")


def to_mg_dl(value: float, unit: str) -> float:
    return value if unit.lower() == "mg/dl" else value * 18.0182


def summarize_glucose(
    date: str,
    samples: list[GlucoseSample],
    *,
    tir_low: float = 70.0,
    tir_high: float = 180.0,
) -> dict[str, Any]:
    if not samples:
        return {
            "date": date,
            "readingCount": 0,
            "avgMgDl": None,
            "minMgDl": None,
            "maxMgDl": None,
            "timeInRangePct": None,
            "lowCount": 0,
            "highCount": 0,
            "hypoEventCount": 0,
            "hypoEvents": [],
            "hyperEventCount": 0,
            "hyperEvents": [],
            "readings": [],
            "tirLowMgDl": tir_low,
            "tirHighMgDl": tir_high,
        }
    ordered = sorted(samples, key=lambda s: s.timestamp or datetime.min)
    points = [
        {
            "mgDl": to_mg_dl(s.value, s.unit),
            "timestamp": int(s.timestamp.timestamp() * 1000) if s.timestamp else 0,
        }
        for s in ordered
    ]
    mg = [p["mgDl"] for p in points]
    in_range = [v for v in mg if tir_low <= v <= tir_high]
    hypo_events = find_hypo_events(points, threshold=tir_low)
    from app.services.diabetes_insights import _hyper_events

    hyper_events = _hyper_events(points, threshold=tir_high)
    readings = [{"timestamp": p["timestamp"], "mgDl": round(float(p["mgDl"]) * 10) / 10} for p in points]
    return {
        "date": date,
        "readingCount": len(mg),
        "avgMgDl": round(sum(mg) / len(mg) * 10) / 10,
        "minMgDl": round(min(mg) * 10) / 10,
        "maxMgDl": round(max(mg) * 10) / 10,
        "timeInRangePct": round(len(in_range) / len(mg) * 1000) / 10,
        "lowCount": len([v for v in mg if v < tir_low]),
        "highCount": len([v for v in mg if v > tir_high]),
        "hypoEventCount": len(hypo_events),
        "hypoEvents": hypo_events,
        "hyperEventCount": len(hyper_events),
        "hyperEvents": hyper_events,
        "readings": readings,
        "tirLowMgDl": tir_low,
        "tirHighMgDl": tir_high,
    }


DEFAULT_HYPO_THRESHOLD_MGDL = 70.0


# Gap between low readings that starts a new episode (ms)
HYPO_GAP_MS = 30 * 60 * 1000


def find_hypo_events(
    points: list[dict[str, Any]],
    *,
    threshold: float = DEFAULT_HYPO_THRESHOLD_MGDL,
) -> list[dict[str, Any]]:
    """Collapse contiguous readings below the personal low threshold into episodes."""
    events: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def close() -> None:
        nonlocal current
        if not current:
            return
        start = int(current["startedAt"])
        end = int(current["endedAt"])
        duration = max(0, round((end - start) / 60000))
        events.append(
            {
                "startedAt": start,
                "endedAt": end,
                "minMgDl": round(float(current["minMgDl"]) * 10) / 10,
                "readingCount": int(current["readingCount"]),
                "durationMin": duration,
            }
        )
        current = None

    for p in points:
        mg = float(p["mgDl"])
        ts = int(p["timestamp"] or 0)
        if mg < threshold:
            if current is None:
                current = {
                    "startedAt": ts,
                    "endedAt": ts,
                    "minMgDl": mg,
                    "readingCount": 1,
                }
            elif ts - int(current["endedAt"]) > HYPO_GAP_MS:
                close()
                current = {
                    "startedAt": ts,
                    "endedAt": ts,
                    "minMgDl": mg,
                    "readingCount": 1,
                }
            else:
                current["endedAt"] = ts
                current["minMgDl"] = min(float(current["minMgDl"]), mg)
                current["readingCount"] = int(current["readingCount"]) + 1
        else:
            close()
    close()
    return events


def overnight_from_samples(date: str, samples: list[GlucoseSample]) -> dict[str, Any]:
    vals: list[float] = []
    for s in samples:
        if not s.timestamp:
            continue
        ts = s.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        local = ts.astimezone(PARIS)
        if local.strftime("%Y-%m-%d") != date:
            continue
        if local.hour >= 6:
            continue
        vals.append(to_mg_dl(s.value, s.unit))
    if len(vals) < 3:
        return {
            "ready": False,
            "blurb": "Overnight plot TBD — not enough CGM tea yet.",
            "readingCount": len(vals),
        }
    mn, mx = min(vals), max(vals)
    dawn_rise = round(vals[-1] - mn, 1)
    if dawn_rise >= 30 and vals[-1] > 140:
        blurb = (
            f"Dawn vibes: dipped to {mn:.0f}, woke near {vals[-1]:.0f} (+{dawn_rise:.0f}). "
            "Classic overnight plot twist."
        )
    elif mx - mn < 25:
        blurb = f"Overnight was oddly civil: {mn:.0f}–{mx:.0f}. Sleep on that win."
    else:
        blurb = f"Night range {mn:.0f}–{mx:.0f}. Not a thriller, not a rom-com."
    return {
        "ready": True,
        "minMgDl": round(mn * 10) / 10,
        "maxMgDl": round(mx * 10) / 10,
        "endMgDl": round(vals[-1] * 10) / 10,
        "dawnRiseMgDl": dawn_rise,
        "readingCount": len(vals),
        "blurb": blurb,
    }


def avg(nums: list[float]) -> float | None:
    if not nums:
        return None
    return round(sum(nums) / len(nums) * 10) / 10
