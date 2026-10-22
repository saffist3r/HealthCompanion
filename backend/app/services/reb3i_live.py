"""Reb3i live voice chat — Gemini Live API (diabetes companion, Tunisian Darija)."""

from __future__ import annotations

import io
import json
import logging
import subprocess
import tempfile
import wave
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from google.genai import types
from sqlalchemy.orm import Session

from app.core.config import get_settings

logger = logging.getLogger(__name__)

REB3I_LIVE_SYSTEM = """You are Reb3i (ربعي), an adult Tunisian man and close mate of Saff (صف).
You are having a LIVE spoken conversation — like sitting together in a café.

Language & voice:
- Speak Tunisian Darija (Arabic script when writing transcripts). Light French/English OK for diabetes terms (carbs, TIR, CapAPS, pump, CGM).
- Sound like one male friend: chill, warm, lightly witty — not a doctor, not a call-center bot.
- Keep turns SHORT for voice (1–4 sentences). Ask follow-ups when useful.
- Names: you = ربعي / Reb3i (never ربيعي). Listener = صف / Saff (never ساف / صافي / Safi).
- Greeting only: أهلا / عسلامة / صباح الخير — NEVER say عصابة or gang slang.

Conversation continuity (critical — do this every turn after the greeting):
- ALWAYS answer what Saff just said or asked. Build on YOUR previous reply — continue the thread, joke, clarify, or follow up.
- Do NOT restart with a fresh day briefing, TIR dump, or meal list unless he asked about that topic.
- Do NOT ignore his last sentence to pivot back to readings. Chat first; data is support, not the script.
- Remember short-term chat: if he said he was tired / going to padel / ate something, refer back to that next turn.
- One idea per turn. Prefer a question or reaction over a report.

Health dossier (reference only — not every turn):
- You have JSON for today, yesterday, weekRollup, recentDebriefs, openInjuries.
- Use it when he asks about glucose/meals/steps/pump/injuries, or when ONE number naturally supports your point.
- First greeting only: mention 1–2 real numbers, then invite him to talk.
- Prefer yesterday for a completed day; today may still be in progress.
- If a field is missing, say you don't have that log — NEVER invent readings, meals, or doses.

Topic focus — diabetes lifestyle companion:
- Glucose, meals/carbs, activity, sleep, stress, pump/CGM, padel/sport, caffeine, injuries — when relevant to the chat.
- Empathize with hypos/hypers; never mock cruelty.

Hard safety (non-negotiable):
- NEVER give medical advice, insulin dosing, carb ratios, diagnosis, or treatment changes.
- NEVER tell them to change pump settings, basal, or boluses.
- If they ask for dosing advice: refuse kindly and tell them to check CapAPS / their care team.
- You are lifestyle chatter between mates, not a clinician.

If context is sparse, joke gently about missing logs and help them think what to log next.
"""


def _clock_from_ts_ms(ts_ms: int | None) -> str | None:
    if not ts_ms:
        return None
    try:
        return datetime.fromtimestamp(ts_ms / 1000).strftime("%H:%M")
    except (OSError, ValueError, OverflowError, TypeError):
        return None


def _slim_meal(meal: dict[str, Any]) -> dict[str, Any]:
    macros = meal.get("macros") or {}
    summary = (meal.get("aiSummary") or meal.get("notes") or "").strip()
    out: dict[str, Any] = {
        "time": meal.get("time"),
        "mealType": meal.get("mealType"),
        "caloriesKcal": macros.get("caloriesKcal"),
        "carbsG": macros.get("carbsG"),
        "proteinG": macros.get("proteinG"),
        "fatG": macros.get("fatG"),
    }
    if summary:
        out["summary"] = summary[:180]
    items = meal.get("items") or meal.get("foods") or []
    if isinstance(items, list) and items:
        names: list[str] = []
        for it in items[:6]:
            if isinstance(it, dict):
                n = (it.get("name") or it.get("label") or "").strip()
                if n:
                    names.append(n[:60])
            elif isinstance(it, str) and it.strip():
                names.append(it.strip()[:60])
        if names:
            out["items"] = names
    return {k: v for k, v in out.items() if v is not None and v != ""}


