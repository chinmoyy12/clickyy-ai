# Wake phrases

## How detection works

When wake-word mode is on, the speech service runs a Vosk recognizer whose **grammar is restricted** to the enabled wake phrases plus `[unk]`, which absorbs all other speech. A detection fires only when:

1. Vosk emits a **final** result (endpointed utterance) whose text is **exactly** one of the phrase variants;
2. the mean word confidence is at least `0.95 − 0.55 × sensitivity` (sensitivity 0 → 0.95, 1 → 0.40); and
3. the **cooldown** since the last detection has elapsed (default 2 s).

Everything runs locally. Audio isn't stored.

## Phrase variants

The small English model's dictionary has no entry for "clicky", so Clickyy matches in-vocabulary sound-alikes (`services/assistant/clickyy_speech/wake.py`):

| Phrase | Variants |
|---|---|
| Hey Clickyy | hey click e · hey click key · hey quickie · hey clique e |
| Clickyy | click e · click key · quickie · clique e |
| Jarvis | jarvis · hey jarvis |

At startup the service drops any variant containing out-of-vocabulary words and reports per-phrase support in `/health`, which the UI shows next to each toggle.

## Measured

- pytest, real engine on SAPI-synthesized speech: "hey jarvis", "hey clicky" and "clicky" are detected; a 12-word unrelated sentence is not.
- In the running app (e2e): "hey jarvis" was detected with confidence 1.0.

These tests used **synthesized** speech. Real-voice hit rates and false-trigger rates haven't been measured yet; use the manual checklist in TEST_PLAN.md.

## Expectations and tuning

- "Jarvis" is a distinctive dictionary word and should be the most reliable.
- "Clickyy" variants are short and generic ("quickie", "click e"), so they are more prone to false triggers in noisy rooms. Raise strictness (lower sensitivity) or disable the bare "Clickyy" phrase if needed.
- For production-grade wake detection, train a dedicated keyword model (for example openWakeWord or Porcupine; check their licenses). The `Session` class in `engine.py` is the integration point.
