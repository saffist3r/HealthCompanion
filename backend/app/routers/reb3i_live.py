"""WebSocket bridge: mobile ↔ Gemini Live (Reb3i diabetes companion).

Voice protocol (simple turn-taking):
  Client records a clip → sends {type:audio} → server feeds Live as one user turn →
  streams model reply audio back → {type:turn_complete}.
  No duplex, no mid-turn text nudges.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.deps import household_device_ids
from app.models import User
from app.services.auth_tokens import decode_access_token
from app.services.reb3i_live import (
    audio_bytes_to_pcm16_16k,
    build_live_chat_context,
    build_live_system_instruction,
    chunk_bytes,
    context_summary_line,
    greeting_seed_facts,
    live_connect_config,
    pcm16_to_wav,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reb3i-live"])


def _user_from_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    try:
        payload = decode_access_token(token)
    except Exception:  # noqa: BLE001
        return None
    user_id = str(payload.get("sub") or "")
    user = db.get(User, user_id) if user_id else None
    if not user or not user.active:
        return None
    return user


def _load_chat_context(db: Session) -> dict[str, Any]:
    return build_live_chat_context(db, household_device_ids(db))


async def _ws_send(ws: WebSocket, payload: dict[str, Any]) -> None:
    await ws.send_text(json.dumps(payload, ensure_ascii=False))


async def _send_user_audio(session: Any, pcm: bytes) -> None:
    """One complete user utterance with manual activity markers (auto-VAD off)."""
    await session.send_realtime_input(activity_start=types.ActivityStart())
    for piece in chunk_bytes(pcm, 3200):
        await session.send_realtime_input(
            audio=types.Blob(data=piece, mime_type="audio/pcm;rate=16000")
        )
    await session.send_realtime_input(activity_end=types.ActivityEnd())


@router.websocket("/ws/reb3i-live")
async def reb3i_live_ws(websocket: WebSocket) -> None:
    """Live voice chat with Reb3i.

    Client → server:
      { "type": "ping" }
      { "type": "text", "text": "..." }
      { "type": "audio", "data": "<base64>", "filename": "clip.m4a" }
      { "type": "end" }

    Server → client:
      ready | status | transcript | audio | turn_complete | error
    """
    await websocket.accept()
    settings = get_settings()
    if not settings.gemini_configured:
        await _ws_send(websocket, {"type": "error", "message": "Gemini is not configured"})
        await websocket.close(code=1011)
        return

    token = websocket.query_params.get("token") or websocket.headers.get("authorization", "").replace(
        "Bearer ", ""
    ).strip()
    db = SessionLocal()
    try:
        user = _user_from_token(db, token)
        if not user:
            await _ws_send(websocket, {"type": "error", "message": "Unauthorized"})
            await websocket.close(code=4401)
            return
        context = _load_chat_context(db)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Reb3i live context failed")
        await _ws_send(websocket, {"type": "error", "message": f"Context failed: {exc}"})
        await websocket.close(code=1011)
        return
    finally:
        db.close()

    model = (settings.gemini_live_model or "").strip() or "gemini-2.5-flash-native-audio-preview-12-2025"
    system = build_live_system_instruction(context)
    client = genai.Client(api_key=settings.gemini_api_key)
    config = live_connect_config(system)
    summary = context_summary_line(context)
    seed = greeting_seed_facts(context)

    try:
        async with client.aio.live.connect(model=model, config=config) as session:
            await _ws_send(
                websocket,
                {
                    "type": "ready",
                    "model": model,
                    "contextSummary": summary,
                    "hint": "Hold to talk, or Hands-free → tap the orb.",
                },
            )
            await session.send_client_content(
                turns=types.Content(
                    role="user",
                    parts=[
                        types.Part(
                            text=(
                                "(System cue) Session start. Greet Saff in Darija with 1–2 numbers "
                                "from the facts below, invite him to talk, then STOP briefing — "
                                "converse turn by turn only.\n"
                                f"Key facts:\n{seed}"
                            )
                        )
                    ],
                ),
                turn_complete=True,
            )
            await _stream_model_turn(websocket, session)

            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await _ws_send(websocket, {"type": "error", "message": "Invalid JSON"})
                    continue
                mtype = (msg.get("type") or "").strip()
                if mtype == "ping":
                    await _ws_send(websocket, {"type": "pong"})
                    continue
                if mtype == "end":
                    break
                if mtype == "text":
                    text = (msg.get("text") or "").strip()
                    if not text:
                        continue
                    await _ws_send(websocket, {"type": "status", "message": "Reb3i is thinking…"})
                    await session.send_realtime_input(text=text)
                    await _stream_model_turn(websocket, session)
                    continue
                if mtype == "audio":
                    b64 = msg.get("data") or ""
                    try:
                        audio_raw = base64.b64decode(b64)
                    except Exception:  # noqa: BLE001
                        await _ws_send(websocket, {"type": "error", "message": "Bad audio base64"})
                        continue
                    if len(audio_raw) < 200:
                        await _ws_send(websocket, {"type": "error", "message": "Audio too short"})
                        continue
                    await _ws_send(websocket, {"type": "status", "message": "Got your voice…"})
                    try:
                        pcm = await asyncio.to_thread(
                            audio_bytes_to_pcm16_16k,
                            audio_raw,
                            filename_hint=str(msg.get("filename") or "clip.m4a"),
                        )
                    except Exception as exc:  # noqa: BLE001
                        await _ws_send(
                            websocket, {"type": "error", "message": f"Could not decode audio: {exc}"}
                        )
                        continue
                    if len(pcm) < 1600:  # < ~50ms @ 16kHz mono
                        await _ws_send(websocket, {"type": "error", "message": "Audio too short"})
                        continue
                    await _send_user_audio(session, pcm)
                    await _stream_model_turn(websocket, session)
                    continue
                await _ws_send(websocket, {"type": "error", "message": f"Unknown type: {mtype}"})
    except WebSocketDisconnect:
        logger.info("Reb3i live client disconnected")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Reb3i live session error")
        try:
            await _ws_send(websocket, {"type": "error", "message": str(exc)})
        except Exception:  # noqa: BLE001
            pass
    finally:
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass


async def _stream_model_turn(websocket: WebSocket, session: Any) -> str:
    """Forward model audio to the phone as soon as it arrives (slice streaming)."""
    # 24 kHz mono s16le → bytes/sec = 48000. First slice ~120ms, then ~250ms.
    first_slice = 24000 * 2 // 8  # ~125ms
    next_slice = 24000 * 2 // 4  # ~250ms
    buf = bytearray()
    out_bits: list[str] = []
    in_bits: list[str] = []
    sent_first = False
    user_tx_sent = False

    async def _flush(n: int) -> None:
        nonlocal buf
        if len(buf) < n:
            return
        piece = bytes(buf[:n])
        del buf[:n]
        wav = pcm16_to_wav(piece, rate=24000)
        await _ws_send(
            websocket,
            {
                "type": "audio_slice",
                "mimeType": "audio/wav",
                "data": base64.b64encode(wav).decode("ascii"),
            },
        )

    async for ev in session.receive():
        if getattr(ev, "data", None):
            buf.extend(ev.data)
            # Start playback ASAP on first audio
            thresh = first_slice if not sent_first else next_slice
            while len(buf) >= thresh:
                await _flush(thresh)
                sent_first = True
                thresh = next_slice
        sc = getattr(ev, "server_content", None)
        if sc:
            it = getattr(sc, "input_transcription", None)
            if it and getattr(it, "text", None):
                in_bits.append(it.text)
                # Stream user transcript early when we have a chunk
                if not user_tx_sent and len("".join(in_bits).strip()) > 8:
                    await _ws_send(
                        websocket,
                        {
                            "type": "transcript",
                            "role": "user",
                            "text": "".join(in_bits).strip(),
                        },
                    )
                    user_tx_sent = True
            ot = getattr(sc, "output_transcription", None)
            if ot and getattr(ot, "text", None):
                out_bits.append(ot.text)
            if getattr(sc, "turn_complete", False):
                break

    if buf:
        await _flush(len(buf))

    model_text = "".join(out_bits).strip()
    if in_bits and not user_tx_sent:
        await _ws_send(
            websocket, {"type": "transcript", "role": "user", "text": "".join(in_bits).strip()}
        )
    if model_text:
        await _ws_send(websocket, {"type": "transcript", "role": "model", "text": model_text})
    await _ws_send(websocket, {"type": "turn_complete"})
    return model_text
