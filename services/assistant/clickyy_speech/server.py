"""Loopback-only speech service for Clickyy.

Protocol (documented in docs/SPEECH_PROTOCOL.md):
  GET  /health                      header  Authorization: Bearer <token>
  GET  /tts/voices                  header  Authorization: Bearer <token>
  POST /tts                         header  Authorization: Bearer <token>   {"text","voice","speed"} -> audio/wav
  WS   /ws/stt?token=<token>        text frames: {"type":"start","mode":"wake"|"command",
                                                  "phrases":[...],"sensitivity":0.5,"accurate":true}
                                                 {"type":"stop"}   (flush + final)
                                                 {"type":"cancel"} (discard)
                                    binary frames: PCM16LE mono 16 kHz
  server -> client text frames: ready | partial | final | silence | wake | error
"""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import sys

from fastapi import FastAPI, Header, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError

from .advanced import KokoroEngine, WhisperEngine
from .engine import EngineUnavailable, Event, Session, VoskEngine
from .verify import WakeVerifier
from .wake import WAKE_VARIANTS

MAX_FRAME_BYTES = 64_000  # ~2 s of audio; larger frames are rejected


class StartMsg(BaseModel):
    type: str = Field(pattern="^start$")
    mode: str = Field(pattern="^(wake|command)$")
    phrases: list[str] = Field(default_factory=list, max_length=8)
    sensitivity: float = Field(default=0.5, ge=0.0, le=1.0)
    cooldown_ms: int = Field(default=2000, ge=0, le=10000)
    accurate: bool = True
    # Recognition languages: ["en", "hi"] (auto between English and Hindi), ["en"] or ["hi"].
    languages: list[str] = Field(default_factory=lambda: ["en", "hi"], max_length=2)
    # Second-stage check of the wake word with Whisper (fewer false wakes, so stage one can be more sensitive).
    verify: bool = True


def pick_whisper(models_root: str, explicit: str | None, extra_root: str | None = None) -> str:
    """Recognition model: an explicit choice; else large-v3-turbo only if the user downloaded it
    (Settings › Best accuracy; ~4× slower); else the bundled multilingual small; else base.en."""
    has = lambda d: bool(d) and os.path.isfile(os.path.join(d, "model.bin"))  # noqa: E731
    if has(explicit):
        return explicit  # type: ignore[return-value]
    if extra_root and has(os.path.join(extra_root, "whisper-large-v3-turbo")):
        return os.path.join(extra_root, "whisper-large-v3-turbo")
    for name in ("whisper-small", "whisper-base.en"):
        if has(os.path.join(models_root, name)):
            return os.path.join(models_root, name)
    return explicit or os.path.join(models_root, "whisper-base.en")


