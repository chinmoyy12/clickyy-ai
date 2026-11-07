# Test plan and results

All results below were **executed** between 2026-11-03 and 2026-11-07 on Windows 11 Home 10.0.26300, i5-11400H, 15.7 GB RAM, Realtek mic array.

## Automated

| Suite | Command | Result | Kind |
|---|---|---|---|
| TypeScript typecheck | `npm run typecheck` | ✅ clean | static |
| Security lint | `npm run lint` | ✅ 86 files clean | static |
| Vitest (13 files) | `npm test` | ✅ **1,797/1,797** (2026-11-07, v0.5.0) | includes `hindi.test.ts` (Hindi and Hinglish rules plus Whisper's phonetic spellings), `hindi-asr.test.ts` (140 real Whisper Hindi transcripts end to end) and `models.test.ts` (verified model download); unit/integration, mocks for hardware and network; `commands10k.test.ts` routes 1,081 commands sampled evenly from all 191 intent families of the 10,000-command list, plus the Excel, PDF and ZIP writers, loan, row and code parsers, and repeating reminders |
| End to end, **installed via NSIS** (v0.5.0, 2026-11-07) | `node scripts/e2e.mjs "%LOCALAPPDATA%\Programs\Clickyy AI\Clickyy AI.exe"` | ✅ **67/67** | adds always-listening defaults, verified "Clicky" and "Jarvis" wakes through the frozen two-stage detector, Whisper small, and Hindi/Hinglish commands (time, battery, CPU, negation) |
| End to end, **installed via NSIS** (v0.4.0, 2026-11-07) | `node scripts/e2e.mjs "%LOCALAPPDATA%\Programs\Clickyy AI\Clickyy AI.exe"` | ✅ **61/61** | same checks against the silently installed app (product version 0.4.0.0) |
| End to end, dev build (v0.4.0, 2026-11-07) | `npm run e2e` | ✅ **61/61** | adds live Bluetooth status, a CPU diagnostic, app status (File Explorer), files by type, to-do add/list/complete and a real `.xlsx` from the interactive Excel builder; self-test understands all 435 example commands |
| pytest | `services/assistant/.venv/Scripts/python -m pytest tests` | ✅ **57/57** (incl. real Whisper + Kokoro; two-stage wake, verifier spellings and sound-alikes, language choice, model choice, Hindi voice round trip) | real Vosk engine on SAPI-synthesized speech |
| End to end, dev build (v0.3.0, 2026-11-06) | `npm run e2e` | ✅ **55/55** | real app, real Windows APIs; includes the browser question for YT Music, world clock, 1,451 named capabilities, 119 Start-menu apps, the always-listening switch and the in-app self-test (7/7) |
| In-app self-test | say "run a self test" | ✅ **7/7** | understanding of all 253 example commands, Windows bridge, speech engine, a real llama3.2 reply, tools, network, storage |
| **Live local LLM** (installed app) | `node scripts/live-test.mjs local --exe "%LOCALAPPDATA%\Programs\Clickyy AI\Clickyy AI.exe"` | ✅ **6/6** | real llama3.2 via Ollama: streamed answer, follow-up, real tool call, confirmed restart |
| **Live local LLM, Ollama stopped first** (installed v0.2.1, 2026-11-06) | same command, after killing every `ollama` process | ✅ **6/6** | Clickyy started Ollama itself: ready after 6.7 s; first answer 17 s (one-time cold model load from disk, inference 1.5 s), later answers 0.6–1.6 s |
| End to end, packaged `win-unpacked` | `node scripts/e2e.mjs "release\win-unpacked\Clickyy AI.exe"` | ✅ **35/35** | real app |
| End to end, **installed via NSIS** (v0.2.0) | `node scripts/e2e.mjs "%LOCALAPPDATA%\Programs\Clickyy AI\Clickyy AI.exe"` | ✅ **46/46** | real installed app, bundled Whisper + neural voice |

Mocked versus real is kept explicit. Provider adapters (Ollama, Anthropic SDK, OpenAI-compatible) are tested against **mocked HTTP**. Speech recognition and wake detection are tested against the **real engine** with **recorded (synthesized) speech**, not a live human voice.

### Coverage map (spec §14 and 2.0 §9)

| Requirement | Where |
|---|---|
| Wake-word event handling, cooldown, false-positive grammar | `test_wake.py`, `test_server.py`, `voice.test.ts` |
| Speech capture lifecycle, follow-up, timeout, mute | `voice.test.ts` |
| Recognition failure, disconnected mic or service | `voice.test.ts` (error recovery), `test_server.py` (engine unavailable) |
| Offline / online / hybrid routing | `providers.test.ts` (routing policy), `orchestrator.test.ts` |
| API timeout and invalid credentials | `providers.test.ts`, `orchestrator.test.ts` |
| Tool schema validation | `tools.test.ts` |
| App launch allowlist | `tools.test.ts`, e2e |
| URL validation, path traversal, junction escape | `security.test.ts`, `tools.test.ts` |
| Confirmation enforcement, expiry, binding, model-initiated | `tools.test.ts`, `orchestrator.test.ts`, e2e |
| Cancellation, emergency stop | `tools.test.ts`, `orchestrator.test.ts`, `voice.test.ts` |
| Secret redaction and storage | `security.test.ts`, e2e (401 message has no key) |
| Conversation persistence, memory deletion | `storage.test.ts`, e2e |
| IPC authorization and validation | e2e (malformed payload rejected, narrow preload API, no Node in renderer) |
| Settings persistence and repair | `storage.test.ts`, e2e |
| Recovery from a stopped local model | `orchestrator.test.ts` (provider failure → fallback), `providers.test.ts` |
| Command catalog: every example phrasing, ASR variants, compound, ambiguity, malicious | `router.test.ts` (195 cases) |
| Multi-step routine with partial failure | `orchestrator.test.ts` |
| Installer launch and basic functionality | e2e against the installed app |

## Measured performance

These are measurements, not targets.

| Metric | Value |
|---|---|
| Launch to interactive UI | 1.36 s (dev build), 1.87 s (installed) |
| Deterministic commands, round trip through IPC | time 71 ms · disk 11 ms · volume read 26–27 ms · volume set and verify 41–48 ms · audio devices 31–40 ms · CPU 417–434 ms (includes a 400 ms sampling window) · network 238–305 ms · window list 158–332 ms |
| First battery query | 2.66 s (the Windows bridge was still warming up; later bridge calls are 10–40 ms) |
| App launch with window verification (Notepad) | 150 ms–1.6 s |
| Speech recognition | 2.5 s utterance streamed in real time plus 1 s of trailing silence: final transcript after ~3.9 s, i.e. about 0.4 s after the audio ended |
| Memory at idle | Electron (5 processes) 507–526 MB · speech service (Python + Vosk model) 178 MB · Windows bridge 92 MB |
| Idle CPU (window visible) | ~6% of one core total (GPU 3.9%, renderer 1.8%, main 0%) after throttling the idle orb to 15 fps |

## Speech accuracy benchmark

Executed on 2026-11-07, same machine (i5-11400H, int8 on CPU), with `services/assistant/eval`. Synthetic speech isn't a real person, so treat these as a hard, repeatable regression test, not a promise about your voice and room.

**Corpus** (`eval/build_corpus.py`):
- **260 command clips:**
  - 30 English phrases × 4 (every phrase is said at least once by an Indian-accented voice)
  - 20 Hindi phrases × 4
  - 15 Hinglish phrases × 4
- **Voices:**
  - Kokoro: 20 American, British and Hindi
  - Windows: David and Zira
- **Speeds:** 0.9× to 1.15×.
- **Conditions, rotated:**
  - clean
  - steady noise at 15 dB SNR
  - a 6-voice English and Hindi crowd at 10 dB
  - a reverberant room through a laptop mic
  - a quiet speaker (−22 dB)
  - a far, noisy speaker

**Metrics:**
- **Keyword recall:** share of the words that matter (app names, numbers, verbs) that were caught. Matching is fuzzy, and Devanagari is transliterated, so "स्पॉटिफ़ाई" counts as Spotify.
- **All words caught:** share of clips with every keyword caught.
- **WER:** English word error rate.
- **Seconds per sentence:** wall time after the speech ends.

### Recognition (Whisper second pass)

Full corpus (260 clips). These are the models Clickyy can use:

| Model | English keywords | English WER | Hindi keywords | Hinglish keywords | All words caught (en / hi / hinglish) | Seconds per sentence |
|---|---|---|---|---|---|---|
| base.en (0.4.0; English only) | 88.2% | 18.2% | 44.4% | 53.7% | 75.8% / 6.3% / 15.0% | 1.0 |
| **small (0.5.0 default, bundled)** | **91.3%** | **13.6%** | **72.4%** | **61.1%** | 85.8% / 38.8% / 28.3% | **2.1 / 2.6 / 2.8** |

Same 44-clip sample (every sixth clip), including the optional download:

| Model | English | Hindi | Hinglish | Seconds per sentence |
|---|---|---|---|---|
| base.en | 89.2% | 51.1% | 55.9% | 1.1 |
| small | 92.3% | 74.5% | 58.8% | 2.0–2.9 |
| large-v3-turbo (optional download) | **95.4%** | **87.2%** | **94.1%** | 7.5–8 |

Whisper small by condition (keyword recall):

| Condition | English | Hindi | Hinglish |
|---|---|---|---|
| clean | 93.5% | 72.1% | 70.6% |
| steady noise, 15 dB | 86.9% | 82.6% | 73.5% |
| crowd babble, 10 dB | 93.7% | 78.3% | 56.8% |
| echoey room, laptop mic | 94.0% | 83.0% | 67.5% |
| quiet speaker | 95.4% | 80.0% | 70.3% |
| far and noisy | 83.9% | 34.1% | 26.5% |

**Findings and decisions:**
- **Speed:**
  - Whisper always encodes a padded 30-second window, and on this CPU that pass is most of the cost.
  - The stock detect-language-then-transcribe ran it twice (5.6 s). The service now detects from the same encoder output, which halves the time.
  - A single decoding pass with no temperature fallback, a token cap and no 3-gram repeats stop runaway Hindi loops.
- **Language detection:**
  - Hindi is taken for English in 13% of Hindi and Hinglish clips, mostly the far, noisy ones. English is taken for Hindi in 2% of clips.
  - Favouring Hindi (weight 1.5) fixed some detections but did not improve commands end to end (73.5% → 72.7%) and hurt far-field English (84% → 74%), so detection is unbiased (`eval/lang_bias.py`).
- **"English only"** uses base.en: about 1 s per sentence with near-identical English accuracy.
- **large-v3-turbo** clearly wins on Hindi and Hinglish but is about 3× slower than small on this CPU, so it is an optional download, not the default.
- **Far and noisy Hindi** is the weakest case for every model except turbo.

Timings were measured with nothing else running. Accuracy runs: `eval/run_asr.py base-en small` (full) and `eval/run_asr.py base-en small turbo --limit 40` (sample).

### Wake word ("Clicky")

See [WAKE_WORDS.md](WAKE_WORDS.md#measured-synthetic-benchmark-servicesassistanteval) for the table:
- 104 wake clips
- 123 sound-alike clips (quickly, tricky, Vicky, click here, hey Siri…)
- 10 minutes of background talk, for false wakes per hour

### Hindi understanding end to end

`tests/hindi-asr.test.ts` feeds the **real Whisper transcripts** of the 140 Hindi and Hinglish clips through the Hindi layer and the router, and checks each one reaches the same command as the clean sentence. Result: **97/132 (73.5%)**, up from 19/132 (14.4%) before the 0.5.0 spelling repair. Whisper writes Hindi phonetically (आवास for आवाज़, लेब्टाब for लैपटॉप, ब्लुटुत for ब्लूटूथ, or romanized as "Spotify kolo"), and the Hindi layer now snaps each word to the closest known word with a phonetic edit distance. Most remaining misses are far and noisy clips where Whisper wrote unrelated words. The test enforces a floor of 72%.

## Manual acceptance checklist (needs a person)

Use the installed app. Tick each item and note results.

**Voice, with a real microphone**
- [ ] Settings → Listening shows "Vosk ready" with all three wake phrases supported.
- [ ] Push to talk: hold the mic button and say "what time is it". You see a partial transcript, hear a spoken answer, and the mic badge disappears afterwards.
- [ ] Wake word mode: "Jarvis… what's the battery". You hear the chime and an answer. Repeat with "Hey Clickyy" and "Clickyy"; note the hit rate out of 10 for each.
- [ ] False wakes: leave wake mode on for 30 minutes of normal speech or video. Count false triggers.
- [ ] Interruption: ask a long question with a model configured, then say "Jarvis" while it speaks. Speech stops and it listens.
- [ ] Conversation mode: "open spotify" → "play my focus playlist" → "lower the volume to thirty percent" → "that's all".
- [ ] Mute shortcut (Ctrl+Shift+M) closes the mic, and the Windows mic indicator turns off.
- [ ] Unplug a USB mic while listening: an error is shown and the app keeps working with text.

**Voice output**
- [ ] Settings → Voice: preview each profile. Speech speed and pitch change audibly.
- [ ] "speak a little slower" changes the rate, and the setting persists after restart.
- [ ] Stop (Esc) silences speech immediately.

**Models**
- [ ] With Ollama and a model: Strict Offline plus "tell me something interesting" gets an answer while the Wi-Fi adapter is disabled.
- [ ] With an Anthropic key and consent on: "explain black holes simply" shows the "Cloud active" badge and a provider notice.
- [ ] Wrong API key: a clear "key was rejected" message, no crash.
- [ ] With the network unplugged in Online Preferred: falls back to the local model, or explains that it can't.

**Desktop control**
- [ ] "open vs code", "put the browser on the left", "minimize everything", "restore all windows".
- [ ] "close notepad" shows a confirmation naming the window; Cancel leaves it open.
- [ ] Enable the power permission: "restart the pc" shows a red confirmation "Restart in 30 seconds". Cancel. (Optionally approve, then say "cancel shutdown".)
- [ ] Approve a folder, then "find the latest report" and "create a new notes file" (needs a workspace).

**App behavior**
- [ ] Close the window: it goes to the tray. Tray → Quit exits fully, with no python or powershell processes left (check Task Manager).
- [ ] Turn on launch at sign-in, sign out and back in: Clickyy starts hidden in the tray with the mic closed.
- [ ] Keyboard only: Tab through the main screen and Settings with a visible focus ring; the confirmation dialog takes focus.
- [ ] Narrator reads the status line, replies and the confirmation dialog.
- [ ] High contrast, text size 150% and reduced motion all apply immediately.
