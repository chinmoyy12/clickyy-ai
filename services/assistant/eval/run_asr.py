"""Benchmark Whisper configurations on the corpus.

    python -I eval/run_asr.py base-en small turbo        # named configs below
    python -I eval/run_asr.py small --limit 40

Reports keyword recall (words the recognizer must not miss), English WER, script
correctness for Hindi, and seconds per utterance, split by language and condition.
"""

from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # Hindi text on a Windows console

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import audio  # noqa: E402
import score  # noqa: E402
from clickyy_speech.advanced import WhisperEngine  # noqa: E402

M = audio.ROOT / "models"
CONFIGS = {
    # Baseline: what 0.4.0 ships (English-only model, English forced).
    "base-en": {"model": M / "whisper-base.en", "multilingual": False},
    "small": {"model": M / "whisper-small", "multilingual": True},
    "small-b1": {"model": M / "whisper-small", "multilingual": True, "beam": 1},
    "small-b5": {"model": M / "whisper-small", "multilingual": True, "beam": 5},
    "turbo": {"model": M / "whisper-large-v3-turbo", "multilingual": True},
    "turbo-b5": {"model": M / "whisper-large-v3-turbo", "multilingual": True, "beam": 5},
    "turbo-noprompt": {"model": M / "whisper-large-v3-turbo", "multilingual": True, "prompt": False},
}


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    if limit:
        args = [a for a in args if a != str(limit)]
    items = [json.loads(line) for line in (audio.ROOT / "eval" / "data" / "asr.jsonl").read_text(encoding="utf-8").splitlines()]
    if limit:
        items = items[::max(1, len(items) // limit)]
    report = {}
    for name in args:
        cfg = CONFIGS[name]
        eng = WhisperEngine(cfg["model"], multilingual=cfg["multilingual"], beam_size=cfg.get("beam", 3), use_prompt=cfg.get("prompt", True))
        t0 = time.perf_counter()
        assert eng.load(), eng.error
        load_s = time.perf_counter() - t0
        eng.transcribe(audio.to_pcm16(audio.read_wav(audio.ROOT / "eval" / "data" / items[0]["file"])))  # warm-up
        rows = []
        for it in items:
            pcm = audio.to_pcm16(audio.read_wav(audio.ROOT / "eval" / "data" / it["file"]))
            t = time.perf_counter()
            r = eng.transcribe(pcm)
            dt = time.perf_counter() - t
            hyp = r[0] if r else ""
            hit, tot = score.keyword_recall(hyp, it["keywords"])
            devanagari = any("ऀ" <= c <= "ॿ" for c in hyp)
            urdu = any("؀" <= c <= "ۿ" for c in hyp)
            rows.append({**it, "hyp": hyp, "lang_out": r[2] if r and len(r) > 2 else "", "hit": hit, "tot": tot, "sec": dt,
                         "wer": score.wer(it["text"], hyp) if it["lang"] == "en" else None, "devanagari": devanagari, "urdu": urdu})
        agg: dict[str, dict] = defaultdict(lambda: {"hit": 0, "tot": 0, "sec": 0.0, "n": 0, "wer": 0.0, "nw": 0, "perfect": 0, "urdu": 0})
        for row in rows:
            for key in ("all", row["lang"], f"{row['lang']}/{row['condition']}"):
                a = agg[key]
                a["hit"] += row["hit"]; a["tot"] += row["tot"]; a["sec"] += row["sec"]; a["n"] += 1
                a["perfect"] += row["hit"] == row["tot"]; a["urdu"] += row["urdu"]
                if row["wer"] is not None:
                    a["wer"] += row["wer"]; a["nw"] += 1
        summary = {k: {"keyword_recall": round(v["hit"] / v["tot"], 3), "all_words_caught": round(v["perfect"] / v["n"], 3), "sec_per_utt": round(v["sec"] / v["n"], 2),
                       **({"wer": round(v["wer"] / v["nw"], 3)} if v["nw"] else {}), **({"urdu_script": v["urdu"]} if v["urdu"] else {}), "n": v["n"]} for k, v in sorted(agg.items())}
        report[name] = {"load_s": round(load_s, 1), "summary": summary}
        print(f"\n=== {name} (load {load_s:.1f}s)")
        for k in ["all", "en", "hi", "hinglish"]:
            if k in summary:
                print(f"  {k:9s} {summary[k]}")
        worst = sorted((r for r in rows if r["hit"] < r["tot"]), key=lambda r: r["hit"] / r["tot"])[:12]
        for r in worst:
            print(f"    MISS [{r['lang']}/{r['condition']}/{r['voice']}] {r['text']!r} -> {r['hyp']!r}")
        out = audio.ROOT / "eval" / "data" / f"asr-results-{name}.json"
        out.write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: {"load_s": v["load_s"], **{l: v["summary"].get(l) for l in ("en", "hi", "hinglish")}} for k, v in report.items()}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
