"""Build the synthetic English / Hindi / Hinglish benchmark corpus.

    python -I eval/build_corpus.py            # writes eval/data/{asr,wake}/ and manifests

Every phrase is spoken by several different voices (American, British and Indian-accented
English, Hindi male and female, Windows voices) at different speeds, then put through
real-world conditions: steady noise, a crowd talking (babble), a reverberant room through a
laptop mic, a quiet speaker, and a far, noisy speaker. Synthetic speech is not a person;
treat the scores as a hard, repeatable regression test, not a guarantee.
"""

from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # Hindi text on a Windows console

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audio  # noqa: E402
import phrases as P  # noqa: E402

DATA = audio.ROOT / "eval" / "data"


def write(path: Path, x: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(audio.SR)
        w.writeframes(audio.to_pcm16(x))


def babble_track(rng: np.random.Generator) -> np.ndarray:
    voices = ["am_adam", "af_sarah", "bm_george", "hf_beta", "hm_psi", "af_nicole"]
    tracks = []
    for k, v in enumerate(voices):
        texts = P.BACKGROUND_HI if v.startswith("h") else P.BACKGROUND
        tracks.append(np.concatenate([audio.synth(t, v) for t in texts[k % len(texts):] + texts[: k % len(texts)]]))
    n = min(len(t) for t in tracks)
    return np.sum([t[:n] for t in tracks], axis=0).astype(np.float32)


def build_asr(rng: np.random.Generator, babble: np.ndarray, per_phrase: int = 4) -> list[dict]:
    items = []
    en_pool = audio.EN_VOICES + audio.SAPI_VOICES + audio.HI_VOICES  # Hindi voices give Indian-accented English
    sets = [("en", P.EN, en_pool), ("hi", P.HI, audio.HI_VOICES), ("hinglish", P.HINGLISH, audio.HI_VOICES)]
    k = 0
    for lang, items_src, pool in sets:
        for pi, (text, kws) in enumerate(items_src):
            for r in range(per_phrase):
                voice = pool[(pi * per_phrase + r) % len(pool)]
                if lang == "en" and r == 0:
                    voice = audio.HI_VOICES[pi % 4]  # every English phrase gets an Indian accent at least once
                speed = [1.0, 0.9, 1.15, 1.0][r % 4]
                cond = audio.CONDITIONS[(pi + r) % len(audio.CONDITIONS)]
                x = audio.condition(audio.synth(text, voice, speed), cond, rng, babble)
                name = f"asr/{lang}_{pi:02d}_{r}.wav"
                write(DATA / name, x)
                items.append({"file": name, "lang": lang, "text": text, "keywords": kws, "voice": voice, "speed": speed, "condition": cond})
                k += 1
        print(f"{lang}: {len(items_src) * per_phrase} clips", flush=True)
    return items


def build_wake(rng: np.random.Generator, babble: np.ndarray) -> list[dict]:
    items = []
    en_voices = audio.EN_VOICES + audio.SAPI_VOICES + audio.HI_VOICES
    for kind, texts, voices in [("pos", P.WAKE_POSITIVE, en_voices), ("pos", P.WAKE_POSITIVE_HI, audio.HI_VOICES),
                                ("neg", P.WAKE_NEGATIVE, en_voices), ("neg", P.WAKE_NEGATIVE_HI, audio.HI_VOICES)]:
        for ti, text in enumerate(texts):
            reps = 8 if kind == "pos" else 3
            for r in range(reps):
                voice = voices[(ti * reps + r * 5) % len(voices)]
                speed = [1.0, 0.85, 1.2, 1.0, 0.95, 1.1, 1.0, 0.9][r % 8]
                cond = audio.CONDITIONS[(ti + r) % len(audio.CONDITIONS)]
                x = audio.condition(audio.synth(text, voice, speed), cond, rng, babble)
                name = f"wake/{kind}_{len(items):04d}.wav"
                write(DATA / name, x)
                items.append({"file": name, "kind": kind, "text": text, "voice": voice, "condition": cond})
    # Ten minutes of continuous talk with no wake word, for false alarms per hour.
    parts, total = [], 0
    i = 0
    while total < audio.SR * 600:
        texts = P.BACKGROUND + P.BACKGROUND_HI
        t = texts[i % len(texts)]
        v = (audio.HI_VOICES if any("ऀ" <= c <= "ॿ" for c in t) else en_voices)[i % 4 if t in P.BACKGROUND_HI else i % len(en_voices)]
        x = audio.condition(audio.synth(t, v, [1.0, 0.9, 1.1][i % 3]), audio.CONDITIONS[i % len(audio.CONDITIONS)], rng, babble)
        parts.append(x); total += len(x); i += 1
    write(DATA / "wake/background_10min.wav", np.concatenate(parts))
    items.append({"file": "wake/background_10min.wav", "kind": "background", "seconds": total / audio.SR})
    print(f"wake: {sum(1 for x in items if x['kind'] == 'pos')} positive, {sum(1 for x in items if x['kind'] == 'neg')} negative, {total / audio.SR / 60:.1f} min background", flush=True)
    return items


def main() -> None:
    rng = np.random.default_rng(20261107)
    babble = babble_track(rng)
    asr = build_asr(rng, babble)
    (DATA / "asr.jsonl").write_text("\n".join(json.dumps(i, ensure_ascii=False) for i in asr), encoding="utf-8")
    wake = build_wake(rng, babble)
    (DATA / "wake.jsonl").write_text("\n".join(json.dumps(i, ensure_ascii=False) for i in wake), encoding="utf-8")


if __name__ == "__main__":
    main()