def _slim_glucose(daily: dict[str, Any]) -> dict[str, Any]:
    g = daily.get("glucose") or {}
    readings = g.get("readings") or []

    last = None
    if readings and isinstance(readings[-1], dict):
        last = {
            "time": _clock_from_ts_ms(int(readings[-1].get("timestamp") or 0)),
            "mgDl": readings[-1].get("mgDl"),
        }

    hypos = []
    for h in (g.get("hypoEvents") or [])[:6]:
        if isinstance(h, dict):
            hypos.append(
                {
                    "start": h.get("startTime") or h.get("start") or _clock_from_ts_ms(h.get("startTs")),
                    "nadirMgDl": h.get("nadirMgDl") or h.get("minMgDl") or h.get("mgDl"),
                    "durationMin": h.get("durationMin"),
                }
            )
    hypers = []
    for h in (g.get("hyperEvents") or [])[:6]:
        if isinstance(h, dict):
            hypers.append(
                {
                    "start": h.get("startTime") or h.get("start") or _clock_from_ts_ms(h.get("startTs")),
                    "peakMgDl": h.get("peakMgDl") or h.get("maxMgDl") or h.get("mgDl"),
                    "durationMin": h.get("durationMin"),
                }
            )

    overnight = daily.get("overnight") or {}
    return {
        "avgMgDl": g.get("avgMgDl"),
        "minMgDl": g.get("minMgDl"),
        "maxMgDl": g.get("maxMgDl"),
        "timeInRangePct": g.get("timeInRangePct"),
        "readingCount": g.get("readingCount"),
        "lowCount": g.get("lowCount"),
        "highCount": g.get("highCount"),
        "hypoEventCount": g.get("hypoEventCount"),
        "hyperEventCount": g.get("hyperEventCount"),
        "hypoEvents": hypos,
        "hyperEvents": hypers,
        "lastReading": last,
        "overnight": {
            "blurb": overnight.get("blurb"),
            "minMgDl": overnight.get("minMgDl"),
            "maxMgDl": overnight.get("maxMgDl"),
            "endMgDl": overnight.get("endMgDl"),
        }
        if overnight
        else None,
    }


def _slim_activity(daily: dict[str, Any]) -> dict[str, Any] | None:
    act = daily.get("activity")
    if not act:
        return None
    workouts = []
    for w in (act.get("workouts") or [])[:8]:
        if isinstance(w, dict):
            workouts.append(
                {
                    "name": w.get("name") or w.get("type") or "Workout",
                    "durationMin": w.get("durationMin"),
                    "calories": w.get("calories"),
                }
            )
    return {
        "steps": act.get("steps") or 0,
        "energyScore": act.get("energyScore"),
        "caloriesBurned": act.get("caloriesBurned"),
        "source": act.get("source"),
        "workouts": workouts,
    }


def _slim_pump(daily: dict[str, Any]) -> dict[str, Any]:
    pump = daily.get("pumpEvents") or []
    insulin = 0.0
    alerts: list[dict[str, Any]] = []
    for p in pump:
        if not isinstance(p, dict):
            continue
        if p.get("kind") == "insulin_delivered":
            try:
                insulin += float(p.get("units") or 0)
            except (TypeError, ValueError):
                pass
        elif p.get("kind") in ("high", "low", "urgent_low", "occlusion", "reservoir", "battery"):
            alerts.append(
                {
                    "time": p.get("time") or _clock_from_ts_ms(p.get("timestamp")),
                    "kind": p.get("kind"),
                    "label": p.get("kindLabel") or p.get("label"),
                    "detail": (p.get("message") or p.get("raw") or "")[:120] or None,
                }
            )
    return {
        "eventCount": len(pump),
        "insulinDeliveredU": round(insulin, 2) if insulin else 0,
        "alerts": alerts[:10],
    }


