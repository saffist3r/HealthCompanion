"""Reb3i talking video: Gemini Veo clip + Darija TTS audio muxed (looped)."""

from __future__ import annotations

import base64
import logging
import random
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

from app.core.config import get_settings
from app.services.gemini_voice_report import generate_daily_voice_briefing

logger = logging.getLogger(__name__)

BACKGROUNDS: dict[str, str] = {
    "beach": (
        "sunny Tunisian Mediterranean beach (Hammamet vibe), turquoise water, "
        "bright daylight, soft sea breeze"
    ),
    "padel": (
        "outdoor blue padel tennis court in Tunisia, sunny afternoon, "
        "glass walls and blue turf visible behind him"
    ),
    "cafe": (
        "traditional Tunisian café populaire, patterned tiles, mint tea glasses, "
        "warm afternoon light, lively but soft bokeh"
    ),
}

BACKGROUND_KEYS = tuple(BACKGROUNDS.keys())

_VIDEO_CACHE: dict[str, dict[str, Any]] = {}
_CACHE_VERSION = "v1-veo-reb3i"


def pick_background(seed: str | None = None) -> str:
    if seed:
        rng = random.Random(seed)
        return rng.choice(BACKGROUND_KEYS)
    return random.choice(BACKGROUND_KEYS)


def _ffmpeg_bin() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "ffmpeg is required to mux Reb3i video. Install ffmpeg or imageio-ffmpeg."
        ) from exc


def _veo_prompt(background_key: str) -> str:
    bg = BACKGROUNDS[background_key]
    return (
        "Photorealistic cinematic medium shot of Reb3i, a funny Tunisian man in his early 30s, "
        "wearing a bright red traditional Tunisian chechia (chachia) hat and casual modern clothes. "
        "He looks at the camera and talks animatedly with expressive hand gestures and clear mouth "
        "movements as if hosting a comedy daily health vlog for his friend Saff. "
        f"Background: {bg}. "
        "Natural lighting, slight handheld documentary feel, shallow depth of field. "
        "No subtitles, no captions, no on-screen text, no logos, no watermark."
    )


def generate_reb3i_veo_clip(*, background: str, duration_seconds: int = 8) -> bytes:
    """Generate a short silent-ish Veo clip of Reb3i talking; return MP4 bytes."""
    settings = get_settings()
    if not settings.gemini_configured:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server")
    if background not in BACKGROUNDS:
        raise ValueError(f"Unknown background: {background}")

    model = (settings.gemini_veo_model or "veo-3.1-fast-generate-preview").strip()
    client = genai.Client(api_key=settings.gemini_api_key)
    prompt = _veo_prompt(background)

    operation = client.models.generate_videos(
        model=model,
        prompt=prompt,
        config=types.GenerateVideosConfig(
            number_of_videos=1,
            duration_seconds=min(8, max(4, int(duration_seconds))),
            aspect_ratio="9:16",
            person_generation="allow_adult",
            enhance_prompt=True,
            generate_audio=False,
            negative_prompt=(
                "subtitles, captions, on-screen text, watermark, logo, deformed face, "
                "extra limbs, blurry, cartoon, anime"
            ),
        ),
    )

    # Veo is a long-running operation — poll until done (or timeout).
    deadline = time.time() + 240
    while not getattr(operation, "done", False):
        if time.time() > deadline:
            raise RuntimeError("Veo video generation timed out")
        time.sleep(8)
        operation = client.operations.get(operation)

    if getattr(operation, "error", None):
        raise RuntimeError(f"Veo failed: {operation.error}")

    response = getattr(operation, "response", None) or getattr(operation, "result", None)
    videos = getattr(response, "generated_videos", None) if response is not None else None
    if not videos:
        raise RuntimeError("Veo returned no videos")

    generated = videos[0]
    video = getattr(generated, "video", None)
    if video is None:
        raise RuntimeError("Veo response missing video object")

    data = getattr(video, "video_bytes", None)
    if not data:
        # Developer API: download generated file bytes.
        data = client.files.download(file=generated)
    if not data:
        raise RuntimeError("Could not download Veo video bytes")
    return bytes(data)


def mux_loop_video_with_audio(video_mp4: bytes, audio_wav: bytes) -> bytes:
    """Loop the short Veo clip to cover the full Darija TTS WAV, mux as MP4."""
    ffmpeg = _ffmpeg_bin()
    with tempfile.TemporaryDirectory(prefix="reb3i-") as tmp:
        root = Path(tmp)
        v_path = root / "clip.mp4"
        a_path = root / "voice.wav"
        out_path = root / "reb3i.mp4"
        v_path.write_bytes(video_mp4)
        a_path.write_bytes(audio_wav)

        cmd = [
            ffmpeg,
            "-y",
            "-stream_loop",
            "-1",
            "-i",
            str(v_path),
            "-i",
            str(a_path),
            "-shortest",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not out_path.exists():
            raise RuntimeError(
                f"ffmpeg mux failed ({proc.returncode}): {(proc.stderr or '')[-800:]}"
            )
        return out_path.read_bytes()


def generate_daily_voice_video(daily_report: dict[str, Any]) -> dict[str, Any]:
    """Script + TTS + Veo Reb3i clip → base64 MP4 with transcript."""
    day = str(daily_report.get("date") or "").strip()
    background = pick_background(seed=day or None)
    cache_key = f"{_CACHE_VERSION}:{day}:{background}" if day else ""
    if cache_key and cache_key in _VIDEO_CACHE:
        return dict(_VIDEO_CACHE[cache_key])

    voice = generate_daily_voice_briefing(daily_report)
    audio_b64 = voice["audioBase64"]
    wav = base64.b64decode(audio_b64)

    clip = generate_reb3i_veo_clip(background=background, duration_seconds=8)
    mp4 = mux_loop_video_with_audio(clip, wav)

    out = {
        "date": day,
        "transcript": voice.get("transcript") or "",
        "background": background,
        "mimeType": "video/mp4",
        "videoBase64": base64.b64encode(mp4).decode("ascii"),
        "audioMimeType": voice.get("mimeType") or "audio/wav",
        "audioBase64": audio_b64,
        "source": "gemini-veo+tts",
    }
    if cache_key:
        _VIDEO_CACHE[cache_key] = dict(out)
        if len(_VIDEO_CACHE) > 8:
            oldest = next(iter(_VIDEO_CACHE))
            _VIDEO_CACHE.pop(oldest, None)
    return out
