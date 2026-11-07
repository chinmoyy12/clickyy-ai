"""Second-stage wake verification.

Vosk's small model has no word "clicky", so stage one listens for sound-alikes ("click e",
"quickie") and is tuned to miss almost nothing. Stage two re-reads just the last ~2 seconds
with Whisper and only lets the wake through if it really heard "Clicky" (or "Jarvis").
Everything runs on the device; the audio is never stored.
"""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path

import numpy as np

# How Whisper spells "Clicky" (and the Hindi क्लिकी), plus Jarvis.
CLICKY = re.compile(
    r"\b(?:[ck]l[iy]+(?:ck|k|c|q|qu|kk)+(?:y|ie|ey|i|ee|e|ies|y's|ys)|[ck]l[iy]+(?:ck|k|c)+[- ](?:e|ee|y|key)|clique(?:y|ie)?|cliquey|kliki|quickie|clicky)\b"
    # Run together with a greeting or slurred in noise: "Heclicky", "Heplicky", "Gliggy".
    r"|\b(?:he|hi|ok)?[cpg]l[iy]+(?:ck|k|gg|g)+(?:y|ie|ey)\b"
    r"|क्लिकी|क्लिक्की|क्लिकि|किलिकी",
    re.IGNORECASE,
)
JARVIS = re.compile(r"\b(?:jarvis|jarvi|jervis|jarviss|travis)\b|जार्विस", re.IGNORECASE)
# Words that look close but are everyday speech and must never wake it.
NOT_WAKE = re.compile(r"\b(?:quickly|clicking|clicked|clicks?|click here|tricky|sticky|picky|lucky|cookie|vicky|nicky|ricky|mickey|kicky)\b", re.IGNORECASE)


def heard_wake(text: str, phrase: str = "clickyy") -> bool:
    t = text.strip()
    if not t:
        return False
    if phrase == "jarvis":
        return bool(JARVIS.search(t))
    m = CLICKY.search(t)
    if not m:
        return False
    # "click" alone (or "quickly") isn't the name.
    return not NOT_WAKE.fullmatch(m.group(0))


class WakeVerifier:
    """Re-reads a short window with Whisper. Thread-safe; loads lazily."""

    def __init__(self, model_dir: str | os.PathLike[str], prompt: bool = True):
        self.model_dir = Path(model_dir)
        self.prompt = prompt
        self._model = None
        self._lock = threading.Lock()
        self.error: str | None = None
        self.multilingual = not self.model_dir.name.endswith(".en")

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

            self._model = WhisperModel(str(self.model_dir), device="cpu", compute_type="int8", cpu_threads=max(2, min(4, (os.cpu_count() or 4) // 3)))
            return True
        except Exception as exc:  # noqa: BLE001
            self.error = f"Failed to load wake verifier: {exc}"
            return False

    def transcribe(self, pcm16: bytes, prompt: bool | None = None) -> str:
        if not self.load():
            return ""
        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(audio**2))) if len(audio) else 0.0
        if rms < 0.002:
            return ""
        if rms < 0.03:
            audio = audio * min(20.0, 0.08 / rms)
        with self._lock:
            segs, _ = self._model.transcribe(
                audio, language="en", beam_size=1, vad_filter=False, without_timestamps=True, condition_on_previous_text=False,
                initial_prompt="Clicky." if (self.prompt if prompt is None else prompt) else None,
            )
            return " ".join(s.text.strip() for s in segs if not (s.no_speech_prob > 0.7 and s.avg_logprob < -1.0))

    def confirm(self, pcm16: bytes, phrase: str = "clickyy", strict: bool = False) -> tuple[bool, str]:
        """strict: no "Clicky" prompt. Benchmarked: catches fewer wakes (69% vs 87%) but no false ones."""
        text = self.transcribe(pcm16, prompt=False if strict else None)
        return heard_wake(text, phrase), text