def _slim_day_for_live(daily: dict[str, Any]) -> dict[str, Any]:
    """Rich but size-conscious day dossier for Gemini Live (includes meals)."""
    nut = daily.get("nutrition") or {}
    macros = nut.get("macros") or {}
    meals = [_slim_meal(m) for m in (daily.get("meals") or []) if isinstance(m, dict)]

    stress = []
    for s in (daily.get("stressLogs") or [])[:8]:
        if isinstance(s, dict):
            stress.append(
                {
                    "level": s.get("levelLabel") or s.get("level"),
                    "score": s.get("score") or s.get("energyScore"),
                    "source": s.get("sourceLabel") or s.get("source"),
                    "note": (s.get("note") or "")[:100] or None,
                }
            )

    caffeine = []
    for c in (daily.get("caffeineLogs") or [])[:10]:
        if isinstance(c, dict):
            caffeine.append(
                {
                    "drink": c.get("drinkLabel") or c.get("drink"),
                    "time": c.get("time"),
                    "mg": c.get("caffeineMg"),
                }
            )

    injuries = []
    for inj in (daily.get("injuries") or [])[:8]:
        if isinstance(inj, dict):
            today_pain = inj.get("todayPain")
            latest_pain = inj.get("latestPain")
            injuries.append(
                {
                    "title": inj.get("title") or inj.get("injuryTypeLabel"),
                    "area": inj.get("bodyAreaLabel") or inj.get("bodyArea"),
                    "status": inj.get("status"),
                    "startedOn": inj.get("startedOn"),
                    "todayPain": today_pain.get("score") if isinstance(today_pain, dict) else inj.get("todayPainScore"),
                    "latestPain": latest_pain.get("score") if isinstance(latest_pain, dict) else None,
                }
            )

    sport = []
    for m in (daily.get("sportMatches") or [])[:6]:
        if isinstance(m, dict):
            sport.append(
                {
                    "sport": m.get("sport") or m.get("sportLabel") or "padel",
                    "result": m.get("result") or m.get("outcome"),
                    "score": m.get("score"),
                    "note": (m.get("note") or "")[:80] or None,
                }
            )

    care = []
    for v in (daily.get("careVisits") or [])[:6]:
        if isinstance(v, dict):
            care.append(
                {
                    "type": v.get("typeLabel") or v.get("type"),
                    "note": (v.get("note") or "")[:100] or None,
                }
            )

    check = daily.get("dayCheckIn")
    check_slim = None
    if isinstance(check, dict):
        check_slim = {
            "mood": check.get("moodLabel") or check.get("mood"),
            "wake": check.get("wakeLabel") or check.get("wakeFeeling") or check.get("wake"),
            "focus": check.get("focusLabel") or check.get("focus"),
            "sleepHours": check.get("sleepHours"),
            "note": (check.get("note") or "")[:120] or None,
        }

    return {
        "date": daily.get("date"),
        "glucose": _slim_glucose(daily),
        "nutrition": {
            "mealCount": nut.get("mealCount") or len(meals),
            "macros": {
                "caloriesKcal": macros.get("caloriesKcal"),
                "carbsG": macros.get("carbsG"),
                "proteinG": macros.get("proteinG"),
                "fatG": macros.get("fatG"),
            },
            "meals": meals,
        },
        "activity": _slim_activity(daily),
        "pump": _slim_pump(daily),
        "stressLogs": stress,
        "dayCheckIn": check_slim,
        "caffeineLogs": caffeine,
        "injuries": injuries,
        "sportMatches": sport,
        "careVisits": care,
        "weight": daily.get("weight"),
        "calorieTargets": daily.get("calorieTargets"),
        "calorieBalance": daily.get("calorieBalance"),
        "insights": (daily.get("insights") or [])[:8],
        "warnings": [
            {"title": w.get("title"), "message": w.get("message")}
            if isinstance(w, dict)
            else str(w)
            for w in (daily.get("warnings") or [])[:6]
        ],
    }


