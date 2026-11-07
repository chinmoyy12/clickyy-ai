"""Show what each stage heard for missed wake clips (and false wakes).

    python -I eval/diag_wake.py [--neg]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import audio  # noqa: E402
from clickyy_speech.engine import Session, VoskEngine  # noqa: E402
from clickyy_speech.verify import WakeVerifier  # noqa: E402

DATA = audio.ROOT / "eval" / "data"


def main() -> None:
    kind = "neg" if "--neg" in sys.argv else "pos"
    items = [json.loads(l) for l in (DATA / "wake.jsonl").read_text(encoding="utf-8").splitlines()]
    eng = VoskEngine(audio.ROOT / "models" / "vosk-model-small-en-us-0.15"); eng.load()
    ver = WakeVerifier(audio.ROOT / "models" / "whisper-base.en"); ver.load()
    for it in items:
        if it["kind"] != kind:
            continue
        pcm = audio.to_pcm16(audio.read_wav(DATA / it["file"]))
        s = Session(eng, "wake", ["hey_clickyy", "clickyy"], 0.5, verifier=ver)
        heard, woke = [], False
        orig = s._wake

        def spy(result, s=s, orig=orig):
            if result.get("text"):
                heard.append((result["text"], [round(w.get("conf", 0), 2) for w in result.get("result", [])]))
            evs = orig(result)
            if s.last_verify_text:
                heard.append(("VERIFY", s.last_verify_text)); s.last_verify_text = ""
            return evs

        s._wake = spy
        for i in range(0, len(pcm), 3200):
            woke |= any(e.type == "wake" for e in s.feed(pcm[i:i + 3200]))
        woke |= any(e.type == "wake" for e in s.flush())
        if woke != (kind == "pos"):
            print(f"{'MISS' if kind == 'pos' else 'FALSE'} {it['text']!r} [{it['voice']}/{it['condition']}] -> {heard}  | whole: {ver.transcribe(pcm)!r}")


if __name__ == "__main__":
    main()
