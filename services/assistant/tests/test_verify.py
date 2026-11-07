"""Two-stage wake word: stage-one matcher placement rules, the verifier's text check,
English/Hindi language choice and Whisper model selection."""

from pathlib import Path

import pytest

from clickyy_speech.advanced import WhisperEngine, _echoes_prompt, pick_language
from clickyy_speech.engine import Session
from clickyy_speech.verify import WakeVerifier, heard_wake
from clickyy_speech.wake import WakeMatcher


def words(text, conf=0.9, t0=0.0, step=0.4):
    return {"text": text, "result": [{"word": w, "conf": conf, "start": t0 + i * step, "end": t0 + (i + 1) * step} for i, w in enumerate(text.split())]}


@pytest.mark.parametrize("text", ["Clicky.", "Hey Clicky, open Spotify", "clicky what's the time", "Klicky!", "Click-e", "क्लिकी", "Cliquey", "Heclicky.", "Gliggy.", "Okay, clicky."])
def test_verifier_accepts_clicky_spellings(text):
    assert heard_wake(text, "clickyy")


@pytest.mark.parametrize("text", ["", "quickly", "click here", "tricky", "sticky notes", "Vicky", "lucky", "cookie", "I clicked it", "hey Siri"])
def test_verifier_rejects_sound_alikes(text):
    assert not heard_wake(text, "clickyy")


def test_verifier_jarvis():
    assert heard_wake("Jarvis, lights", "jarvis")
    assert not heard_wake("Clicky", "jarvis")


def test_matcher_finds_wake_at_start_with_trailing_command():
    m = WakeMatcher({"click e": "clickyy", "hey click e": "hey_clickyy"}, sensitivity=0.5)
    hit = m.evaluate_full(words("hey click e open spotify"))
    assert hit and hit[0] == "hey_clickyy"
    assert hit[2] == pytest.approx(0.0) and hit[3] == pytest.approx(1.2)


def test_matcher_ignores_wake_words_mid_sentence():
    m = WakeMatcher({"click e": "clickyy"}, sensitivity=0.5)
    assert m.evaluate_full(words("i will click e later")) is None
    assert m.evaluate_full(words("[unk] click e")) is not None  # one unknown word before is fine (breath, "um")
    assert m.evaluate_full(words("okay click e")) is not None  # "Okay Clicky"
    assert m.evaluate_full(words("[unk] [unk] [unk] click e")) is None


def test_relax_lowers_threshold_only_when_verified():
    strict = WakeMatcher({"click e": "clickyy"}, sensitivity=0.5)
    relaxed = WakeMatcher({"click e": "clickyy"}, sensitivity=0.5, relax=0.3)
    r = words("click e", conf=0.5)
    assert strict.evaluate_full(r) is None
    assert relaxed.evaluate_full(r) is not None


def test_evaluate_full_does_not_start_cooldown():
    m = WakeMatcher({"click e": "clickyy"}, sensitivity=0.5, cooldown_s=2.0)
    assert m.evaluate_full(words("click e"))
    assert m.evaluate_full(words("click e"))  # the verifier rejected it: no cooldown yet
    m.fired()
    assert m.evaluate_full(words("click e")) is None


class FakeVerifier:
    available = True

    def __init__(self, ok):
        self.ok, self.calls = ok, []

    def confirm(self, pcm, phrase, strict=False):
        self.calls.append((len(pcm), phrase, strict))
        return self.ok, "Clicky" if self.ok else "quickly"


class FakeEngine:
    def __init__(self, result):
        self.result = result

    def known_word(self, w):
        return True

    def recognizer(self, grammar=None):
        engine = self

        class Rec:
            def AcceptWaveform(self, pcm):
                return True

            def Result(self):
                import json
                return json.dumps(engine.result)

            def FinalResult(self):
                return '{"text": ""}'

            def PartialResult(self):
                return '{"partial": ""}'

        return Rec()


@pytest.mark.parametrize("ok", [True, False])
def test_session_wakes_only_when_verifier_agrees(ok):
    v = FakeVerifier(ok)
    s = Session(FakeEngine(words("click e open spotify")), "wake", ["clickyy"], 0.5, verifier=v)
    evs = s.feed(b"\x01\x00" * 16000 * 2)  # 2 s of audio
    assert v.calls and v.calls[0][1] == "clickyy"
    assert [e.type for e in evs] == (["wake"] if ok else [])
    if ok:
        assert evs[0].data["verified"] is True
        assert len(s.last_tail) > 0  # "open spotify" kept for the command


def test_pick_language_counts_urdu_as_hindi():
    assert pick_language({"en": 0.6, "hi": 0.3}) == "en"
    assert pick_language({"en": 0.4, "hi": 0.25, "ur": 0.3}) == "hi"
    assert pick_language({"en": 0.45, "pa": 0.6, "hi": 0.2}) == "hi"
    assert pick_language({}) == "en"


def test_english_only_model_is_not_multilingual(tmp_path: Path):
    assert WhisperEngine(tmp_path / "whisper-base.en").multilingual is False
    assert WhisperEngine(tmp_path / "whisper-small").multilingual is True
    assert WakeVerifier(tmp_path / "missing").available is False


def test_pick_whisper_prefers_the_most_accurate_installed(tmp_path: Path):
    from clickyy_speech.server import pick_whisper

    for name in ("whisper-base.en", "whisper-small"):
        (tmp_path / name).mkdir()
        (tmp_path / name / "model.bin").write_bytes(b"x")
    assert Path(pick_whisper(str(tmp_path), None)).name == "whisper-small"
    assert Path(pick_whisper(str(tmp_path), str(tmp_path / "whisper-base.en"))).name == "whisper-base.en"
    assert Path(pick_whisper(str(tmp_path), str(tmp_path / "missing"))).name == "whisper-small"
    # A bundled turbo is ignored; one the user downloaded (extra root) wins.
    (tmp_path / "whisper-large-v3-turbo").mkdir()
    (tmp_path / "whisper-large-v3-turbo" / "model.bin").write_bytes(b"x")
    assert Path(pick_whisper(str(tmp_path), None)).name == "whisper-small"
    extra = tmp_path / "extra"
    (extra / "whisper-large-v3-turbo").mkdir(parents=True)
    (extra / "whisper-large-v3-turbo" / "model.bin").write_bytes(b"x")
    assert Path(pick_whisper(str(tmp_path), None, str(extra))).parent == extra


def test_prompt_echo_is_rejected():
    assert _echoes_prompt("Spotify, Chrome, Notepad, WhatsApp", "Clickyy, Jarvis, VS Code, Spotify, Chrome, Notepad, WhatsApp, YouTube.")
    assert not _echoes_prompt("open Spotify", "Clickyy, Spotify")
