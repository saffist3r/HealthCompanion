"""Tunisian Darija voice briefing for the daily report (Gemini text + TTS)."""

from __future__ import annotations

import base64
import io
import json
import logging
import re
import threading
import wave
from typing import Any

from google import genai
from google.genai import types

from app.core.config import get_settings
from app.services.gemini_insights import compact_report

logger = logging.getLogger(__name__)

SCRIPT_SYSTEM = """You write a spoken daily health briefing. The SPEAKER is Reb3i (ربيعي). The LISTENER is Saff.

Names (critical — never get these wrong):
- Speaker / narrator: always "Reb3i" or "ربيعي". He may introduce himself once ("أنا ربيعي").
- Listener: always "Saff" or Arabic "ساف" (same letters: س ا ف). NEVER write صافي, NEVER "Safi", NEVER "Safy".
- Do not invent other nicknames for either person.

Voice & language:
- Reb3i talks TO Saff like a close Tunisian mate — warm, teasing, never clinical.
- Write the ENTIRE monologue in Tunisian Darija using Arabic script (تونسّي بالدارجة).
- Light French/English loanwords are OK when Tunisians naturally use them (ex: carbs, steps, CapAPS, TIR).
- Calories spelling: write "calories" in Latin letters, OR Arabic "سعرات" / "سعرات حرارية", OR "كالوري".
  NEVER misspell calories (no كالوريز, كالوريات, كالوريس, كالوريهات, or other invented forms).
- Make gentle jokes about carbs, sleep, caffeine, sport, pump drama — never mock hypos cruelly.
- Length: about 60–90 seconds when spoken (~180–320 Arabic words). Hard max ~450 words.
- One continuous monologue suitable for text-to-speech. No stage directions, no bullet lists, no markdown.

Hard safety rules:
- Never give medical advice, insulin dosing, diagnosis, or treatment changes.
- Only use numbers and facts from the provided day JSON. Do not invent readings or meals.
- If data is sparse, joke about missing data instead of fabricating.
- Remind briefly this is lifestyle chatter, not a doctor.

Return JSON only:
{
  "transcript": string   // the full Darija monologue to speak aloud
}
"""

TTS_STYLE = (
    "You are Reb3i, a Tunisian friend catching up with Saff over coffee. "
    "Pronounce the listener's name as Saff (ساف), never Safi. "
    "Casual Maghrebi / Tunisian-flavored Arabic delivery, upbeat and playful, "
    "natural pace, clear numbers, smile in the voice without rushing. "
    "If the word calories appears in Latin letters, say it in French: calories."
)

_cache_lock = threading.Lock()
_voice_cache: dict[str, dict[str, Any]] = {}
_CACHE_VERSION = "v2-reb3i-saff"


def _pcm_to_wav(pcm: bytes, *, rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def _parse_transcript(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict) and data.get("transcript"):
            return str(data["transcript"]).strip()
    except json.JSONDecodeError:
        pass
    # Model sometimes returns bare transcript
    return text.strip()


def _sanitize_transcript(transcript: str) -> str:
    """Fix common model slips: Safi→Saff, bad calories spellings."""
    text = transcript
    # Arabic Safi → Saff
    text = text.replace("صافي", "ساف")
    # Latin Safi / Safy → Saff (word boundaries)
    text = re.sub(r"\bSafy\b", "Saff", text, flags=re.IGNORECASE)
    text = re.sub(r"\bSafi\b", "Saff", text, flags=re.IGNORECASE)
    # Common mangled Arabic spellings of calories → سعرات
    for bad in (
        "كالوريز",
        "كالوريس",
        "كالوريات",
        "كالوريهات",
        "كالوريات",
        "الكالوريز",
        "الكالوريس",
        "الكالوريات",
    ):
        text = text.replace(bad, "سعرات")
    return text


def generate_tunisian_daily_script(daily_report: dict[str, Any]) -> dict[str, Any]:
    """Generate a joking Tunisian Darija monologue (Reb3i → Saff)."""
    settings = get_settings()
    if not settings.gemini_configured:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server")

    payload = compact_report(daily_report)
    client = genai.Client(api_key=settings.gemini_api_key)
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(
                        text=SCRIPT_SYSTEM
                        + "\n\nDay data (JSON):\n"
                        + json.dumps(payload, ensure_ascii=False)
                    )
                ],
            )
        ],
        config=types.GenerateContentConfig(
            temperature=0.85,
            response_mime_type="application/json",
        ),
    )
    transcript = _sanitize_transcript(_parse_transcript(response.text or ""))
    if not transcript:
        raise RuntimeError("Gemini returned an empty voice transcript")
    return {"transcript": transcript, "source": "gemini"}


def synthesize_speech(transcript: str) -> bytes:
    """Speak transcript with Gemini TTS; return WAV bytes."""
    settings = get_settings()
    if not settings.gemini_configured:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server")

    voice = (settings.gemini_tts_voice or "Puck").strip() or "Puck"
    model = (settings.gemini_tts_model or "gemini-2.5-flash-preview-tts").strip()
    prompt = f"{TTS_STYLE}\n\nScript to read aloud exactly:\n{transcript}"

    client = genai.Client(api_key=settings.gemini_api_key)

    # Prefer generate_content AUDIO modality (google-genai SDK).
    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
                    )
                ),
            ),
        )
        part = response.candidates[0].content.parts[0]
        inline = getattr(part, "inline_data", None)
        if inline is None or not getattr(inline, "data", None):
            raise RuntimeError("TTS response missing audio data")
        raw = inline.data
        if isinstance(raw, str):
            pcm = base64.b64decode(raw)
        else:
            pcm = bytes(raw)
        # If already a RIFF/WAV container, return as-is.
        if pcm[:4] == b"RIFF":
            return pcm
        return _pcm_to_wav(pcm)
    except Exception as gen_exc:  # noqa: BLE001
        logger.warning("generate_content TTS failed (%s); trying interactions API", gen_exc)

    # Fallback: Interactions API shape from Gemini TTS docs.
    interaction = client.interactions.create(
        model=model,
        input=prompt,
        response_format={"type": "audio"},
        generation_config={"speech_config": [{"voice": voice}]},
    )
    audio = getattr(interaction, "output_audio", None)
    data_b64 = getattr(audio, "data", None) if audio is not None else None
    if not data_b64:
        raise RuntimeError(f"TTS failed via generate_content ({gen_exc}) and interactions had no audio")
    pcm = base64.b64decode(data_b64)
    if pcm[:4] == b"RIFF":
        return pcm
    return _pcm_to_wav(pcm)


def generate_daily_voice_briefing(daily_report: dict[str, Any]) -> dict[str, Any]:
    """Full pipeline: Darija script + Gemini TTS → base64 WAV payload."""
    day = str(daily_report.get("date") or "").strip()
    cache_key = f"{_CACHE_VERSION}:{day}" if day else ""
    if cache_key:
        with _cache_lock:
            cached = _voice_cache.get(cache_key)
            if cached:
                return dict(cached)

    script = generate_tunisian_daily_script(daily_report)
    wav_bytes = synthesize_speech(script["transcript"])
    out = {
        "date": day,
        "transcript": script["transcript"],
        "mimeType": "audio/wav",
        "audioBase64": base64.b64encode(wav_bytes).decode("ascii"),
        "source": script.get("source") or "gemini",
    }
    if cache_key:
        with _cache_lock:
            _voice_cache[cache_key] = dict(out)
            # Keep cache small
            if len(_voice_cache) > 14:
                oldest = next(iter(_voice_cache))
                _voice_cache.pop(oldest, None)
    return out
