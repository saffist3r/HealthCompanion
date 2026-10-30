from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.services import episode_causes as ec

PARIS = ZoneInfo("Europe/Paris")
MIN = 60_000
HOUR = 60 * MIN


def at(hhmm: str, day: str = "2026-10-20") -> int:
    h, m = (int(x) for x in hhmm.split(":"))
    return int(datetime.strptime(day, "%Y-%m-%d").replace(hour=h, minute=m, tzinfo=PARIS).timestamp() * 1000)


def hypo(start: int, minutes: int = 25, low: float = 58) -> dict:
    return {"startedAt": start, "endedAt": start + minutes * MIN, "minMgDl": low, "readingCount": 6}


def codes(causes: list[dict]) -> list[str]:
    return [c["code"] for c in causes]


def hypo_causes(h: dict, **kw) -> list[dict]:
    args = dict(points=[], meals=[], boluses=[], alerts=[], sessions=[], highs=[], ratio=None, steps_by_day={}, usual_steps=None)
    args.update(kw)
    return ec.hypo_causes(h, **args)


def high_causes(e: dict, **kw) -> list[dict]:
    args = dict(meals=[], boluses=[], alerts=[], hypos=[], stress=[], ratio=None, set_changed_at=None)
    args.update(kw)
    return ec.high_causes(e, **args)


def padel(date: str, time: str, minutes: int = 70):
    return SimpleNamespace(date=date, time=time, sport="padel", duration_min=minutes, intensity="hard")


def test_hypo_soon_after_sport_names_the_session() -> None:
    sessions = ec.exercise_sessions([padel("2026-10-20", "16:00")], [])
    causes = hypo_causes(hypo(at("19:10")), sessions=sessions)
    assert causes[0]["code"] == "sportRecent"
    assert causes[0]["params"] == {"sport": "padel", "durationMin": 70, "hoursBefore": 2.0}


def test_overnight_hypo_after_evening_sport_is_delayed_effect() -> None:
    sessions = ec.exercise_sessions([padel("2026-10-20", "19:00")], [])
    causes = hypo_causes(hypo(at("03:30", "2026-10-21")), sessions=sessions)
    assert causes[0]["code"] == "sportDelayed"
    assert causes[0]["params"]["hoursBefore"] == 7


def test_two_boluses_close_together_are_stacking() -> None:
    t0 = at("15:00")
    boluses = [{"ts": t0 - 150 * MIN, "units": 5.0}, {"ts": t0 - 60 * MIN, "units": 3.5}]
    meals = [{"ts": t0 - 150 * MIN, "carbs": 50, "type": "lunch"}, {"ts": t0 - 60 * MIN, "carbs": 30, "type": "snack"}]
    causes = hypo_causes(hypo(t0), boluses=boluses, meals=meals)
    assert causes[0]["code"] == "insulinStacking"
    assert causes[0]["params"] == {"count": 2, "units": 8.5, "withinMin": 90}


def test_bolus_without_a_meal_is_a_correction_and_after_a_high_an_overcorrection() -> None:
    t0 = at("23:00")
    bolus = [{"ts": t0 - 120 * MIN, "units": 4.0}]
    assert "bolusNoMeal" in codes(hypo_causes(hypo(t0), boluses=bolus))
    high = {"startedAt": t0 - 5 * HOUR, "endedAt": t0 - 130 * MIN, "peakMgDl": 265}
    causes = hypo_causes(hypo(t0), boluses=bolus, highs=[high])
    assert causes[0]["code"] == "overcorrection"
    assert causes[0]["params"]["peakMgDl"] == 265


def test_more_insulin_than_usual_for_the_carbs() -> None:
    t0 = at("14:30")
    causes = hypo_causes(
        hypo(t0),
        meals=[{"ts": t0 - 100 * MIN, "carbs": 30, "type": "lunch"}],
        boluses=[{"ts": t0 - 105 * MIN, "units": 6.0}],
        ratio=10.0,
    )
    assert "doseAboveRatio" in codes(causes)


def test_hypo_with_nothing_logged_says_so() -> None:
    assert codes(hypo_causes(hypo(at("11:00")))) == ["noLoggedCauseHypo"]


def test_long_gap_without_food_needs_an_earlier_logged_meal() -> None:
    t0 = at("17:00")
    causes = hypo_causes(hypo(t0), meals=[{"ts": at("08:30"), "carbs": 40, "type": "breakfast"}])
    assert codes(causes) == ["longFast"]
    assert causes[0]["params"] == {"hoursSinceMeal": 8}


def test_high_after_a_late_bolus_reports_the_delay() -> None:
    meal = at("12:30")
    causes = high_causes(
        {"startedAt": meal + 50 * MIN, "endedAt": meal + 3 * HOUR, "peakMgDl": 248},
        meals=[{"ts": meal, "carbs": 65, "type": "lunch"}],
        boluses=[{"ts": meal + 35 * MIN, "units": 6.5}],
    )
    assert causes[0]["code"] == "lateBolus"
    assert causes[0]["params"]["minutesLate"] == 35


def test_high_after_a_meal_with_no_bolus_is_a_missed_bolus() -> None:
    meal = at("20:00")
    causes = high_causes(
        {"startedAt": meal + 40 * MIN, "endedAt": meal + 4 * HOUR, "peakMgDl": 290},
        meals=[{"ts": meal, "carbs": 70, "type": "dinner"}],
    )
    assert causes[0]["code"] == "missedBolus"


def test_high_after_an_occlusion_alert() -> None:
    t0 = at("10:00")
    causes = high_causes(
        {"startedAt": t0, "endedAt": t0 + 2 * HOUR, "peakMgDl": 270},
        alerts=[{"ts": t0 - 90 * MIN, "kind": "occlusion", "title": "Occlusion"}],
    )
    assert causes[0]["code"] == "pumpAlert"
    assert causes[0]["params"]["kind"] == "occlusion"


def test_high_with_nothing_logged_says_so() -> None:
    t0 = at("16:00")
    causes = high_causes({"startedAt": t0, "endedAt": t0 + 2 * HOUR, "peakMgDl": 220}, boluses=[{"ts": t0 - HOUR, "units": 2}])
    assert codes(causes) == ["noLoggedCauseHigh"]


def test_meal_bolus_timing_counts_late_missed_and_on_time() -> None:
    meals = [
        {"ts": at("08:00"), "carbs": 40, "type": "breakfast"},
        {"ts": at("12:30"), "carbs": 60, "type": "lunch"},
        {"ts": at("20:00"), "carbs": 70, "type": "dinner"},
    ]
    boluses = [{"ts": at("07:50"), "units": 4}, {"ts": at("13:00"), "units": 6}]
    assert ec.meal_bolus_timing(meals, boluses) == {
        "mealsChecked": 3,
        "onTime": 1,
        "late": 1,
        "missed": 1,
        "avgLateMin": 30,
    }


def test_high_episodes_need_an_hour_above_target() -> None:
    t0 = at("12:00")
    pts = [{"timestamp": t0 + i * 5 * MIN, "mgDl": 200 + i} for i in range(15)]  # 70 min above
    short = [{"timestamp": t0 + i * 5 * MIN, "mgDl": 200} for i in range(6)]  # 25 min
    episodes = ec.find_high_episodes(pts, 180)
    assert len(episodes) == 1 and episodes[0]["durationMin"] == 70 and episodes[0]["peakMgDl"] == 214
    assert ec.find_high_episodes(short, 180) == []
