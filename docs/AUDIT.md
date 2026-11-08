# Clickyy engineering audit (v0.5.1)

**Date:** 8 November 2026. **Machine:** the developer's Windows 11 Home laptop (CPU only, no GPU), the same machine the app ships from.
**Scope:** the whole app (Electron main process, renderer, Windows bridge, Python speech service), checked against the product blueprint `CLICKYY_AI_ASSISTANT_FEATURE_BLUEPRINT.txt`.

This report only claims what was checked. "Automated" means a test in the repository exercises it. "Installed e2e" means `scripts/e2e.mjs` drove the installed app. Anything that needs a person, a microphone in a real room, or a paid account is listed separately and is **not** counted as verified.

## Method

1. Baseline: typecheck, lint, 1,797 vitest and 57 pytest before any change (all passing).
2. Cross-checked every IPC channel against its handler and every renderer call against the channel list.
3. Read the audio path end to end (mic → worklet → IPC → speech service → controller → speaker) for races, leaks and hangs.
4. Ran all 70 example commands from blueprint section 17 through the real command router and recorded where each one went.
5. Measured what each cloud model request costs in tool definitions.
6. Reviewed path, URL, network, secret and process-spawning code; ran `npm audit` and listed the Python dependency versions.
7. Fixed what reproduced, added a regression test for each fix (`tests/audit.test.ts`), then reran everything and the installed-app e2e.

## Fixed bugs

| # | Area | Bug (how it showed up) | Fix |
|---|---|---|---|
| 1 | Voice output | **Hindi replies were silent with the neural voice.** Sentence chunking kept only chunks with Latin letters, so every Devanagari sentence was dropped and nothing was spoken. | Keep chunks with a letter or digit in any script; split sentences on "।" too. |
| 2 | Voice output | **Stop could freeze voice control with the cloud voice.** `pause()` fires no `ended` event, so the playback promise never settled and every later voice transition queued behind it forever. | `stop()` now settles the playing cloud reply. |
| 3 | Understanding | **Some English sentences were read as Hinglish.** "Find the latest email from the college" became "open find the test email chrome the" and opened Chrome. Words like "the" (थे), "me" (में) and "do" (दो) counted as evidence of Hindi, and spelling repair then rewrote English words. | Hindi evidence must be a word the user said that is not everyday English. All 438 catalog examples now stay English; the Hindi transcript score is unchanged (97/132). |
| 4 | Commands | 15 of the blueprint's example commands were misrouted or missed. For example: "start a 25-minute focus timer" → "open an app called…"; "repeat that more slowly" → play a song called "that more slowly"; "start a new topic" → open an app; "play Alfaaz" not understood; "turn Bluetooth on" not understood. | Digit-hyphen durations normalised; "turn X on" reordered; new phrases; plain "play X"; routines run by name; file search by words. |
| 5 | Honesty | Smart-home, email and calendar requests fell through to the language model, which has no tool for them and could answer "Done, the lights are off". | They now get a fixed answer saying nothing is connected and nothing was changed, with what Clickyy can do instead (reminders, drafting an email for you to send). |
| 6 | Push-to-talk | Releasing the mouse button off the mic button never ended the utterance, so the mic stayed listening until the timeout. | Pointer capture plus `pointercancel`. |
| 7 | Microphone | Two overlapping `start()` calls could open two streams (one would never be closed, so the Windows mic light stayed on). A `stop()` during device opening, or a worklet load failure, could also leak the stream. | Single shared open; an overtaken open releases its device; failure releases the device. |
| 8 | Speech service | After a restart (installing or removing the Best-accuracy model), the old process's exit event could clear the new process's state and trigger an extra restart. The ready line could also be split across output chunks. | Exit handler only acts for its own process; buffered ready-line parsing. |
| 9 | Model download | "Remove" during a download deleted files while the cancelled download could still be writing them. | Remove waits for the cancelled download to stop. |
| 10 | Tokens | **Every cloud request sent all 108 tool definitions (≈50 KB, ≈13,000 tokens) on every round, even for "tell me a joke".** | Plain questions send no tools; actions send up to 16 relevant ones; the full list only when an action-like request matched no topic. Tools already used in the kept context stay defined (Anthropic rejects a history that refers to undefined tools). |
| 11 | UI | `assistant:newSession`, `reminders:list` and `reminders:cancel` existed but had no button. | "New chat" button; "Upcoming" tab listing reminders, timers and focus sessions with Cancel. |
| 12 | Conversation | The spoken "new topic" reset kept open follow-up questions and remembered references ("open it"). | Same full reset as the New chat button. |
| 13 | Polling | The window polled the model status every 30 s even when hidden, on top of the main process's own 30-second check. | Polls only while visible. |
| 14 | Status | The Status tab always said "Vosk ready" even when Whisper was loaded. | Shows the real engine, for example "vosk + whisper-small ready". |

## Verified working (automated tests and installed e2e on this machine)

