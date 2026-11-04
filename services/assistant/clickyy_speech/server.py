"""Loopback-only speech service for Clickyy.

Protocol (documented in docs/SPEECH_PROTOCOL.md):
  GET  /health                      header  Authorization: Bearer <token>
  WS   /ws/stt?token=<token>        text frames: {"type":"start","mode":"wake"|"command",
                                                  "phrases":[...],"sensitivity":0.5}
                                                 {"type":"stop"}   (flush + final)
                                                 {"type":"cancel"} (discard)
                                    binary frames: PCM16LE mono 16 kHz
  server -> client text frames: ready | partial | final | silence | wake | error
"""

from __future__ import annotations

import hmac
import json
import os
import sys

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError

from .engine import EngineUnavailable, Event, Session, VoskEngine
from .wake import WAKE_VARIANTS

MAX_FRAME_BYTES = 64_000  # ~2 s of audio; larger frames are rejected


class StartMsg(BaseModel):
    type: str = Field(pattern="^start$")
    mode: str = Field(pattern="^(wake|command)$")
    phrases: list[str] = Field(default_factory=list, max_length=8)
    sensitivity: float = Field(default=0.5, ge=0.0, le=1.0)
    cooldown_ms: int = Field(default=2000, ge=0, le=10000)


def create_app(token: str, model_path: str) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    engine = VoskEngine(model_path)
    engine.load()

    def authorized(value: str | None) -> bool:
        return value is not None and hmac.compare_digest(value, token)

    @app.get("/health")
    def health(authorization: str | None = Header(default=None)):
        if not authorized((authorization or "").removeprefix("Bearer ")):
            raise HTTPException(status_code=401)
        if not engine.ready:
            engine.load()
        return {
            "status": "ready" if engine.ready else "degraded",
            "engines": {"vosk": {"ready": engine.ready, "error": engine.error, "model": str(engine.model_path)}},
            "wakeSupport": {
                pid: any(all(engine.known_word(w) for w in v.split()) for v in variants)
                for pid, variants in WAKE_VARIANTS.items()
            } if engine.ready else {},
        }

    @app.websocket("/ws/stt")
    async def stt(ws: WebSocket):
        if not authorized(ws.query_params.get("token")):
            await ws.close(code=4401)
            return
        await ws.accept()
        session: Session | None = None

        async def send(ev: Event):
            await ws.send_text(ev.to_json())

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
                    for ev in session.feed(data):
                        await send(ev)
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
                        session = Session(engine, start.mode, start.phrases, start.sensitivity, start.cooldown_ms / 1000)
                        await send(Event("ready", {"mode": start.mode, "grammar": session.grammar}))
                    except ValidationError as exc:
                        await send(Event("error", {"code": "bad_start", "message": str(exc.errors()[0]["msg"])}))
                    except EngineUnavailable as exc:
                        await send(Event("error", {"code": "engine_unavailable", "message": str(exc)}))
                elif kind == "stop":
                    if session is not None:
                        for ev in session.flush():
                            await send(ev)
                    session = None
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
    app = create_app(token, model)
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
