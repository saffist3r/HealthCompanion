# Erreb3i (Reb3i) stock media

Portrait stills used live for **Reb3i — video** (free path, no Veo):

- `reb3i-beach.png` — beach set
- `reb3i-padel.png` — padel court set
- `reb3i-cafe.png` — café populaire set

The API animates a day’s still with ffmpeg (Ken Burns + light audio pulse) and muxes Darija TTS. Stills are copied into the backend image at `/app/media/reb3i`.

Optional offline Veo clips (paid quota / Enterprise not required for product video):

```bash
backend/.venv/bin/python scripts/generate-reb3i-clips.py
```

Notes:

- Product video does **not** call Veo.
- Developer API Veo clips are typically **8s max**; the script loops/trims to **15s** and strips audio for GIF conversion.
- Do **not** pass `generate_audio` on Developer API (Enterprise-only).
