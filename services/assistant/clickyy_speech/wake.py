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
    "clickyy": ["click e", "click key", "quickie", "clique e", "clicky"],
    "jarvis": ["jarvis", "hey jarvis"],
}


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

    def evaluate(self, result: dict, now: float | None = None) -> tuple[str, float] | None:
        """Evaluate a Vosk final result dict. Returns (phrase_id, confidence) or None."""
        now = time.monotonic() if now is None else now
        text = (result.get("text") or "").strip()
        if not text or text not in self.lookup:
            return None
        words = result.get("result") or []
        conf = sum(w.get("conf", 0.0) for w in words) / len(words) if words else 0.0
        if conf < sensitivity_to_threshold(self.sensitivity):
            return None
        if now - self._last_fire < self.cooldown_s:
            return None
        self._last_fire = now
        return self.lookup[text], round(conf, 3)
