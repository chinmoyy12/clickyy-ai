"""Optional advanced engines: Whisper (accurate final transcripts) and Kokoro (neural voice).

Both are loaded lazily and are optional: if a model or package is missing the service
keeps working with Vosk and the app falls back to Windows voices.
"""

from __future__ import annotations

import io
import os
import threading
import wave
from pathlib import Path

import numpy as np

# Short phrases Whisper tends to invent from noise or silence.
HALLUCINATIONS = {"thank you.", "thanks for watching!", "thank you for watching.", "you", ".", "bye.", "so", "okay."}


class WhisperEngine:
    def __init__(self, model_dir: str | os.PathLike[str]):
        self.model_dir = Path(model_dir)
        self._model = None
        self._lock = threading.Lock()
        self.error: str | None = None

    @property
    def available(self) -> bool:
        return (self.model_dir / "model.bin").exists()

    def load(self) -> bool:
        if self._model is not None:
            return True
        if not self.available:
            self.error = f"Whisper model not found at {self.model_dir}"
            return False
        try:
            from faster_whisper import WhisperModel

            threads = max(2, min(8, (os.cpu_count() or 4) // 2))
            self._model = WhisperModel(str(self.model_dir), device="cpu", compute_type="int8", cpu_threads=threads)
            self.error = None
            return True
        except Exception as exc:  # noqa: BLE001 - reported via /health
            self.error = f"Failed to load Whisper: {exc}"
            return False

    @property
    def ready(self) -> bool:
        return self._model is not None

    def transcribe(self, pcm16: bytes, hint: str = "") -> tuple[str, float] | None:
        """Transcribe 16 kHz mono PCM16. Returns (text, confidence) or None for no speech."""
        if not self.load() or len(pcm16) < 16000:  # < 0.5 s
            return None
        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        if float(np.sqrt(np.mean(audio**2))) < 0.004:  # near silence
            return None
        with self._lock:
            segments, _ = self._model.transcribe(
                audio, language="en", beam_size=2, vad_filter=False, without_timestamps=True,
                condition_on_previous_text=False,
                initial_prompt="Clickyy, Jarvis, VS Code, Spotify, Chrome, Notepad, Wi-Fi, percent." + (f" {hint}" if hint else ""),
            )
            segs = [s for s in segments if not (s.no_speech_prob > 0.6 and s.avg_logprob < -0.8)]
        text = " ".join(s.text.strip() for s in segs).strip()
        if not text or text.lower() in HALLUCINATIONS:
            return None
        conf = float(np.exp(np.mean([s.avg_logprob for s in segs]))) if segs else 0.0
        return text, round(min(1.0, conf), 3)


VOICE_INFO = {
    "a": "American English", "b": "British English",
}


class KokoroEngine:
    SAMPLE_RATE = 24000

    def __init__(self, model_dir: str | os.PathLike[str]):
        self.model_dir = Path(model_dir)
        self._k = None
        self._lock = threading.Lock()
        self.error: str | None = None

    @property
    def files(self) -> tuple[Path, Path]:
        return self.model_dir / "kokoro-v1.0.int8.onnx", self.model_dir / "voices-v1.0.bin"

    @property
    def available(self) -> bool:
        return all(p.exists() for p in self.files)

    def load(self) -> bool:
        if self._k is not None:
            return True
        if not self.available:
            self.error = f"Kokoro voice model not found at {self.model_dir}"
            return False
        try:
            from kokoro_onnx import Kokoro

            self._k = Kokoro(str(self.files[0]), str(self.files[1]))
            self.error = None
            return True
        except Exception as exc:  # noqa: BLE001
            self.error = f"Failed to load Kokoro: {exc}"
            return False

    @property
    def ready(self) -> bool:
        return self._k is not None

    def voices(self) -> list[dict]:
        if not self.load():
            return []
        out = []
        for v in sorted(self._k.get_voices()):
            accent, gender = v[0], v[1] if len(v) > 1 else "?"
            if accent not in VOICE_INFO:
                continue  # English voices only (the phonemizer is configured for English)
            out.append({"id": v, "name": v.split("_", 1)[-1].capitalize(), "accent": VOICE_INFO[accent], "gender": "female" if gender == "f" else "male"})
        return out

    def synthesize(self, text: str, voice: str, speed: float) -> bytes:
        """Return a 24 kHz mono 16-bit WAV."""
        if not self.load():
            raise RuntimeError(self.error or "Kokoro unavailable")
        lang = "en-gb" if voice.startswith("b") else "en-us"
        with self._lock:
            samples, sr = self._k.create(text, voice=voice, speed=float(min(2.0, max(0.5, speed))), lang=lang)
        pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(pcm)
        return buf.getvalue()
