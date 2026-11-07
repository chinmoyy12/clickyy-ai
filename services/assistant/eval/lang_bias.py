"""Tune English/Hindi detection: how much should a Hindi guess be favoured?

    python -I eval/lang_bias.py [model]      # default whisper-small

Records Whisper's language probabilities for every clip once, then shows the confusion for
several Hindi weights (hi_score = weight × P(Hindi-like) against P(English)).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import audio  # noqa: E402
from clickyy_speech.advanced import WhisperEngine, hindi_score  # noqa: E402

DATA = audio.ROOT / "eval" / "data"


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "whisper-small"
    items = [json.loads(l) for l in (DATA / "asr.jsonl").read_text(encoding="utf-8").splitlines()]
    eng = WhisperEngine(audio.ROOT / "models" / name)
    assert eng.load()
    rows, t0 = [], time.perf_counter()
    for it in items:
        x = audio.read_wav(DATA / it["file"])
        _, _, probs = eng._model.detect_language(x)
        p = dict(probs)
        rows.append({"lang": it["lang"], "en": p.get("en", 0.0), "hi": hindi_score(p), "condition": it["condition"]})
    print(f"detect: {(time.perf_counter() - t0) / len(items):.2f} s/clip (encoder pass)")
    for w in (1.0, 1.5, 2.0, 3.0, 4.0):
        conf = {}
        for r in rows:
            out = "hi" if w * r["hi"] > r["en"] else "en"
            key = ("en" if r["lang"] == "en" else "hi", out)
            conf[key] = conf.get(key, 0) + 1
        en_wrong = conf.get(("en", "hi"), 0)
        hi_wrong = conf.get(("hi", "en"), 0)
        print(f"weight {w}: English heard as Hindi {en_wrong}/120, Hindi/Hinglish heard as English {hi_wrong}/140")
    (DATA / "lang-probs.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
