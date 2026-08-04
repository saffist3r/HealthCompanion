"""Reb3i talking video: stock still + Ken Burns / audio pulse + Darija TTS (free, no Veo)."""

from __future__ import annotations

import array
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
_CACHE_VERSION = "v2-still-ffmpeg"

# 9:16 talking-head frame
_W = 1080
_H = 1920
_FPS = 25


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
        Path(__file__).resolve().parents[3] / "media" / "reb3i" / name,  # backend/app/services → repo
        Path(__file__).resolve().parents[2] / "media" / "reb3i" / name,  # if media under backend/
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


def _rms_envelope(wav_path: Path, *, fps: int = _FPS) -> list[float]:
    """Per-frame RMS (0..1) from mono/stereo 16-bit PCM WAV."""
    with wave.open(str(wav_path), "rb") as wf:
        channels = wf.getnchannels()
        width = wf.getsampwidth()
        rate = wf.getframerate() or 24000
        nframes = wf.getnframes()
        raw = wf.readframes(nframes)

    if width != 2 or nframes <= 0:
        # Fallback flat envelope
        duration = max(0.5, nframes / float(rate) if rate else 1.0)
        n = max(1, int(math.ceil(duration * fps)))
        return [0.35] * n

    samples = array.array("h")
    samples.frombytes(raw)
    if channels > 1:
        # Downmix to mono
        mono = array.array("h")
        for i in range(0, len(samples) - channels + 1, channels):
            mono.append(int(sum(samples[i : i + channels]) / channels))
        samples = mono

    samples_per_frame = max(1, int(rate / fps))
    envelope: list[float] = []
    peak = 1.0
    for i in range(0, len(samples), samples_per_frame):
        chunk = samples[i : i + samples_per_frame]
        if not chunk:
            break
        acc = 0.0
        for s in chunk:
            acc += float(s) * float(s)
        rms = math.sqrt(acc / len(chunk))
        envelope.append(rms)
        if rms > peak:
            peak = rms

    if not envelope:
        return [0.35]
    # Normalize + light smooth
    norm = [min(1.0, v / peak) for v in envelope]
    smoothed: list[float] = []
    for i, v in enumerate(norm):
        a = norm[i - 1] if i > 0 else v
        b = norm[i + 1] if i + 1 < len(norm) else v
        smoothed.append(0.25 * a + 0.5 * v + 0.25 * b)
    return smoothed


def _resample_envelope(envelope: list[float], n_bins: int) -> list[float]:
    if not envelope:
        return [0.35] * n_bins
    if len(envelope) == n_bins:
        return list(envelope)
    out: list[float] = []
    last = len(envelope) - 1
    for i in range(n_bins):
        pos = i * last / max(1, n_bins - 1)
        lo = int(pos)
        hi = min(last, lo + 1)
        frac = pos - lo
        out.append(envelope[lo] * (1 - frac) + envelope[hi] * frac)
    return out


def _zoompan_expr(envelope: list[float], *, duration_s: float) -> str:
    """Ken Burns drift + piecewise RMS pulse (escaped for ffmpeg filtergraph)."""
    frames_total = max(1, int(math.ceil(duration_s * _FPS)))
    n_bins = min(40, max(10, int(duration_s / 2) + 4))
    pts = _resample_envelope(envelope, n_bins)
    bin_size = max(1, frames_total // n_bins)

    # Nested if(lt(on,end), zoom, …) — commas escaped as \, for -vf
    expr = f"{1.02 + 0.05 * pts[-1]:.4f}"
    for i in reversed(range(n_bins)):
        # Slow drift across the whole clip + louder speech → slightly tighter zoom
        drift = 0.00025 * (i * bin_size)
        z = min(1.09, 1.02 + drift + 0.055 * pts[i])
        end = (i + 1) * bin_size if i < n_bins - 1 else frames_total + 1
        expr = f"if(lt(on\\,{end})\\,{z:.4f}\\,{expr})"
    # Tiny always-on micro-motion so quiet stretches still feel alive
    return f"min(1.1\\,{expr}+0.012*abs(sin(2*PI*on/11)))"


def animate_still_with_audio(still: Path, audio_wav: bytes) -> bytes:
    """Loop a stock PNG with Ken Burns + light pulse, mux Darija TTS → MP4 bytes."""
    ffmpeg = _ffmpeg_bin()
    with tempfile.TemporaryDirectory(prefix="reb3i-still-") as tmp:
        root = Path(tmp)
        a_path = root / "voice.wav"
        out_path = root / "reb3i.mp4"
        a_path.write_bytes(audio_wav)

        duration = _wav_duration_seconds(a_path)
        envelope = _rms_envelope(a_path)
        zoom = _zoompan_expr(envelope, duration_s=duration)
        # Centered pan with tiny drift so it doesn't feel locked
        x_expr = "iw/2-(iw/zoom/2)+8*sin(2*PI*on/90)"
        y_expr = "ih/2-(ih/zoom/2)+6*cos(2*PI*on/110)"

        # scale cover 9:16 then zoompan
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
            "-i",
            str(a_path),
            "-vf",
            vf,
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "stillimage",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not out_path.exists():
            raise RuntimeError(
                f"ffmpeg still animate failed ({proc.returncode}): {(proc.stderr or '')[-1200:]}"
            )
        return out_path.read_bytes()


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
    logger.info("Animating Reb3i still %s for %s", still.name, day or "?")
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
