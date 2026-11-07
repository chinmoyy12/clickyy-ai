# Wake phrases ("Clicky", "Hey Clicky", "Jarvis")

Clickyy listens for its name all the time when wake-word mode is on, which is the default since 0.5.0. Everything runs on the PC:

- The "mic on" badge is shown the whole time.
- Audio is never stored or sent anywhere.
- You can turn it off with the mute button, the shortcut, or Settings › Voice › Listening mode.

## How detection works: two stages

1. **Spotting (Vosk, always on, cheap).** A Vosk recognizer runs with its grammar restricted to the wake phrases plus `[unk]`, which absorbs all other speech.
   - The small English model has no word "clicky", so it listens for in-vocabulary sound-alikes such as `click e`, `click key` and `quickie`. They are listed in `services/assistant/clickyy_speech/wake.py`.
   - A candidate must start the utterance. Up to two lead-in words are allowed before it (`hey`, `hi`, `okay`, `hello`, or a breath), so "Okay Clicky, open Spotify" works.
   - "I'll click it later" does not trigger, because the wake word is mid-sentence.
   - The candidate's word confidence must clear `0.95 − 0.55 × sensitivity`, minus 0.3 when the verifier is on, since stage one can afford to be permissive.
2. **Verification (Whisper base.en, only on candidates).** The exact audio of the candidate word (±0.35 s) is re-read by Whisper.
   - Clickyy wakes only if Whisper really heard "Clicky" (any spelling, including Devanagari क्लिकी) or "Jarvis".
   - Everyday look-alikes are rejected explicitly: quickly, clicking, tricky, sticky, picky, Vicky, cookie, and others (`verify.py`).
   - At sensitivity below 40% the verifier runs **without** its "Clicky" prompt. This is a strict mode that almost never wakes by mistake.

**One breath:** if you keep talking after the wake word ("Clicky, set the volume to 30 percent"), the rest of the sentence is transcribed (English or Hindi) and run straight away, like a smart speaker. You don't have to wait for the chime.

## Measured (synthetic benchmark, `services/assistant/eval`)

The test set is built like this:
- **104 wake clips:** "Clicky", "Hey/Hi/Okay Clicky", with commands, and Hindi "क्लिकी", "हे क्लिकी", "ओके क्लिकी".
- **123 sound-alike clips:** quickly, tricky, Vicky, click here, hey Siri, and others.
- **10 minutes of unrelated English and Hindi talk.**
- **Voices:** 20+ (American, British, Indian-accented, Hindi, and the Windows voices).
- **Conditions:** clean, steady noise at 15 dB, crowd babble at 10 dB, a reverberant room through a laptop mic, a quiet speaker, and a far, noisy speaker.

| Setup | Wakes caught | Sound-alikes accepted | False wakes per hour of talk |
|---|---|---|---|
| 0.4.0 (Vosk only, exact match) | 45.2% | 9.8% | 12 |
| 0.5.0 stage one only (verifier off) | 93.3% | 15.4% | 48 |
| **0.5.0 default (verified, sensitivity 0.7)** | **86.5%** | **3.3%** | **6** |
| 0.5.0 strict (sensitivity < 0.4) | 69.2% | 0% | 0 |
| Whisper small as verifier (not used: 3× slower) | 94.2% | 6.5% | 24 |

Stage one alone catches the most, but it would wake about once every 75 seconds of conversation. The verifier trades 7 points of recall for 8× fewer false wakes. Most remaining misses are in the hardest conditions (crowd babble at 10 dB, far and noisy). Reproduce with:

```
cd services/assistant
.venv\Scripts\python -I eval\build_corpus.py
.venv\Scripts\python -I eval\run_wake.py --sens 0.5 0.7 --verify off on noprompt
.venv\Scripts\python -I eval\diag_wake.py          # what each stage heard on every miss
```

**Honest caveat:** synthetic voices are not people. Real rooms, microphones and accents will differ. Treat these numbers as a hard, repeatable regression test, not a promise. Use the manual checklist in TEST_PLAN.md with your own voice.

## Tuning

- **Wakes too rarely:** raise sensitivity, say "Hey Clicky" (two words are easier than one), or speak closer to the mic.
- **Wakes by mistake:** lower sensitivity below 40% (strict mode), or turn off the bare "Clicky" phrase and keep "Hey Clicky".
- "Jarvis" is a dictionary word and is the most reliable of the three.
- For the next step up, train a dedicated keyword model (for example openWakeWord; check the licence) on recordings of real voices. `Session` in `engine.py` is the integration point.
