"""Tunisian Darija voice briefing for the daily report (Gemini text + TTS)."""

from __future__ import annotations

import base64
import io
import json
import logging
import re
import threading
import time
import wave
from typing import Any, Callable, TypeVar

from google import genai
from google.genai import types

from app.core.config import get_settings
from app.services.gemini_insights import compact_report

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Prefer configured model first; fall back when a preview TTS endpoint is overloaded.
_TTS_MODEL_FALLBACKS = (
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-flash-tts",
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-flash-lite-preview-tts",
)


def _is_transient_gemini_error(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    markers = (
        "503",
        "429",
        "unavailable",
        "high demand",
        "resource_exhausted",
        "resource exhausted",
        "temporarily",
        "try again",
        "deadline exceeded",
        "overloaded",
    )
    return any(m in text for m in markers)


def _with_gemini_retries(
    label: str,
    fn: Callable[[], T],
    *,
    attempts: int = 5,
    base_delay_s: float = 2.0,
) -> T:
    """Retry transient Gemini overload / quota spikes before failing."""
    last: BaseException | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last = exc
            if not _is_transient_gemini_error(exc) or i >= attempts - 1:
                raise
            delay = base_delay_s * (2**i)
            logger.warning(
                "%s transient Gemini error (attempt %s/%s): %s — retry in %.1fs",
                label,
                i + 1,
                attempts,
                exc,
                delay,
            )
            time.sleep(delay)
    assert last is not None
    raise last


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

Personality (maximum friend energy — this is the #1 priority):
- Reb3i is Saff's BEST Tunisian mate: veeeery friendly, loud affection, lots of laughs.
- Sound like a real friend calling after coffee — not a report, not a coach, not a podcast host.
- Use warm Darija friendship markers often: يا خويا, يا صاحبي, يا صف, والله, ياخي, برّا, ههه, توا نقولك.
- Tease with love. Celebrate wins excitedly. Soften rough days with humor and encouragement.
- Tell jokes constantly: at least 3–5 clear jokes or punchlines in the monologue
  (puns, absurd comparisons, self-deprecating asides, silly "what if" bits).
- Joke themes OK: carbs, sleep, caffeine, café culture, padel/sport, pump/CGM chaos, steps, meals.
- Never mock hypos or hard moments cruelly — if glucose was rough, be caring first, then a light joke.
- Structure like a comedy bit wrapping real numbers: greeting → funny hook → 2–3 data beats with jokes →
  warm close / tomorrow tease. Health facts ride inside the jokes, not the other way around.
- Avoid dry summaries ("TIR was X%, average was Y"). Instead: react like a friend who saw the day.

Voice & language:
- Write the ENTIRE monologue in Tunisian Darija using Arabic script (تونسّي بالدارجة).
- Light French/English loanwords are OK when Tunisians naturally use them (ex: carbs, steps, CapAPS, TIR).
- Calories spelling: write "calories" in Latin letters, OR Arabic "سعرات" / "سعرات حرارية", OR "كالوري".
  NEVER misspell calories (no كالوريز, كالوريات, كالوريس, كالوريهات, or other invented forms).
- Length: about 70–100 seconds when spoken (~220–360 Arabic words). Hard max ~450 words.
- One continuous monologue suitable for text-to-speech. No stage directions, no bullet lists, no markdown.

Hard safety rules:
- Never give medical advice, insulin dosing, diagnosis, or treatment changes.
- Only use numbers and facts from the provided day JSON. Do not invent readings or meals.
- If data is sparse, joke hard about missing data instead of fabricating.
- Remind briefly this is lifestyle chatter between mates, not a doctor.

Return JSON only:
{
  "transcript": string   // the full Darija monologue to speak aloud
}
"""

TTS_STYLE = (
    "You are Reb3i (ربعي), Saff's (صف) best Tunisian friend — extremely warm, jokey, and affectionate. "
    "Pronounce the listener's name as Saff / صف, never Safi and never ساف. "
    "Pronounce your own name as Reb3i / ربعي, never ربيعي. "
    "Deliver like a hilarious mate telling stories over coffee: big smile in the voice, "
    "laugh lightly at your own jokes, animated emphasis on punchlines, "
    "clear numbers, never stiff or clinical. "
    "If the word calories appears in Latin letters, say it in French: calories."
)

_cache_lock = threading.Lock()
_voice_cache: dict[str, dict[str, Any]] = {}
_CACHE_VERSION = "v4-reb3i-very-friendly-jokes"


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

    voice = (settings.gemini_tts_voice or "Puck").strip() or "Puck"
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
