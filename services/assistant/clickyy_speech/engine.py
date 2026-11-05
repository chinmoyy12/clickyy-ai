"""Vosk-backed recognition sessions (wake mode and command mode)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .wake import WakeMatcher, build_grammar

SAMPLE_RATE = 16000


class EngineUnavailable(RuntimeError):
    pass


class VoskEngine:
    def __init__(self, model_path: str | os.PathLike[str]):
        self.model_path = Path(model_path)
        self._model = None
        self.error: str | None = None

    def load(self) -> bool:
        if self._model is not None:
            return True
        if not self.model_path.is_dir():
            self.error = f"Vosk model not found at {self.model_path}"
            return False
        try:
            import vosk

            vosk.SetLogLevel(-1)
            self._model = vosk.Model(str(self.model_path))
            self.error = None
            return True
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as degraded state
            self.error = f"Failed to load Vosk: {exc}"
            return False

    @property
    def ready(self) -> bool:
        return self._model is not None

    def known_word(self, word: str) -> bool:
        if word == "[unk]":
            return True
        return self._model is not None and self._model.vosk_model_find_word(word) >= 0

    def recognizer(self, grammar: list[str] | None = None):
        if not self.ready:
            raise EngineUnavailable(self.error or "engine not loaded")
        import vosk

        if grammar is not None:
            rec = vosk.KaldiRecognizer(self._model, SAMPLE_RATE, json.dumps(grammar))
        else:
            rec = vosk.KaldiRecognizer(self._model, SAMPLE_RATE)
        rec.SetWords(True)
        return rec


@dataclass
class Event:
    type: str
    data: dict

    def to_json(self) -> str:
        return json.dumps({"type": self.type, **self.data})


class Session:
    """One recognition session. Feed PCM16 mono 16 kHz bytes, get events."""

    def __init__(self, engine: VoskEngine, mode: str, phrases: list[str], sensitivity: float, cooldown_s: float = 2.0):
        self.mode = mode
        if mode == "wake":
            grammar, lookup = build_grammar(phrases, engine.known_word)
            if len(grammar) <= 1:
                raise EngineUnavailable("No enabled wake phrase is supported by the installed model")
            self.matcher: WakeMatcher | None = WakeMatcher(lookup, sensitivity, cooldown_s)
            self.rec = engine.recognizer(grammar)
            self.grammar = grammar
        elif mode == "command":
            self.matcher = None
            self.rec = engine.recognizer()
            self.grammar = []
        else:
            raise ValueError(f"unknown mode {mode!r}")
        self._last_partial = ""
        # Audio of the utterance in progress (command mode), so a second, more accurate
        # recognizer (Whisper) can re-read it when Vosk reaches an endpoint.
        self._utterance = bytearray()
        self.last_utterance = b""

    MAX_UTTERANCE = 16000 * 2 * 30  # 30 s of PCM16

    def feed(self, pcm: bytes) -> list[Event]:
        events: list[Event] = []
        if self.mode == "command" and len(self._utterance) < self.MAX_UTTERANCE:
            self._utterance.extend(pcm)
        if self.rec.AcceptWaveform(pcm):
            result = json.loads(self.rec.Result())
            events.extend(self._final(result))
        elif self.mode == "command":
            partial = json.loads(self.rec.PartialResult()).get("partial", "")
            if partial and partial != self._last_partial:
                self._last_partial = partial
                events.append(Event("partial", {"text": partial}))
        return events

    def flush(self) -> list[Event]:
        result = json.loads(self.rec.FinalResult())
        return self._final(result, forced=True)

    def _final(self, result: dict, forced: bool = False) -> list[Event]:
        text = (result.get("text") or "").strip()
        if self.mode == "wake":
            hit = self.matcher.evaluate(result) if self.matcher else None
            return [Event("wake", {"phrase": hit[0], "confidence": hit[1]})] if hit else []
        self._last_partial = ""
        self.last_utterance = bytes(self._utterance)
        self._utterance.clear()
        words = result.get("result") or []
        conf = sum(w.get("conf", 0.0) for w in words) / len(words) if words else 0.0
        if not text:
            return [Event("silence", {"forced": forced})]
        return [Event("final", {"text": text, "confidence": round(conf, 3)})]
