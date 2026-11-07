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


PROMPT_EN = "Clickyy, Jarvis, VS Code, Spotify, Chrome, Notepad, WhatsApp, YouTube, Wi-Fi, Bluetooth, Excel, percent."
# Hindi prompt: Devanagari, with the English app names people mix in, so Hinglish keeps them.
PROMPT_HI = "क्लिकी, स्पॉटिफ़ाई खोलो, वॉल्यूम बढ़ाओ, क्रोम, व्हाट्सएप, यूट्यूब, एक्सेल, गाना चलाओ, टाइमर लगाओ।"


def hindi_score(probs: dict[str, float]) -> float:
    """Probability mass that sounds like Hindi: Hindi and Urdu (spoken alike), half of nearby languages."""
    return probs.get("hi", 0.0) + probs.get("ur", 0.0) + 0.5 * (probs.get("pa", 0.0) + probs.get("mr", 0.0) + probs.get("ne", 0.0) + probs.get("bn", 0.0))


# Favouring Hindi was measured (eval/lang_bias.py) and did not pay off: at 1.5, Hindi heard as
# English fell from 19 to 13 of 140 clips, but those clips were too noisy to transcribe anyway
# (end-to-end Hindi commands 73.5% → 72.7%) and English in far, noisy rooms got worse (84% → 74%).
HINDI_WEIGHT = 1.0


def pick_language(probs: dict[str, float], hindi_weight: float | None = None) -> str:
    """English or Hindi only."""
    w = HINDI_WEIGHT if hindi_weight is None else hindi_weight
    return "hi" if w * hindi_score(probs) > probs.get("en", 0.0) else "en"


class WhisperEngine:
    def __init__(self, model_dir: str | os.PathLike[str], multilingual: bool | None = None, beam_size: int = 3, use_prompt: bool = True,
                 languages: tuple[str, ...] = ("en", "hi")):
        self.model_dir = Path(model_dir)
        # English-only models (".en") can't do Hindi; detect from the folder name unless told.
        self.multilingual = (not self.model_dir.name.endswith(".en")) if multilingual is None else multilingual
        self.beam_size = beam_size
        self.use_prompt = use_prompt
        self.languages = languages
        self.temperature: float | tuple[float, ...] = 0.0
        self.max_new_tokens = 160  # ~30 s of fast Hindi speech; commands are far shorter
        self._model = None
        self._lock = threading.Lock()
        self.error: str | None = None

    @property
    def available(self) -> bool:
        return (self.model_dir / "model.bin").exists()

    _load_lock = threading.Lock()  # one model load at a time (startup warm-up vs. first request)

    def load(self) -> bool:
        if self._model is not None:
            return True
        if not self.available:
            self.error = f"Whisper model not found at {self.model_dir}"
            return False
        with self._load_lock:
            if self._model is not None:
                return True
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

    def detect(self, audio: np.ndarray, languages: tuple[str, ...] | None = None) -> str:
        """'en' or 'hi' (only the given languages are considered)."""
        langs = languages or self.languages
        if not self.multilingual:
            return "en"
        if len(langs) == 1:
            return langs[0]
        _, _, all_probs = self._model.detect_language(audio)
        lang = pick_language(dict(all_probs))
        return lang if lang in langs else langs[0]

    def _detect_once(self, audio: np.ndarray, languages: tuple[str, ...] | None):
        """Language (en/hi) plus the encoder output it came from, so the audio is encoded only once.

        Whisper always encodes a padded 30 s window; on a laptop CPU that pass is most of the
        cost (about 2.3 s for the small model), and the stock detect-then-transcribe runs it twice.
        """
        langs = languages or self.languages
        if not self.multilingual:
            return "en", None
        if len(langs) == 1:
            return langs[0], None
        from faster_whisper.audio import pad_or_trim

        feats = self._model.feature_extractor(audio)
        frames = min(self._model.feature_extractor.nb_max_frames, feats.shape[-1] - 1)
        encoded = self._model.encode(pad_or_trim(feats[:, :frames]))
        probs = {tok[2:-2]: p for tok, p in self._model.model.detect_language(encoded)[0]}
        lang = pick_language(probs)
        return (lang if lang in langs else langs[0]), encoded

    def _reuse_encoding(self, encoded) -> None:
        """Make the next (first) encoder call return the output we already have."""
        model = self._model
        original = type(model).encode
        used = [False]

        def encode(features):
            if not used[0]:
                used[0] = True
                return encoded
            return original(model, features)  # audio longer than 30 s: later windows encode normally

        model.encode = encode

    def transcribe(self, pcm16: bytes, hint: str = "", language: str | None = None, languages: tuple[str, ...] | None = None) -> tuple[str, float, str] | None:
        """Transcribe 16 kHz mono PCM16. Returns (text, confidence, language) or None for no speech."""
        if not self.load() or len(pcm16) < 16000:  # < 0.5 s
            return None
        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(audio**2)))
        if rms < 0.002:  # near silence
            return None
        if rms < 0.03:  # quiet or far speaker: normalize so Whisper hears it at a normal level
            audio = audio * min(20.0, 0.08 / rms)
        with self._lock:
            lang, encoded = (language, None) if (language and self.multilingual) else self._detect_once(audio, languages)
            if encoded is not None:
                self._reuse_encoding(encoded)
            base = (PROMPT_HI if lang == "hi" else PROMPT_EN) if self.use_prompt else None
            # The Vosk draft as a hint; agreeing with it is fine, so only the fixed prompt counts as an echo.
            prompt = (base + (f" {hint}" if hint and lang == "en" else "")) if base else None
            # One decoding pass (no temperature fallback, which re-decodes up to 6× on noisy or Hindi
            # audio), a token cap sized for spoken commands, and no 3-word loops ("यूट्यूब, यूट्यूब, …").
            segments, _ = self._model.transcribe(
                audio, language=lang, beam_size=self.beam_size, vad_filter=False, without_timestamps=True,
                condition_on_previous_text=False, initial_prompt=prompt,
                temperature=self.temperature, max_new_tokens=self.max_new_tokens, no_repeat_ngram_size=3,
            )
            try:
                segs = [s for s in segments if not (s.no_speech_prob > 0.6 and s.avg_logprob < -0.8)]
            finally:
                self._model.__dict__.pop("encode", None)  # back to the model's own encoder
        text = " ".join(s.text.strip() for s in segs).strip()
        if not text or text.lower() in HALLUCINATIONS or (base and _echoes_prompt(text, base)):
            return None
        conf = float(np.exp(np.mean([s.avg_logprob for s in segs]))) if segs else 0.0
        return text, round(min(1.0, conf), 3), lang


def _echoes_prompt(text: str, prompt: str) -> bool:
    """Whisper sometimes repeats the prompt back on noise; treat that as no speech."""
    t = text.strip(" .।,").lower()
    return len(t) > 12 and t in prompt.lower()


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
        # Hindi voices (hf_*/hm_*) use the Hindi phonemizer; the app picks one for Devanagari replies.
        lang = "hi" if voice.startswith("h") else "en-gb" if voice.startswith("b") else "en-us"
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
