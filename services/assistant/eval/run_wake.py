"""Benchmark the "Clicky" wake word by streaming clips through the real wake session.

    python -I eval/run_wake.py                 # current settings
    python -I eval/run_wake.py --sens 0.3 0.5 0.7 --verify off on

Positive clips must wake it once; sound-alikes and ten minutes of background talk must not.
"""

from __future__ import annotations

import inspect
import json
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # Hindi text on a Windows console

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if "--pkg" in sys.argv:  # benchmark an older copy of the speech package
    sys.path.insert(0, sys.argv[sys.argv.index("--pkg") + 1])
import audio  # noqa: E402
from clickyy_speech.engine import Session, VoskEngine  # noqa: E402

DATA = audio.ROOT / "eval" / "data"
CHUNK = 3200  # 100 ms of PCM16


def run_clip(engine, pcm: bytes, sens: float, verifier) -> list[dict]:
    kwargs = {"verifier": verifier} if "verifier" in inspect.signature(Session.__init__).parameters else {}
    s = Session(engine, "wake", ["hey_clickyy", "clickyy"], sens, cooldown_s=2.0, **kwargs)
    evs = []
    for i in range(0, len(pcm), CHUNK):
        evs += [e.data for e in s.feed(pcm[i : i + CHUNK]) if e.type == "wake"]
    evs += [e.data for e in s.flush() if e.type == "wake"]
    return evs


def main() -> None:
    def arg_list(flag: str, default: list[str]) -> list[str]:
        if flag not in sys.argv:
            return default
        i = sys.argv.index(flag) + 1
        out = []
        while i < len(sys.argv) and not sys.argv[i].startswith("--"):
            out.append(sys.argv[i]); i += 1
        return out

    sens_list = [float(x) for x in arg_list("--sens", ["0.5"])]
    verify_list = arg_list("--verify", ["off"])
    items = [json.loads(line) for line in (DATA / "wake.jsonl").read_text(encoding="utf-8").splitlines()]
    engine = VoskEngine(audio.ROOT / "models" / "vosk-model-small-en-us-0.15")
    assert engine.load(), engine.error
    verifiers = {"off": None}
    if "on" in verify_list:
        from clickyy_speech.verify import WakeVerifier
        verifiers["on"] = WakeVerifier(audio.ROOT / "models" / "whisper-base.en")
        assert verifiers["on"].load()
    if "noprompt" in verify_list:
        from clickyy_speech.verify import WakeVerifier
        verifiers["noprompt"] = WakeVerifier(audio.ROOT / "models" / "whisper-base.en", prompt=False)
        assert verifiers["noprompt"].load()
    if "small" in verify_list:  # the multilingual small model as verifier
        from clickyy_speech.verify import WakeVerifier
        verifiers["small"] = WakeVerifier(audio.ROOT / "models" / "whisper-small")
        assert verifiers["small"].load()
    results = []
    for verify in verify_list:
        for sens in sens_list:
            t0 = time.perf_counter()
            pos = neg = pos_hit = neg_hit = 0
            misses, false = [], []
            for it in items:
                if it["kind"] == "background":
                    continue
                pcm = audio.to_pcm16(audio.read_wav(DATA / it["file"]))
                n = len(run_clip(engine, pcm, sens, verifiers[verify]))
                if it["kind"] == "pos":
                    pos += 1; pos_hit += n > 0
                    if n == 0:
                        misses.append(f"{it['text']} [{it['voice']}/{it['condition']}]")
                else:
                    neg += 1; neg_hit += n > 0
                    if n:
                        false.append(f"{it['text']} [{it['voice']}/{it['condition']}]")
            bg = next(i for i in items if i["kind"] == "background")
            bg_hits = len(run_clip(engine, audio.to_pcm16(audio.read_wav(DATA / bg["file"])), sens, verifiers[verify]))
            r = {"verify": verify, "sensitivity": sens, "recall": round(pos_hit / pos, 3), "false_accept_soundalikes": round(neg_hit / neg, 3),
                 "false_wakes_per_hour_talk": round(bg_hits * 3600 / bg["seconds"], 1), "positives": pos, "negatives": neg, "sec": round(time.perf_counter() - t0, 1)}
            results.append(r)
            print(json.dumps(r))
            from collections import Counter
            print("   misses by phrase:", dict(Counter(m.split(" [")[0] for m in misses).most_common(8)))
            print("   misses by condition:", dict(Counter(m.split("/")[-1].rstrip("]") for m in misses)))
            print("   false wakes:", false[:10])
    (DATA / "wake-results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
