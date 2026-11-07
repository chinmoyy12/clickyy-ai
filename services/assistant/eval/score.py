"""Scoring: Devanagari to Latin transliteration, keyword capture and word error rate."""

from __future__ import annotations

import re
import unicodedata

_CONS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
    "ष": "sh", "स": "s", "ह": "h", "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f", "य़": "y",
}
_VOW = {"अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e"}
_SIGN = {"ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e"}
_DIGITS = {chr(0x0966 + i): str(i) for i in range(10)}


def translit(text: str) -> str:
    """Rough Devanagari → Latin (schwa dropped at word end), enough for fuzzy matching."""
    text = unicodedata.normalize("NFC", text)
    out: list[str] = []
    chars = list(text)
    i = 0
    while i < len(chars):
        c = chars[i]
        nxt = chars[i + 1] if i + 1 < len(chars) else ""
        if c + nxt in _CONS and nxt == "़":  # nukta forms
            c, i = c + nxt, i + 1
            nxt = chars[i + 1] if i + 1 < len(chars) else ""
        if c in _CONS:
            out.append(_CONS[c])
            if nxt in _SIGN:
                out.append(_SIGN[nxt]); i += 1
            elif nxt == "्":
                i += 1
            elif nxt and ("ऀ" <= nxt <= "ॿ") and nxt not in "ंँः":
                out.append("a")
            elif nxt in "ंँ":
                out.append("a")
        elif c in _VOW:
            out.append(_VOW[c])
        elif c in "ंँ":
            out.append("n")
        elif c == "ः":
            out.append("h")
        elif c in _DIGITS:
            out.append(_DIGITS[c])
        elif c in "।॥":
            out.append(" ")
        elif c != "़":
            out.append(c)
        i += 1
    return "".join(out)


def norm(text: str) -> str:
    t = translit(text).lower()
    t = t.replace("%", " % ").replace("-", " ")
    t = re.sub(r"[^a-z0-9% ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _lev(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _squash(s: str) -> str:
    """Collapse long/short vowels and doubled letters so 'gaana' ~ 'gana', 'aaj' ~ 'aj'."""
    s = re.sub(r"(.)\1+", r"\1", s)
    return s.replace("w", "v").replace("ee", "i").replace("oo", "u")


def keyword_hit(hyp_norm: str, keyword: str) -> bool:
    words = hyp_norm.split()
    for alt in keyword.split("|"):
        a = _squash(norm(alt))
        n = len(a.split())
        for k in range(len(words) - n + 1):
            cand = _squash(" ".join(words[k : k + n]))
            if cand == a or (len(a) >= 4 and _lev(cand, a) <= max(1, len(a) // 4)):
                return True
        # Joined forms ("screen shot" vs "screenshot").
        if a.replace(" ", "") in _squash(hyp_norm.replace(" ", "")) and len(a) >= 4:
            return True
    return False


def keyword_recall(hyp: str, keywords: list[str]) -> tuple[int, int]:
    h = norm(hyp)
    return sum(keyword_hit(h, k) for k in keywords), len(keywords)


def wer(ref: str, hyp: str) -> float:
    r, h = norm(ref).split(), norm(hyp).split()
    if not r:
        return 0.0 if not h else 1.0
    prev = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        cur = [i]
        for j, hw in enumerate(h, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rw != hw)))
        prev = cur
    return prev[-1] / len(r)
