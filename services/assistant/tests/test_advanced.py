"""Real-engine tests for Whisper (accurate transcripts) and Kokoro (neural voice).
Skipped when the models aren't installed (scripts/download-voice-models.ps1)."""

import io
import json
import wave
from pathlib import Path

import pytest

from test_server import FIXTURES, MODEL, TOKEN, client, pcm, stream

ROOT = Path(__file__).resolve().parents[1]
HAS_WHISPER = (ROOT / "models" / "whisper-base.en" / "model.bin").exists()
HAS_KOKORO = (ROOT / "models" / "kokoro" / "kokoro-v1.0.int8.onnx").exists()
AUTH = {"Authorization": f"Bearer {TOKEN}"}

needs_whisper = pytest.mark.skipif(not (HAS_WHISPER and MODEL.is_dir()), reason="Whisper model not installed")
needs_kokoro = pytest.mark.skipif(not HAS_KOKORO, reason="Kokoro model not installed")


@needs_whisper
@pytest.mark.parametrize(("fixture", "expected"), [
    ("open_notepad.wav", "open notepad"),
    ("volume_thirty.wav", ("set the volume to 30", "set the volume to thirty")),
    ("weather_sentence.wav", "the weather is lovely today and i am going for a walk"),
])
def test_whisper_refines_final_transcripts(fixture, expected):
    with client().websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "command"}))
        assert json.loads(ws.receive_text())["accurate"] is True
        events = stream(ws, pcm(fixture))
    finals = [e for e in events if e["type"] == "final"]
    assert finals and finals[-1]["engine"] == "whisper"
    norm = "".join(c for c in finals[-1]["text"].lower() if c.isalnum() or c == " ").strip()
    assert any(e in norm for e in ((expected,) if isinstance(expected, str) else expected))


@needs_whisper
def test_accurate_mode_can_be_disabled():
    with client().websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "command", "accurate": False}))
        json.loads(ws.receive_text())
        finals = [e for e in stream(ws, pcm("open_notepad.wav")) if e["type"] == "final"]
    assert finals and "engine" not in finals[-1]


@needs_whisper
def test_whisper_ignores_silence():
    with client().websocket_connect(f"/ws/stt?token={TOKEN}") as ws:
        ws.send_text(json.dumps({"type": "start", "mode": "command"}))
        json.loads(ws.receive_text())
        events = stream(ws, b"\x00" * 32000 * 2)
    assert not [e for e in events if e["type"] == "final"]


def test_tts_requires_token():
    c = client()
    assert c.post("/tts", json={"text": "hi"}).status_code == 401
    assert c.get("/tts/voices").status_code == 401


@needs_kokoro
def test_tts_rejects_bad_input():
    c = client()
    assert c.post("/tts", json={"text": ""}, headers=AUTH).status_code == 422
    assert c.post("/tts", json={"text": "hi", "voice": "../../etc"}, headers=AUTH).status_code == 422
    assert c.post("/tts", json={"text": "x" * 5000}, headers=AUTH).status_code == 422


@needs_kokoro
def test_neural_voice_synthesizes_wav():
    c = client()
    voices = c.get("/tts/voices", headers=AUTH).json()["voices"]
    ids = {v["id"] for v in voices}
    assert {"af_heart", "bf_emma"} <= ids
    assert all(v["accent"] in ("American English", "British English") for v in voices)
    r = c.post("/tts", json={"text": "Good evening. All systems are running.", "voice": "bf_emma", "speed": 1.0}, headers=AUTH)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(r.content)) as w:
        assert w.getframerate() == 24000 and w.getnchannels() == 1
        assert w.getnframes() / 24000 > 1.5  # roughly two seconds of speech


@needs_kokoro
@needs_whisper
def test_round_trip_neural_voice_is_intelligible():
    """Speak with Kokoro, listen with Whisper: proves the voice is clear enough to understand."""
    import numpy as np

    c = client()
    r = c.post("/tts", json={"text": "Set a timer for ten minutes.", "voice": "af_heart"}, headers=AUTH)
    with wave.open(io.BytesIO(r.content)) as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    resampled = np.interp(np.arange(0, len(audio), 1.5), np.arange(len(audio)), audio).astype(np.int16)  # 24k -> 16k
    from clickyy_speech.advanced import WhisperEngine

    text = WhisperEngine(ROOT / "models" / "whisper-base.en").transcribe(resampled.tobytes())[0]
    assert "timer" in text.lower() and ("ten" in text.lower() or "10" in text)


HAS_SMALL = (ROOT / "models" / "whisper-small" / "model.bin").exists()


@needs_kokoro
@pytest.mark.skipif(not HAS_SMALL, reason="multilingual Whisper not installed")
def test_hindi_round_trip_voice_and_recognition():
    """A Hindi reply in the Hindi neural voice, heard by multilingual Whisper: detected as Hindi, in Devanagari."""
    import numpy as np

    r = client().post("/tts", json={"text": "अभी शाम के सात बजे हैं।", "voice": "hf_alpha"}, headers=AUTH)
    assert r.status_code == 200
    with wave.open(io.BytesIO(r.content)) as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    resampled = np.interp(np.arange(0, len(audio), 1.5), np.arange(len(audio)), audio).astype(np.int16)
    from clickyy_speech.advanced import WhisperEngine

    text, _, lang = WhisperEngine(ROOT / "models" / "whisper-small").transcribe(resampled.tobytes())
    assert lang == "hi"
    assert any("ऀ" <= c <= "ॿ" for c in text)
    # Whisper small often writes साथ for सात and पजे for बजे; the app's Hindi layer repairs both.
    assert "शाम" in text and any(w in text for w in ("सात", "साथ", "7"))