def _week_rollup(days: list[dict[str, Any]]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for d in days:
        g = d.get("glucose") or {}
        nut = d.get("nutrition") or {}
        act = d.get("activity") or {}
        rows.append(
            {
                "date": d.get("date"),
                "tirPct": g.get("timeInRangePct"),
                "avgMgDl": g.get("avgMgDl"),
                "hypoEvents": g.get("hypoEventCount") or 0,
                "meals": nut.get("mealCount") or 0,
                "carbsG": (nut.get("macros") or {}).get("carbsG"),
                "steps": (act or {}).get("steps") if act else 0,
            }
        )
    tir_vals = [r["tirPct"] for r in rows if r.get("tirPct") is not None]
    return {
        "days": rows,
        "avgTirPct": round(sum(tir_vals) / len(tir_vals), 1) if tir_vals else None,
        "totalHypoEvents": sum(int(r.get("hypoEvents") or 0) for r in rows),
    }


def build_live_chat_context(db: Session, device_ids: list[str]) -> dict[str, Any]:
    """Full dossier for live chat: today + yesterday detailed, 7-day rollup, recent debriefs."""
    from app.routers.reports import _load_daily
    from app.services.day_debriefs import list_day_debriefs
    from app.services.reports import paris_date_key, to_date_key

    today = paris_date_key()
    today_dt = datetime.strptime(today, "%Y-%m-%d")
    keys = [(today_dt - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6, -1, -1)]

    loaded: dict[str, dict[str, Any]] = {}
    for key in keys:
        loaded[key] = _load_daily(db, device_ids, key)

    yesterday_key = (today_dt - timedelta(days=1)).strftime("%Y-%m-%d")
    today_slim = _slim_day_for_live(loaded[today])
    yest_slim = _slim_day_for_live(loaded[yesterday_key])
    rollup = _week_rollup([_slim_day_for_live(loaded[k]) for k in keys])

    debriefs = []
    try:
        for row in list_day_debriefs(db, limit=5):
            debriefs.append(
                {
                    "date": row.date,
                    "headline": (row.headline or "")[:200],
                }
            )
    except Exception:  # noqa: BLE001
        logger.exception("Reb3i live: debrief list failed")

    open_injuries = today_slim.get("injuries") or yest_slim.get("injuries") or []

    return {
        "timezone": "Europe/Paris",
        "generatedAt": to_date_key(datetime.now()),
        "note": (
            "Use yesterday for completed-day talk; today may still be in progress. "
            "Meals, glucose, pump, stress, and injuries are real logged data."
        ),
        "today": today_slim,
        "yesterday": yest_slim,
        "weekRollup": rollup,
        "recentDebriefs": debriefs,
        "openInjuries": open_injuries,
    }


def context_summary_line(context: dict[str, Any]) -> str:
    y = context.get("yesterday") or {}
    t = context.get("today") or {}
    yg = y.get("glucose") or {}
    tg = t.get("glucose") or {}
    yn = y.get("nutrition") or {}
    ya = y.get("activity") or {}
    yp = y.get("pump") or {}
    week = context.get("weekRollup") or {}
    last = (tg.get("lastReading") or {}) if isinstance(tg.get("lastReading"), dict) else {}
    return (
        f"Yesterday {y.get('date')}: TIR {yg.get('timeInRangePct')}% · "
        f"avg {yg.get('avgMgDl')} · meals {yn.get('mealCount')} · "
        f"steps {ya.get('steps')} · pump {yp.get('insulinDeliveredU')}U · "
        f"7d avg TIR {week.get('avgTirPct')}%. "
        f"Today {t.get('date')}: readings {tg.get('readingCount')} · "
        f"last {last.get('mgDl')}."
    )


def greeting_seed_facts(context: dict[str, Any]) -> str:
    """Short bullet list injected into the opening cue so the model cites real numbers."""
    y = context.get("yesterday") or {}
    t = context.get("today") or {}
    yg = y.get("glucose") or {}
    yn = y.get("nutrition") or {}
    meals = yn.get("meals") or []
    meal_bits = []
    for m in meals[:3]:
        if isinstance(m, dict):
            meal_bits.append(
                f"{m.get('time') or '?'} {m.get('mealType') or 'meal'} "
                f"{m.get('carbsG') or '?'}g carbs"
                + (f" ({m.get('summary')})" if m.get("summary") else "")
            )
    ya = y.get("activity") or {}
    yp = y.get("pump") or {}
    tg = t.get("glucose") or {}
    last = tg.get("lastReading") or {}
    lines = [
        f"- Yesterday ({y.get('date')}): TIR {yg.get('timeInRangePct')}%, "
        f"avg {yg.get('avgMgDl')} (min {yg.get('minMgDl')} / max {yg.get('maxMgDl')}), "
        f"hypos {yg.get('hypoEventCount') or 0}",
        f"- Yesterday meals ({yn.get('mealCount') or 0}): "
        + ("; ".join(meal_bits) if meal_bits else "none logged"),
        f"- Yesterday steps {ya.get('steps') or 0}, pump insulin ~{yp.get('insulinDeliveredU') or 0} U",
    ]
    if isinstance(last, dict) and last.get("mgDl") is not None:
        lines.append(f"- Today last CGM: {last.get('mgDl')} at {last.get('time')}")
    else:
        lines.append("- Today: no CGM yet")
    return "\n".join(lines)


def build_live_system_instruction(context: dict[str, Any]) -> str:
    payload = json.dumps(context, ensure_ascii=False)
    return (
        REB3I_LIVE_SYSTEM
        + "\n\nHealth dossier for this chat (JSON — only use these facts; do not invent):\n"
        + payload
    )


def live_connect_config(system_instruction: str) -> types.LiveConnectConfig:
    """Client-segmented turns (hold / end-of-utterance) — automatic VAD off."""
    settings = get_settings()
    voice = (settings.gemini_tts_voice or "Charon").strip() or "Charon"
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        system_instruction=system_instruction,
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
            )
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True)
        ),
    )


def pcm16_to_wav(pcm: bytes, *, rate: int = 24000, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def _ffmpeg_bin() -> str:
    import shutil

    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("ffmpeg is required for Reb3i live voice") from exc


def audio_bytes_to_pcm16_16k(raw: bytes, *, filename_hint: str = "clip.m4a") -> bytes:
    """Convert phone recordings (m4a/wav/webm/…) to 16 kHz mono s16le PCM for Live API."""
    if not raw:
        raise ValueError("Empty audio")
    suffix = Path(filename_hint).suffix or ".m4a"
    ffmpeg = _ffmpeg_bin()
    with tempfile.TemporaryDirectory(prefix="reb3i-in-") as tmp:
        src = Path(tmp) / f"in{suffix}"
        dst = Path(tmp) / "out.pcm"
        src.write_bytes(raw)
        cmd = [
            ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            str(dst),
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=30)
        if proc.returncode != 0 or not dst.exists():
            err = (proc.stderr or b"").decode("utf-8", errors="replace")[-400:]
            raise RuntimeError(f"Audio convert failed: {err}")
        return dst.read_bytes()


def chunk_bytes(data: bytes, size: int = 3200) -> list[bytes]:
    return [data[i : i + size] for i in range(0, len(data), size)] if data else []
