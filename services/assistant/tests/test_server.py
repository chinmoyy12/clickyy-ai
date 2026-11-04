"""Service tests. Audio tests use WAV fixtures synthesized offline with the Windows
SAPI voice (scripts/make-speech-fixtures.ps1); they are skipped when the Vosk
model or fixtures are absent. These are real-engine tests, not mocks."""

import json
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from clickyy_speech.server import create_app

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "models" / "vosk-model-small-en-us-0.15"
FIXTURES = ROOT / "tests" / "fixtures"
TOKEN = "t" * 40

needs_model = pytest.mark.skipif(not MODEL.is_dir(), reason="Vosk model not installed")


def client(model=MODEL):
    return TestClient(create_app(TOKEN, str(model)))


def pcm(name: str) -> bytes:
    path = FIXTURES / name
    if not path.exists():
        pytest.skip(f"fixture {name} missing")
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2
        return w.readframes(w.getnframes())


def stream(ws, audio: bytes, chunk=3200):
    events = []
    for i in range(0, len(audio), chunk):
        ws.send_bytes(audio[i : i + chunk])
    # trailing silence lets the endpointer close the utterance
    ws.send_bytes(b"\x00" * 16000)
    ws.send_text(json.dumps({"type": "stop"}))
    ws.send_text(json.dumps({"type": "ping"}))
    while True:
        ev = json.loads(ws.receive_text())
        if ev["type"] == "pong":
            return events
        events.append(ev)


def test_health_requires_token():
    c = client(Path("does-not-exist"))
    assert c.get("/health").status_code == 401
    assert c.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_health_reports_degraded_without_model():
    c = client(Path("does-not-exist"))
    r = c.get("/health", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert "not found" in body["engines"]["vosk"]["error"]


def test_ws_rejects_bad_token():
    c = client(Path("does-not-exist"))
    with pytest.raises(Exception):
        with c.websocket_connect("/ws/stt?token=nope") as ws:
            ws.receive_text()


def test_ws_start_without_model_reports_engine_unavailable():
    c = client(Path("does-not-exist"))
    with c.websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "command"}))
        ev = json.loads(ws.receive_text())
        assert ev["type"] == "error" and ev["code"] == "engine_unavailable"


def test_ws_validates_start_message():
    c = client(Path("does-not-exist"))
    with c.websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "shell"}))
        assert json.loads(ws.receive_text())["code"] == "bad_start"
        ws.send_text("not json")
        assert json.loads(ws.receive_text())["code"] == "bad_json"


@needs_model
def test_health_ready_and_wake_support():
    body = client().get("/health", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert body["status"] == "ready"
    assert body["wakeSupport"]["jarvis"] is True
    assert body["wakeSupport"]["hey_clickyy"] is True


@needs_model
def test_command_mode_transcribes_real_speech():
    with client().websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "command"}))
        assert json.loads(ws.receive_text())["type"] == "ready"
        events = stream(ws, pcm("open_notepad.wav"))
    finals = " ".join(e["text"] for e in events if e["type"] == "final")
    assert "notepad" in finals or "note pad" in finals
    assert any(e["type"] == "partial" for e in events)


@needs_model
def test_wake_mode_detects_jarvis_and_ignores_other_speech():
    with client().websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "wake", "phrases": ["jarvis"], "sensitivity": 0.6}))
        assert json.loads(ws.receive_text())["type"] == "ready"
        hits = [e for e in stream(ws, pcm("hey_jarvis.wav")) if e["type"] == "wake"]
    assert hits and hits[0]["phrase"] == "jarvis"

    with client().websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "wake", "phrases": ["jarvis"], "sensitivity": 0.6}))
        json.loads(ws.receive_text())
        hits = [e for e in stream(ws, pcm("weather_sentence.wav")) if e["type"] == "wake"]
    assert hits == []


@needs_model
@pytest.mark.parametrize("fixture", ["hey_clicky.wav", "clicky.wav"])
def test_wake_mode_detects_clickyy_variants(fixture):
    with client().websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "wake", "phrases": ["hey_clickyy", "clickyy"], "sensitivity": 0.6}))
        json.loads(ws.receive_text())
        hits = [e for e in stream(ws, pcm(fixture)) if e["type"] == "wake"]
    assert hits and hits[0]["phrase"] in {"hey_clickyy", "clickyy"}


@needs_model
def test_rejects_oversized_frames():
    with client().websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "command"}))
        json.loads(ws.receive_text())
        ws.send_bytes(b"\x00" * 70_000)
        assert json.loads(ws.receive_text())["code"] == "bad_frame"
