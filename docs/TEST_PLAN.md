# Test plan and results

All results below were **executed** on 2026-11-03 on Windows 11 Home 10.0.26300, i5-11400H, 15.7 GB RAM, Realtek mic array.

## Automated

| Suite | Command | Result | Kind |
|---|---|---|---|
| TypeScript typecheck | `npm run typecheck` | ✅ clean | static |
| Security lint | `npm run lint` | ✅ 60 files clean | static |
| Vitest (8 files) | `npm test` | ✅ **380/380** | unit/integration, mocks for hardware and network |
| pytest | `services/assistant/.venv/Scripts/python -m pytest tests` | ✅ **25/25** (incl. real Whisper + Kokoro) | real Vosk engine on SAPI-synthesized speech |
| End to end, dev build | `npm run e2e` | ✅ **46/46** | real app, real Windows APIs |
| **Live local LLM** (installed app) | `node scripts/live-test.mjs local --exe "%LOCALAPPDATA%\Programs\Clickyy AI\Clickyy AI.exe"` | ✅ **6/6** | real llama3.2 via Ollama: streamed answer, follow-up, real tool call, confirmed restart |
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
