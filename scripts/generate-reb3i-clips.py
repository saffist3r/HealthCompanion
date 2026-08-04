#!/usr/bin/env python3
"""Generate Erreb3i (Reb3i) stock clips for GIF conversion.

Veo Developer API max clip length is typically 8s — we loop/trim to 15s and strip audio.

Usage (from repo root, with GEMINI_API_KEY in backend/.env):

  backend/.venv/bin/python scripts/generate-reb3i-clips.py

Outputs under media/reb3i/:
  reb3i-{beach,padel,cafe}-8s.mp4
  reb3i-{beach,padel,cafe}-15s.mp4   (silent, ready for GIF)
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "media" / "reb3i"
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / "backend" / ".env")

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402
import imageio_ffmpeg  # noqa: E402

BACKGROUNDS = {
    "beach": "sunny Tunisian Mediterranean beach (Hammamet vibe), turquoise water, bright daylight",
    "padel": "outdoor blue padel tennis court in Tunisia, sunny afternoon, glass walls and blue turf",
    "cafe": "traditional Tunisian café populaire, patterned tiles, mint tea glasses, warm afternoon light",
}


def prompt_for(bg_key: str) -> str:
    bg = BACKGROUNDS[bg_key]
    return (
        "Photorealistic cinematic medium shot of Reb3i (Erreb3i), a funny Tunisian man in his early 30s, "
        "wearing a bright red traditional Tunisian chechia (chachia) hat and casual modern clothes. "
        "He looks at the camera, smiles, talks and gestures expressively like a comedy health vlogger. "
        f"Background: {bg}. "
        "Natural lighting, slight handheld documentary feel. "
        "No subtitles, no captions, no on-screen text, no logos, no watermark."
    )


def generate_8s(client: genai.Client, model: str, bg_key: str) -> Path:
    print(f"=== Veo {bg_key} ===", flush=True)
    # Minimal config: Developer API rejects generate_audio / enhance_prompt on some models.
    op = client.models.generate_videos(
        model=model,
        prompt=prompt_for(bg_key),
        config=types.GenerateVideosConfig(
            number_of_videos=1,
            duration_seconds=8,
            aspect_ratio="9:16",
        ),
    )
    deadline = time.time() + 360
    while not getattr(op, "done", False):
        if time.time() > deadline:
            raise TimeoutError(bg_key)
        time.sleep(12)
        op = client.operations.get(op)
        print(f"  polling done={getattr(op, 'done', None)}", flush=True)
    if getattr(op, "error", None):
        raise RuntimeError(op.error)
    resp = getattr(op, "response", None) or getattr(op, "result", None)
    videos = getattr(resp, "generated_videos", None) if resp else None
    if not videos:
        raise RuntimeError(f"no videos for {bg_key}")
    generated = videos[0]
    data = getattr(generated.video, "video_bytes", None) or client.files.download(file=generated)
    path = OUT / f"reb3i-{bg_key}-8s.mp4"
    path.write_bytes(bytes(data))
    print(f"  wrote {path} ({path.stat().st_size} bytes)", flush=True)
    return path


def to_15s_silent(src: Path, bg_key: str, ffmpeg: str) -> Path:
    dest = OUT / f"reb3i-{bg_key}-15s.mp4"
    cmd = [
        ffmpeg,
        "-y",
        "-stream_loop",
        "1",
        "-i",
        str(src),
        "-t",
        "15",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(dest),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[-800:])
    print(f"  wrote {dest} ({dest.stat().st_size} bytes)", flush=True)
    return dest


def main() -> int:
    key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not key or key.startswith("your-"):
        print("GEMINI_API_KEY missing in backend/.env", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=key)
    model = os.getenv("GEMINI_VEO_MODEL", "veo-3.1-fast-generate-preview").strip()
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    ok = 0
    for bg in BACKGROUNDS:
        try:
            raw = generate_8s(client, model, bg)
            to_15s_silent(raw, bg, ffmpeg)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {bg}: {exc}", file=sys.stderr)
    print(f"done {ok}/{len(BACKGROUNDS)} → {OUT}")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
