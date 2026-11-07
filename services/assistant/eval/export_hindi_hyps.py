"""Export real Whisper Hindi/Hinglish transcripts as a fixture for the app's Hindi understanding test.

    python -I eval/export_hindi_hyps.py small     # -> apps/desktop/tests/fixtures/hindi-asr.json

The app test feeds each transcript through understandHindi + the router and checks it reaches
the same command as the clean reference sentence.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "small"
    rows = json.loads((ROOT / "eval" / "data" / f"asr-results-{name}.json").read_text(encoding="utf-8"))["rows"]
    out = [{"text": r["text"], "hyp": r["hyp"], "lang": r["lang"], "condition": r["condition"], "voice": r["voice"]}
           for r in rows if r["lang"] in ("hi", "hinglish")]
    dest = ROOT.parents[1] / "apps" / "desktop" / "tests" / "fixtures" / "hindi-asr.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"model": name, "rows": out}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out)} rows -> {dest}")


if __name__ == "__main__":
    main()