- **Text chat**, local model routing, cloud fallback, Strict Offline blocking every non-loopback request.
- **Command router**: 175 command families with 472 example phrases (every example is a test and part of the in-app self-test), multi-step commands ("open Spotify and set the volume to 30"), follow-up questions, clarifying questions for missing details.
- **Wake word "Clicky"** through the frozen two-stage detector, plus Jarvis and Hey Clickyy (installed e2e uses synthetic voices); push-to-talk; click-to-talk; the visible "mic on" badge; barge-in; follow-up listening.
- **Speech**: Vosk partials, Whisper small transcription in English and Hindi, Kokoro neural voice in English and Hindi, the Windows voice fallback.
- **Hindi and Hinglish**: rules plus Whisper spelling repair, 140 real Whisper transcripts end to end.
- **Windows control** through the PowerShell bridge: volume, media keys, windows, battery, CPU, disk, network, settings pages, feature toggles, lock, power actions behind confirmation.
- **Productivity**: timers, reminders (survive restarts), focus sessions, notes, to-do list, Excel workbooks with formulas, code files (saved, never run).
- **Safety**: confirmation cards for risky actions (voice can't approve), refusal of shell or script execution, path checks (approved folders only, junction-safe, protected system paths), memory tools that the model can't call, redaction of secrets in logs and errors, emergency stop.
- **Self-test**: all 7 subsystems, run from the app.

## Remaining bugs and gaps (not fixed)

| Item | Why it's not fixed | Impact |
|---|---|---|
| The network indicator turns off when response headers arrive, not when a streamed cloud answer finishes. | Fixing it means wrapping every response body. Kept the change small. | Cosmetic: the cloud badge can go dark a few seconds early during a long streamed answer. The request is still guarded and reported. |
| "Organise these photos by date" moves them into a subfolder or date-stamps names; it doesn't sort into per-date folders. | Needs a new tool mode. | The reply says what it did. |
| Romanized-Hindi routing is 73.5% on real Whisper transcripts. | Needs real recordings to improve safely. | About 1 in 4 Hindi commands go to the model instead of running directly. |
| **Web answers have no citations.** "Search for X" opens a browser search, and the model answers from general knowledge, saying so. | There's no page-reading or search API integration. | Blueprint P0 item "web search with citations" is **not met**. |
| No microphone selection: the Windows default input is used. | Not built. | Change the default mic in Windows Sound settings. |
| No smart-home, email-reading, calendar, browser automation, screen annotation, speaker recognition, DOCX or PPTX output. | Not built. These requests now get an honest "not connected" answer instead of a model guess. | See the feature matrix. |
| Installer isn't code-signed. | Needs a SignPath account (pending with the user). | SmartScreen warning on install. |
| `.github/` workflows aren't pushed. | Needs `gh auth refresh -s workflow`. | No CI on GitHub yet. |

## Blueprint feature matrix

✅ implemented and tested on this machine · 🟡 partial · ⛔ not implemented · 🧑 needs real hardware or a person to verify

| Blueprint area | Status | Notes |
|---|---|---|
| Wake phrase, push-to-talk, click-to-talk, global hotkey, mute hotkey | ✅ 🧑 | Synthetic-voice tests pass; real-room accuracy needs a person (see WAKE_WORDS.md for the measured numbers). |
| Always-visible mic state, local wake word | ✅ | Badge plus Windows mic indicator; the mic is closed when not listening. |
| STT (local), TTS (local, neural, cloud), language auto-detect EN/HI | ✅ | Cloud STT ⛔. |
| Barge-in, continued conversation, follow-ups, "stop", "repeat", "slower" | ✅ | |
| Conversation history, export, retention, delete | ✅ | |
| Memory with user review, edit, delete, disable | ✅ | Model can't write memory by itself. |
| Dictation into the active app | 🟡 | "Type …" types text; no continuous dictation mode or voice editing. |
| Microphone selection, speaker profiles | ⛔ | |
| Q&A, writing, coding help, translation, tutoring (flashcards) | ✅ | Needs a local or cloud model. |
| Web search with citations, deep research | ⛔ | Opens searches in the browser; no page reading. |
| Screen understanding (user-triggered, asks first, not stored) | ✅ 🧑 | Needs a vision-capable model; captured once per question. |
| Image, PDF and document understanding | 🟡 | Plain-text files and clipboard text; no PDF/DOCX reading. |
| Open, close, focus, arrange apps and windows | ✅ | |
| File search, list, create, move, organise (approved folders) | ✅ | Trash instead of delete; duplicates read-only. |
| Clipboard, keyboard shortcuts, typing | ✅ | Clipboard needs its permission. |
| Volume, brightness, Wi-Fi, Bluetooth, 35 features, power, lock | ✅ 🧑 | Power and lock actions are confirmed first. |
| Screen annotation, guided overlays, browser automation, form filling | ⛔ | |
| Timers, reminders (recurring, snooze), focus, stopwatch, notes, to-dos, shopping list | ✅ | |
| Calendar, email reading and sending, messaging | 🟡 | Drafts open in your mail app or WhatsApp for you to send; no inbox or calendar access. |
| TXT, Markdown, code files, PDF (notes), XLSX, CSV, ZIP | ✅ | DOCX and PPTX ⛔. |
| Music: Spotify and YouTube Music search, media keys, now playing, local files | ✅ 🧑 | Playlist editing ⛔ (needs Spotify API). |
| Smart home | ⛔ | Honest "not connected" answer; locks stay blocked. |
| Agent tasks | 🟡 | Model tool loop (6 rounds max) with confirmations, cancel, activity log; no visible plan or approval step before it starts. |
| Routines | ✅ | Run by phrase or by name; validated steps; preview. |
| Offline mode | ✅ | Strict Offline blocks all remote hosts; local commands, speech and voice work without a network. |
| Privacy: no hidden capture, confirmations, audit log, encrypted keys | ✅ | Keys are encrypted with Windows DPAPI (Electron safeStorage), not in Credential Manager. |

## External dependencies

- **Ollama** (optional, local model): started automatically if installed. Without it, open questions need a cloud key.
- **Speech models** (bundled, 1.1 GB): Vosk small-en, Whisper small and base.en, Kokoro v1.0 int8. Optional download: Whisper large-v3-turbo (1.6 GB, pinned revision, SHA-256 checked).
- **Windows PowerShell 5.1** for the bridge; **Spotify** or a browser for music; the default browser for websites.
- **Open-Meteo** for weather (free, no key), **Frankfurter** for exchange rates and **ipify** for the public IP check, all blocked in Strict Offline.

## Features that need real hardware or a person

- Wake-word and recognition accuracy in a real room, with real accents and background noise (all automated numbers use synthetic voices).
- Barge-in with real speakers and echo cancellation.
- Brightness (laptop panel), Bluetooth and Wi-Fi radios, battery alerts, monitor-off and sleep.
- Spotify playback (needs the app and an account), screen questions (need a vision model).

## Features that need paid services

- Cloud language models (Anthropic, OpenAI, Gemini, Groq, OpenRouter, any OpenAI-compatible endpoint): open questions, better tool use, screen questions without a local vision model.
- Cloud voice (OpenAI-compatible text-to-speech).
- Code signing (SignPath or a certificate).

Everything else runs for free on the PC.

## Performance

- Whisper small: 2.0–2.9 s per sentence on this CPU (single encode for language detection plus transcription, measured in 0.5.0).
- Tool payload for cloud questions cut from ≈13,000 tokens to 0, and for actions to ≤16 definitions (under a quarter of the full payload, enforced by a test).
- Background polling: the hidden window no longer polls model status.
- No new background processes. The resident processes are the app, the speech service and the PowerShell bridge, plus Ollama only if you installed it.

## Token consumption

- **Biggest saving:** tool definitions (above). On a 6-round agent turn that was up to 78,000 input tokens of definitions alone.
- Context is kept to the last N turns (Settings → AI, default 12); tool results are truncated to 4,000 characters; memories are capped at 30 in the system prompt.
- Deterministic commands (most everyday requests) never call a model.

## Security audit

| Check | Result |
|---|---|
| Renderer isolation | `contextIsolation`, `sandbox`, no Node in renderer, CSP `default-src 'self'`, navigation and new windows blocked, webviews blocked. |
| IPC | Every channel zod-validated, sender origin checked, unknown channels have no handler, errors redacted; audio frames size-checked. |
| Shell execution | None from the model or from commands; fixed PowerShell operations only, arguments validated twice. |
| Paths | Approved folders only, symlink and junction resolution, protected system paths, UNC rejected, reserved names rejected. |
| Network | One guarded fetch; Strict Offline enforced for every remote host including model downloads; speech service on 127.0.0.1 with a per-launch 48-hex token compared in constant time. |
| Secrets | Encrypted at rest with DPAPI; redacted from logs, errors and stored history; never sent to the renderer. |
| Prompt injection | Screen, clipboard and web text are labelled as data; memory tools excluded from the model; risky tools need a click (voice can't approve). |
| Downloads | Pinned revision, size and SHA-256 per file, staged then renamed. |
| Dependencies | `npm audit --omit=dev`: **0 vulnerabilities** in shipped packages. 6 moderate in build-only tooling (electron-builder → minimatch), not in the installer. Python: fastapi 0.162, starlette 1.10, uvicorn 0.54, websockets 17.4 (current). |
| Not addressed | Installer unsigned; history export writes plain JSON where you choose. |

## Test results after the fixes

| Suite | Result |
|---|---|
| Typecheck, security lint | ✅ clean (87 files) |
| Vitest | ✅ **1,887 / 1,887** (adds 56 audit regression tests) |
| Pytest | ✅ **57 / 57** (speech service unchanged) |
| Installed e2e (v0.5.1, NSIS install) | ✅ **72 / 72** (adds 5 audit checks: smart-home honesty, English not misread as Hinglish, 25-minute focus timer, shopping list, feet-and-inches) |
| In-app self-test | ✅ 7 / 7 subsystems, all 472 example commands understood |

One bug was caught by these runs and fixed before release: "5 feet 8 inches to centimetres" answered in metres, because "centimetres" contains "met". It came from this audit's own new command, not from 0.5.0.
