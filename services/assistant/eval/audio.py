"""Speech synthesis and acoustic augmentation for the benchmark (16 kHz mono float32)."""

from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 16000
ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "eval" / "data" / "tts-cache"

EN_VOICES = ["af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "af_river", "am_adam", "am_michael", "am_eric", "am_liam", "am_onyx", "am_puck",
             "bf_emma", "bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_lewis", "bm_daniel", "bm_fable"]
HI_VOICES = ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"]
SAPI_VOICES = ["Microsoft David Desktop", "Microsoft Zira Desktop"]

_kokoro = None


def kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro

        m = ROOT / "models" / "kokoro"
        _kokoro = Kokoro(str(m / "kokoro-v1.0.int8.onnx"), str(m / "voices-v1.0.bin"))
    return _kokoro


def resample(x: np.ndarray, sr_in: int, sr_out: int = SR) -> np.ndarray:
    if sr_in == sr_out:
        return x.astype(np.float32)
    n_out = int(round(len(x) * sr_out / sr_in))
    spec = np.fft.rfft(x)
    keep = n_out // 2 + 1
    spec = spec[:keep] if len(spec) >= keep else np.pad(spec, (0, keep - len(spec)))
    return (np.fft.irfft(spec, n_out) * (n_out / len(x))).astype(np.float32)


def _cache_path(key: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    return CACHE / (hashlib.sha1(key.encode("utf-8")).hexdigest()[:16] + ".npy")


def synth(text: str, voice: str, speed: float = 1.0) -> np.ndarray:
    """Speech for `text` at 16 kHz. Kokoro voices by id, Windows voices by name. Cached."""
    p = _cache_path(f"{voice}|{speed}|{text}")
    if p.exists():
        return np.load(p)
    if voice in SAPI_VOICES:
        x = _sapi(text, voice, speed)
    else:
        lang = "hi" if any("ऀ" <= ch <= "ॿ" for ch in text) else ("en-gb" if voice.startswith("b") else "en-us")
        s, sr = kokoro().create(text, voice=voice, speed=speed, lang=lang)
        x = resample(np.asarray(s, dtype=np.float32), sr)
    np.save(p, x)
    return x


def _sapi(text: str, voice: str, speed: float) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "s.wav")
        rate = int(round((speed - 1.0) * 10))
        ps = (
            "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$s.SelectVoice('{voice}'); $s.Rate = {rate}; "
            "$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); "
            f"$s.SetOutputToWaveFile('{out}', $f); $s.Speak($env:CLICKYY_TTS_TEXT); $s.Dispose()"
        )
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], check=True, env={**os.environ, "CLICKYY_TTS_TEXT": text}, capture_output=True)
        return read_wav(out)


def read_wav(path: str | os.PathLike[str]) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        if w.getnchannels() > 1:
            pcm = pcm.reshape(-1, w.getnchannels()).mean(axis=1)
        return resample(pcm, w.getframerate())


def to_pcm16(x: np.ndarray) -> bytes:
    return (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()


# ---------------------------------------------------------------- augmentation
def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2)) + 1e-9)


def pink_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.arange(len(spec)) + 1.0
    return np.fft.irfft(spec / np.sqrt(f), n).astype(np.float32)


def add_noise(x: np.ndarray, snr_db: float, rng: np.random.Generator, noise: np.ndarray | None = None) -> np.ndarray:
    if noise is None:
        noise = pink_noise(len(x), rng)
    elif len(noise) < len(x):
        noise = np.tile(noise, int(np.ceil(len(x) / len(noise))))[: len(x)]
    else:
        start = int(rng.integers(0, len(noise) - len(x) + 1))
        noise = noise[start : start + len(x)]
    noise = noise * (_rms(x) / _rms(noise)) / (10 ** (snr_db / 20))
    return (x + noise).astype(np.float32)


def reverb(x: np.ndarray, rt60: float, rng: np.random.Generator, wet: float = 0.35) -> np.ndarray:
    n = int(SR * rt60)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)
    ir[0] = 1.0
    ir /= np.sqrt(np.sum(ir**2))
    y = np.convolve(x, ir)[: len(x)]
    return ((1 - wet) * x + wet * y * (_rms(x) / _rms(y))).astype(np.float32)


def laptop_mic(x: np.ndarray) -> np.ndarray:
    """Band-limit to a cheap laptop mic (~150 Hz to 6.5 kHz) and add mild compression."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec[(f < 150) | (f > 6500)] *= 0.05
    y = np.fft.irfft(spec, len(x))
    return (np.tanh(2.0 * y) / 2.0).astype(np.float32)


def gain(x: np.ndarray, db: float) -> np.ndarray:
    return (x * 10 ** (db / 20)).astype(np.float32)


def pad(x: np.ndarray, before: float = 0.4, after: float = 0.6) -> np.ndarray:
    return np.concatenate([np.zeros(int(SR * before), np.float32), x, np.zeros(int(SR * after), np.float32)])


CONDITIONS = ["clean", "noise_15db", "babble_10db", "room_mic", "quiet", "far_noisy"]


def condition(x: np.ndarray, name: str, rng: np.random.Generator, babble: np.ndarray) -> np.ndarray:
    x = pad(x)
    if name == "clean":
        y = x
    elif name == "noise_15db":
        y = add_noise(x, 15, rng)
    elif name == "babble_10db":
        y = add_noise(x, 10, rng, babble)
    elif name == "room_mic":
        y = laptop_mic(reverb(x, 0.45, rng))
    elif name == "quiet":
        y = add_noise(gain(x, -22), 20, rng)
    elif name == "far_noisy":
        y = laptop_mic(add_noise(reverb(x, 0.6, rng, wet=0.5), 8, rng, babble))
    else:
        raise ValueError(name)
    peak = float(np.max(np.abs(y)) + 1e-9)
    return (y * min(1.0, 0.9 / peak)).astype(np.float32)
