"""Wake-phrase matching on top of a grammar-restricted Vosk recognizer.

Vosk's small English model has no entry for "clicky", so each wake phrase is
mapped to in-vocabulary acoustic variants ("hey click e", "quickie", ...).
The recognizer is restricted to those variants plus "[unk]", which absorbs
everything else; a detection requires a final result whose text is exactly a
variant and whose mean word confidence clears the sensitivity threshold.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

# Canonical phrase id -> recognizer variants. Every word here must exist in the
# model vocabulary (checked at startup by the service).
WAKE_VARIANTS: dict[str, list[str]] = {
    "hey_clickyy": ["hey click e", "hey click key", "hey quickie", "hey clique e", "hey clicky"],
    "clickyy": ["click e", "click key", "quickie", "clique e", "clicky", "ok click e", "okay click e", "hi click e", "click e e",
                "click hey", "hi click key", "okay click key", "hello click e"],
    "jarvis": ["jarvis", "hey jarvis"],
}


# Words that may come before the wake word ("Okay Clicky", "Hi Clicky", a breath Vosk calls [unk]).
LEAD_INS = {"[unk]", "hey", "hi", "okay", "ok", "hello"}


def sensitivity_to_threshold(sensitivity: float) -> float:
    """Map UI sensitivity (0 = strict, 1 = permissive) to a min confidence."""
    s = min(max(sensitivity, 0.0), 1.0)
    return round(0.95 - 0.55 * s, 3)  # 0.95 .. 0.40


def build_grammar(enabled: list[str], known_word) -> tuple[list[str], dict[str, str]]:
    """Return (grammar phrases, variant->phrase id) for enabled phrases.

    `known_word(word) -> bool` filters out variants with out-of-vocabulary words
    so the recognizer never silently drops a word and matches a shorter phrase.
    """
    grammar: list[str] = []
    lookup: dict[str, str] = {}
    for pid in enabled:
        for variant in WAKE_VARIANTS.get(pid, []):
            if all(known_word(w) for w in variant.split()):
                grammar.append(variant)
                lookup[variant] = pid
    grammar.append("[unk]")
    return grammar, lookup


@dataclass
class WakeMatcher:
    lookup: dict[str, str]
    sensitivity: float = 0.5
    cooldown_s: float = 2.0
    _last_fire: float = field(default=-1e9, init=False)

    # With a second-stage verifier the first stage can be much more permissive.
    relax: float = 0.0

    def find(self, result: dict) -> tuple[str, float, float, float] | None:
        """Best wake variant anywhere in a Vosk final result: (phrase_id, confidence, start_s, end_s).

        The variant may be followed by more words ("clicky open spotify" → "click e [unk] [unk]"),
        so it is matched as a run of words, not only as the whole text.
        """
        words = [w for w in (result.get("result") or []) if w.get("word")]
        if not words:
            text = (result.get("text") or "").strip()
            return (self.lookup[text], 1.0, 0.0, 0.0) if text in self.lookup else None
        best, best_n = None, 0
        for variant, pid in self.lookup.items():
            parts = variant.split()
            n = len(parts)
            for i in range(len(words) - n + 1):
                if [w["word"] for w in words[i : i + n]] != parts:
                    continue
                # Only at the start of the utterance, after at most two greeting/filler words
                # ("[unk]" breath, "okay", "hi"): "Okay Clicky, …" but not "I will click e later".
                if i > 2 or any(w["word"] not in LEAD_INS for w in words[:i]):
                    continue
                conf = sum(w.get("conf", 0.0) for w in words[i : i + n]) / n
                # Higher confidence wins; on a tie the longer variant ("hey click e" over "click e").
                if best is None or (conf, n) > (best[1], best_n):
                    best, best_n = (pid, conf, float(words[i].get("start", 0.0)), float(words[i + n - 1].get("end", 0.0))), n
        return best

    def evaluate(self, result: dict, now: float | None = None) -> tuple[str, float] | None:
        """Evaluate a Vosk final result dict. Returns (phrase_id, confidence) or None."""
        hit = self.evaluate_full(result, now)
        if not hit:
            return None
        self.fired(now)
        return hit[0], hit[1]

    def evaluate_full(self, result: dict, now: float | None = None) -> tuple[str, float, float, float] | None:
        now = time.monotonic() if now is None else now
        hit = self.find(result)
        if not hit:
            return None
        if hit[1] < max(0.2, sensitivity_to_threshold(self.sensitivity) - self.relax):
            return None
        if now - self._last_fire < self.cooldown_s:
            return None
        return (hit[0], round(hit[1], 3), hit[2], hit[3])

    def fired(self, now: float | None = None) -> None:
        self._last_fire = time.monotonic() if now is None else now
