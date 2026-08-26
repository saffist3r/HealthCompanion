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
from app.services.gemini_retry import (
    is_transient_gemini_error as _is_transient_gemini_error,
    with_gemini_retries as _with_gemini_retries,
)

logger = logging.getLogger(__name__)

# Prefer configured model first; fall back when a preview TTS endpoint is overloaded.
_TTS_MODEL_FALLBACKS = (
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-flash-tts",
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-flash-lite-preview-tts",
)


def _tts_model_candidates(primary: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in (primary, *_TTS_MODEL_FALLBACKS):
        name = (m or "").strip()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out

SCRIPT_SYSTEM = """You write a spoken daily health briefing. The SPEAKER is Reb3i (ربعي). The LISTENER is Saff (صف).

Names (critical — never get these wrong):
- Speaker / narrator: always Latin "Reb3i" or Arabic "ربعي" (ر ب ع ي). He may introduce himself once ("أنا ربعي").
  NEVER write ربيعي.
- Listener: always Latin "Saff" or Arabic "صف" (ص ف). NEVER write ساف, صافي, Safi, or Safy.
- Do not invent other nicknames for either person.

Identity:
- Reb3i is an adult Tunisian MAN (رجل). Write as a male friend speaking. Never feminine self-reference.

Personality (friendly, not over-the-top):
- Warm Tunisian mate catching up — chill, witty, natural. Not gushing, not loud affection spam.
- Light friendship markers are OK (يا خويا, يا صف, والله, ياخي) — use sparingly, not every sentence.
- Include about 2 light jokes or teasing punchlines total — humor seasoning, not a stand-up set.
- Joke themes OK: carbs, sleep, caffeine, café, padel/sport, pump/CGM chaos, steps, meals.
- Never mock hypos cruelly — if glucose was rough, be caring first, then maybe one soft joke.
- Structure: short greeting → 2–3 real data beats with natural reactions → warm close.
- Avoid dry clinical summaries, but do not bury the numbers under endless banter.

Voice & language:
- Write the ENTIRE monologue in Tunisian Darija using Arabic script (تونسّي بالدارجة).
- Light French/English loanwords are OK when Tunisians naturally use them (ex: carbs, steps, CapAPS, TIR).
- Calories spelling: write "calories" in Latin letters, OR Arabic "سعرات" / "سعرات حرارية", OR "كالوري".
  NEVER misspell calories (no كالوريز, كالوريات, كالوريس, كالوريهات, or other invented forms).
- Length: about 60–85 seconds when spoken (~180–300 Arabic words). Hard max ~400 words.
- One continuous monologue suitable for text-to-speech. No stage directions, no bullet lists, no markdown.
- Do not write laughter tokens like هههه repeatedly; one light ههه max if needed.

Hard safety rules:
- Never give medical advice, insulin dosing, diagnosis, or treatment changes.
- Only use numbers and facts from the provided day JSON. Do not invent readings or meals.
- If data is sparse, gently joke about missing data instead of fabricating.
- Remind briefly this is lifestyle chatter between mates, not a doctor.

Return JSON only:
{
  "transcript": string   // the full Darija monologue to speak aloud
}
"""

TTS_STYLE = (
    "Speak as Reb3i (ربعي): one adult Tunisian MAN, single male voice from start to finish. "
    "Never switch to a female voice, never raise into a feminine pitch, never role-play another speaker. "
    "You are a chill mate of Saff (صف) — warm and lightly witty, not overly affectionate or hyper. "
    "Pronounce the listener's name as Saff / صف, never Safi and never ساف. "
    "Pronounce your own name as Reb3i / ربعي, never ربيعي. "
    "Steady clear Maghrebi-flavored male delivery, natural pace, clear numbers, soft smile — no squeaky laughs. "
    "If the word calories appears in Latin letters, say it in French: calories."
)

_cache_lock = threading.Lock()
_voice_cache: dict[str, dict[str, Any]] = {}
_CACHE_VERSION = "v5-reb3i-male-chill"



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
    """Fix common model slips: wrong Arabic names, bad calories spellings."""
    text = transcript
    # Wrong listener spellings → صف
    text = text.replace("صافي", "صف")
    text = text.replace("ساف", "صف")
    # Wrong speaker spelling → ربعي
    text = text.replace("ربيعي", "ربعي")
    # Latin Safi / Safy → Saff
    text = re.sub(r"\bSafy\b", "Saff", text, flags=re.IGNORECASE)
    text = re.sub(r"\bSafi\b", "Saff", text, flags=re.IGNORECASE)
    # Common mangled Arabic spellings of calories → سعرات
    for bad in (
        "كالوريز",
        "كالوريس",
        "كالوريات",
        "كالوريهات",
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

    def _call() -> Any:
        return client.models.generate_content(
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

    response = _with_gemini_retries("voice-script", _call)
    transcript = _sanitize_transcript(_parse_transcript(response.text or ""))
    if not transcript:
        raise RuntimeError("Gemini returned an empty voice transcript")
    return {"transcript": transcript, "source": "gemini"}


def _tts_once(client: Any, *, model: str, prompt: str, voice: str) -> bytes:
    """One TTS attempt for a specific model; raises on failure."""
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
        if pcm[:4] == b"RIFF":
            return pcm
        return _pcm_to_wav(pcm)
    except Exception as gen_exc:  # noqa: BLE001
        # Only try Interactions when the model itself responded but shape differed.
        if _is_transient_gemini_error(gen_exc):
            raise
        logger.warning("generate_content TTS (%s) failed (%s); trying interactions", model, gen_exc)

    interaction = client.interactions.create(
        model=model,
        input=prompt,
        response_format={"type": "audio"},
        generation_config={"speech_config": [{"voice": voice}]},
    )
    audio = getattr(interaction, "output_audio", None)
    data_b64 = getattr(audio, "data", None) if audio is not None else None
    if not data_b64:
        raise RuntimeError(f"TTS model {model} returned no audio ({gen_exc})")
    pcm = base64.b64decode(data_b64)
    if pcm[:4] == b"RIFF":
        return pcm
    return _pcm_to_wav(pcm)


def synthesize_speech(transcript: str) -> bytes:
    """Speak transcript with Gemini TTS; return WAV bytes."""
    settings = get_settings()
    if not settings.gemini_configured:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server")

    voice = (settings.gemini_tts_voice or "Charon").strip() or "Charon"
    primary = (settings.gemini_tts_model or "gemini-2.5-flash-preview-tts").strip()
    prompt = f"{TTS_STYLE}\n\nScript to read aloud exactly:\n{transcript}"
    client = genai.Client(api_key=settings.gemini_api_key)

    errors: list[str] = []
    for model in _tts_model_candidates(primary):
        try:
            wav = _with_gemini_retries(
                f"tts:{model}",
                lambda m=model: _tts_once(client, model=m, prompt=prompt, voice=voice),
                attempts=4,
                base_delay_s=2.5,
            )
            if model != primary:
                logger.info("TTS succeeded with fallback model %s (primary was %s)", model, primary)
            return wav
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{model}: {exc}")
            logger.warning("TTS model %s failed after retries: %s", model, exc)
            continue
    raise RuntimeError("All Gemini TTS models failed: " + " | ".join(errors[:4]))


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
