from clickyy_speech.wake import WakeMatcher, build_grammar, sensitivity_to_threshold


def result(text, conf):
    return {"text": text, "result": [{"word": w, "conf": conf} for w in text.split()]}


def test_threshold_bounds():
    assert sensitivity_to_threshold(0) == 0.95
    assert sensitivity_to_threshold(1) == 0.40
    assert sensitivity_to_threshold(5) == 0.40
    assert sensitivity_to_threshold(-1) == 0.95


def test_grammar_filters_unknown_words_and_disabled_phrases():
    vocab = {"hey", "click", "e", "jarvis", "quickie"}
    grammar, lookup = build_grammar(["jarvis", "hey_clickyy"], lambda w: w in vocab)
    assert "jarvis" in grammar and "hey jarvis" in grammar
    assert "hey click e" in grammar and "hey quickie" in grammar
    assert "hey clicky" not in grammar  # out-of-vocabulary word
    assert "click e" not in grammar  # 'clickyy' phrase not enabled
    assert grammar[-1] == "[unk]"
    assert lookup["hey quickie"] == "hey_clickyy"


def test_matcher_requires_exact_variant_and_confidence():
    m = WakeMatcher({"jarvis": "jarvis"}, sensitivity=0.5)
    assert m.evaluate(result("[unk]", 1.0), now=0) is None
    assert m.evaluate(result("jarvis", 0.3), now=0) is None
    assert m.evaluate(result("jarvis", 0.9), now=0) == ("jarvis", 0.9)


def test_matcher_cooldown_suppresses_repeats():
    m = WakeMatcher({"jarvis": "jarvis"}, sensitivity=0.5, cooldown_s=2.0)
    assert m.evaluate(result("jarvis", 0.9), now=10.0)
    assert m.evaluate(result("jarvis", 0.9), now=11.0) is None
    assert m.evaluate(result("jarvis", 0.9), now=12.5)


def test_empty_result_is_ignored():
    m = WakeMatcher({"jarvis": "jarvis"})
    assert m.evaluate({"text": ""}, now=0) is None