class TtsReq(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    voice: str = Field(default="af_heart", pattern=r"^[a-z]{2}_[a-z]+$")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


def create_app(token: str, model_path: str, whisper_dir: str | None = None, kokoro_dir: str | None = None) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    engine = VoskEngine(model_path)
    engine.load()
    models_root = os.path.dirname(os.path.abspath(model_path))
    extra_root = os.environ.get("CLICKYY_EXTRA_MODELS")  # models downloaded in the app (user data folder)
    whisper = WhisperEngine(pick_whisper(models_root, whisper_dir, extra_root))
    # English only: the English base model is about 3× faster than small with the same English
    # accuracy (eval/run_asr.py), so it takes English-only sessions unless the user chose best accuracy.
    base_en = os.path.join(models_root, "whisper-base.en")
    whisper_en = WhisperEngine(base_en) if whisper.multilingual and "large" not in whisper.model_dir.name and os.path.isdir(base_en) else whisper
    # The small English model re-checks wake words: fast, and "Clicky" is said the same way in any accent.
    verifier = WakeVerifier(base_en)
    kokoro = KokoroEngine(kokoro_dir or os.path.join(models_root, "kokoro"))

    def authorized(value: str | None) -> bool:
        return value is not None and hmac.compare_digest(value, token)

    def require(authorization: str | None):
        if not authorized((authorization or "").removeprefix("Bearer ")):
            raise HTTPException(status_code=401)

    @app.on_event("startup")
    async def warm():
        # Load the heavier engines in the background so the first command isn't slow.
        async def load():
            await asyncio.to_thread(verifier.load)
            await asyncio.to_thread(whisper.load)
            await asyncio.to_thread(kokoro.load)
        asyncio.get_running_loop().create_task(load())

    @app.get("/health")
    def health(authorization: str | None = Header(default=None)):
        require(authorization)
        if not engine.ready:
            engine.load()
        return {
            "status": "ready" if engine.ready else "degraded",
            "engines": {
                "vosk": {"ready": engine.ready, "error": engine.error, "model": str(engine.model_path)},
                "whisper": {"available": whisper.available, "ready": whisper.ready, "error": whisper.error, "model": whisper.model_dir.name, "multilingual": whisper.multilingual},
                "wakeVerifier": {"available": verifier.available, "ready": verifier._model is not None, "error": verifier.error},
                "kokoro": {"available": kokoro.available, "ready": kokoro.ready, "error": kokoro.error},
            },
            "wakeSupport": {
                pid: any(all(engine.known_word(w) for w in v.split()) for v in variants)
                for pid, variants in WAKE_VARIANTS.items()
            } if engine.ready else {},
        }

    @app.get("/tts/voices")
    async def tts_voices(authorization: str | None = Header(default=None)):
        require(authorization)
        return {"voices": await asyncio.to_thread(kokoro.voices), "available": kokoro.available}

    @app.post("/tts")
    async def tts(req: TtsReq, authorization: str | None = Header(default=None)):
        require(authorization)
        if not kokoro.available:
            raise HTTPException(status_code=503, detail="Neural voice model not installed")
        try:
            wav = await asyncio.to_thread(kokoro.synthesize, req.text, req.voice, req.speed)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return Response(content=wav, media_type="audio/wav")

    @app.websocket("/ws/stt")
    async def stt(ws: WebSocket):
        if not authorized(ws.query_params.get("token")):
            await ws.close(code=4401)
            return
        await ws.accept()
        session: Session | None = None
        accurate = True
        languages: tuple[str, ...] = ("en", "hi")

        async def send(ev: Event):
            await ws.send_text(ev.to_json())

        async def emit(events: list[Event], sess: Session):
            for ev in events:
                # Second pass: re-read the whole utterance with Whisper for an accurate final transcript.
                if accurate and sess.mode == "command" and ev.type in ("final", "silence") and whisper.available and sess.last_utterance:
                    refined = await asyncio.to_thread(transcribe, sess.last_utterance, ev.data.get("text", ""))
                    if refined:
                        ev = Event("final", {"text": refined[0], "confidence": refined[1], "engine": "whisper", "language": refined[2], "draft": ev.data.get("text", "")})

                # "Clicky, open Spotify" in one breath: transcribe what came after the wake word.
                if ev.type == "wake" and sess.last_tail and whisper.available:
                    tail = await asyncio.to_thread(transcribe, sess.last_tail, "")
                    if tail:
                        ev = Event("wake", {**ev.data, "command": tail[0], "language": tail[2]})
                await send(ev)

        def transcribe(pcm: bytes, hint: str):
            eng = whisper_en if languages == ("en",) and whisper_en.available else whisper
            return eng.transcribe(pcm, hint, languages=languages)

        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if msg.get("bytes") is not None:
                    data: bytes = msg["bytes"]
                    if session is None:
                        continue
                    if len(data) > MAX_FRAME_BYTES or len(data) % 2:
                        await send(Event("error", {"code": "bad_frame", "message": "invalid audio frame"}))
                        continue
                    await emit(session.feed(data), session)
                    continue
                text = msg.get("text")
                if not text:
                    continue
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    await send(Event("error", {"code": "bad_json", "message": "invalid control message"}))
                    continue
                kind = payload.get("type")
                if kind == "start":
                    try:
                        start = StartMsg.model_validate(payload)
                        session = Session(engine, start.mode, start.phrases, start.sensitivity, start.cooldown_ms / 1000,
                                          verifier=verifier if start.verify and start.mode == "wake" else None)
                        accurate = start.accurate
                        languages = tuple(l for l in start.languages if l in ("en", "hi")) or ("en", "hi")
                        await send(Event("ready", {"mode": start.mode, "grammar": session.grammar, "accurate": accurate and whisper.available}))
                    except ValidationError as exc:
                        await send(Event("error", {"code": "bad_start", "message": str(exc.errors()[0]["msg"])}))
                    except EngineUnavailable as exc:
                        await send(Event("error", {"code": "engine_unavailable", "message": str(exc)}))
                elif kind == "stop":
                    if session is not None:
                        sess = session
                        session = None
                        await emit(sess.flush(), sess)
                elif kind == "cancel":
                    session = None
                elif kind == "ping":
                    await send(Event("pong", {}))
        except WebSocketDisconnect:
            pass

    return app



def main() -> None:
    import uvicorn

    token = os.environ.get("CLICKYY_TOKEN")
    if not token or len(token) < 32:
        print("CLICKYY_TOKEN missing or too short", file=sys.stderr)
        sys.exit(2)
    port = int(os.environ.get("CLICKYY_PORT", "0"))
    model = os.environ.get("CLICKYY_VOSK_MODEL", os.path.join(os.path.dirname(__file__), "..", "models", "vosk-model-small-en-us-0.15"))
    app = create_app(token, model, os.environ.get("CLICKYY_WHISPER_MODEL"), os.environ.get("CLICKYY_KOKORO_DIR"))
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", ws_max_size=MAX_FRAME_BYTES + 1024)
    server = uvicorn.Server(config)

    # Report the bound port on stdout so the supervisor can connect (port 0 = OS-assigned).
    original_startup = server.startup

    async def startup(sockets=None):
        await original_startup(sockets)
        for s in server.servers:
            for sock in s.sockets:
                print(f"CLICKYY_READY port={sock.getsockname()[1]}", flush=True)
                return

    server.startup = startup  # type: ignore[method-assign]
    server.run()


if __name__ == "__main__":
    main()
