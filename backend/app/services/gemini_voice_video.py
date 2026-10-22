"""Reb3i talking video: stock still + light Ken Burns loop + Darija TTS (free, no Veo)."""

from __future__ import annotations

import base64
import logging
import math
import random
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Any

from app.services.gemini_voice_report import generate_daily_voice_briefing

logger = logging.getLogger(__name__)

BACKGROUND_KEYS = ("beach", "padel", "cafe")

_VIDEO_CACHE: dict[str, dict[str, Any]] = {}
_CACHE_VERSION = "v4-still-loop-no-isaba"

# Keep encode light for the 1Gi backend pod (zoompan@1080p OOMs / exit -9).
_W = 720
_H = 1280
_FPS = 12
_CLIP_SECONDS = 6


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
            "ffmpeg is required for Reb3i video. Install ffmpeg or imageio-ffmpeg."
        ) from exc


def _still_path(background: str) -> Path:
    """Resolve stock PNG: /app/media/reb3i in container, or repo media/reb3i locally."""
    if background not in BACKGROUND_KEYS:
        raise ValueError(f"Unknown background: {background}")
    name = f"reb3i-{background}.png"
    candidates = [
        Path("/app/media/reb3i") / name,
        Path(__file__).resolve().parents[3] / "media" / "reb3i" / name,
        Path(__file__).resolve().parents[2] / "media" / "reb3i" / name,
    ]
    for path in candidates:
        if path.is_file():
            return path
    raise RuntimeError(
        f"Missing Reb3i still for {background!r}. Looked in: "
        + ", ".join(str(p) for p in candidates)
    )


def _wav_duration_seconds(wav_path: Path) -> float:
    with wave.open(str(wav_path), "rb") as wf:
        frames = wf.getnframes()
        rate = wf.getframerate() or 1
        return max(0.5, frames / float(rate))


def _make_ken_burns_clip(still: Path, out_mp4: Path, *, seconds: float = _CLIP_SECONDS) -> None:
    """Short silent 9:16 clip with a simple zoom/pan (memory-safe)."""
    ffmpeg = _ffmpeg_bin()
    # Simple continuous motion — no nested if() zoom tables (those OOM on long clips).
    zoom = "min(1.08\\,1.02+0.00045*on+0.025*abs(sin(2*PI*on/18)))"
    x_expr = "iw/2-(iw/zoom/2)+6*sin(2*PI*on/70)"
    y_expr = "ih/2-(ih/zoom/2)+5*cos(2*PI*on/85)"
    frames = max(1, int(math.ceil(seconds * _FPS)))
    vf = (
        f"scale={_W}:{_H}:force_original_aspect_ratio=increase,"
        f"crop={_W}:{_H},"
        f"zoompan=z='{zoom}':x='{x_expr}':y='{y_expr}':d=1:"
        f"s={_W}x{_H}:fps={_FPS},"
        f"format=yuv420p"
    )
    cmd = [
        ffmpeg,
        "-y",
        "-loop",
        "1",
        "-i",
        str(still),
        "-vf",
        vf,
        "-frames:v",
        str(frames),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "stillimage",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "1",
        str(out_mp4),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not out_mp4.is_file() or out_mp4.stat().st_size < 1000:
        raise RuntimeError(
            f"ffmpeg ken-burns clip failed ({proc.returncode}): {(proc.stderr or '')[-1200:]}"
        )


def mux_loop_video_with_audio(video_mp4: Path | bytes, audio_wav: bytes) -> bytes:
    """Loop a short silent clip under the full Darija TTS WAV."""
    ffmpeg = _ffmpeg_bin()
    with tempfile.TemporaryDirectory(prefix="reb3i-mux-") as tmp:
        root = Path(tmp)
        v_path = root / "clip.mp4"
        a_path = root / "voice.wav"
        out_path = root / "reb3i.mp4"
        if isinstance(video_mp4, Path):
            v_path.write_bytes(video_mp4.read_bytes())
        else:
            v_path.write_bytes(video_mp4)
        a_path.write_bytes(audio_wav)

        duration = _wav_duration_seconds(a_path)
        cmd = [
            ffmpeg,
            "-y",
            "-stream_loop",
            "-1",
            "-i",
            str(v_path),
            "-i",
            str(a_path),
            "-t",
            f"{duration:.3f}",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-shortest",
            "-movflags",
            "+faststart",
            "-threads",
            "1",
            str(out_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not out_path.exists():
            raise RuntimeError(
                f"ffmpeg mux failed ({proc.returncode}): {(proc.stderr or '')[-1200:]}"
            )
        return out_path.read_bytes()


def animate_still_with_audio(still: Path, audio_wav: bytes) -> bytes:
    """Short Ken Burns loop of the still, repeated under the full TTS audio."""
    with tempfile.TemporaryDirectory(prefix="reb3i-still-") as tmp:
        root = Path(tmp)
        clip_path = root / "kb.mp4"
        _make_ken_burns_clip(still, clip_path)
        return mux_loop_video_with_audio(clip_path, audio_wav)


def generate_daily_voice_video(daily_report: dict[str, Any]) -> dict[str, Any]:
    """Script + TTS + stock Reb3i still animation → base64 MP4 with transcript."""
    day = str(daily_report.get("date") or "").strip()
    background = pick_background(seed=day or None)
    cache_key = f"{_CACHE_VERSION}:{day}:{background}" if day else ""
    if cache_key and cache_key in _VIDEO_CACHE:
        return dict(_VIDEO_CACHE[cache_key])

    voice = generate_daily_voice_briefing(daily_report)
    audio_b64 = voice["audioBase64"]
    wav = base64.b64decode(audio_b64)

    still = _still_path(background)
    logger.info("Animating Reb3i still %s for %s (lite loop)", still.name, day or "?")
    mp4 = animate_still_with_audio(still, wav)

    out = {
        "date": day,
        "transcript": voice.get("transcript") or "",
        "background": background,
        "mimeType": "video/mp4",
        "videoBase64": base64.b64encode(mp4).decode("ascii"),
        "audioMimeType": voice.get("mimeType") or "audio/wav",
        "audioBase64": audio_b64,
        "source": "stock-still+tts",
    }
    if cache_key:
        _VIDEO_CACHE[cache_key] = dict(out)
        if len(_VIDEO_CACHE) > 8:
            oldest = next(iter(_VIDEO_CACHE))
            _VIDEO_CACHE.pop(oldest, None)
    return out
