<p align="center">
  <img src="assets/banner.svg" alt="Clickyy AI — your AI that listens, speaks and runs your PC" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/chinmoyy12/clickyy-ai/releases/latest/download/Clickyy-AI-Setup.exe"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows%2011%20x64-d4a373?style=for-the-badge&logo=windows11&logoColor=101114&labelColor=f3d7b4" /></a>
  &nbsp;
  <a href="https://chinmoyy12.github.io/clickyy-ai/"><img alt="Website" src="https://img.shields.io/badge/Website-3D%20tour-8ed8e8?style=for-the-badge&labelColor=101114" /></a>
</p>

<p align="center">
  <img alt="tests" src="https://img.shields.io/badge/tests-312%20TS%20%2B%2016%20Python%20passing-8fcb9b?style=flat-square&labelColor=191b20" />
  <img alt="e2e" src="https://img.shields.io/badge/e2e%20on%20installed%20app-35%2F35-8fcb9b?style=flat-square&labelColor=191b20" />
  <img alt="offline" src="https://img.shields.io/badge/voice-100%25%20offline-d4a373?style=flat-square&labelColor=191b20" />
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%2011-969aa3?style=flat-square&labelColor=191b20" />
</p>

**Clickyy** is a privacy-conscious voice assistant and supervised desktop agent for Windows 11. Say *“Hey Clickyy”* or *“Jarvis”*. It listens on-device, answers with a natural voice, runs your PC through validated tools, and thinks with **any model you choose**:

| Brain | How |
|---|---|
| **Claude** (Anthropic) | official SDK, streaming, tool calling |
| **Gemini** (Google), **GPT** (OpenAI), **Grok** (xAI), **Mistral**, **DeepSeek** | documented OpenAI-compatible endpoints, streaming, tool calling |
| **Llama, Qwen, Kimi…** on **Groq**, or **300+ models via OpenRouter** | same adapter: pick from the provider's live model list |
| **100% local**: **Ollama**, **LM Studio**, **llama.cpp**, **vLLM** | loopback only, works in Strict Offline mode |

Set a primary provider, a fallback provider and a local fallback. If one fails, Clickyy moves on to the next.

### ✨ New in 0.2 — the "Jarvis" update

| | |
|---|---|
| 🗣️ **Neural voice, offline** | Kokoro-82M runs on your CPU with 28 English voices: warm American (Heart, Bella, Nova) and British (Emma, Isabella, Lily). It speaks sentence by sentence as the next one is prepared, and the orb pulses with the real voice. |
| 🎧 **Near-perfect understanding** | Whisper re-reads each command after you finish speaking (about 0.6 s), on top of Vosk's instant live captions. Misheard app names ("spotfy", "crome") are fuzzy-matched. |
| ✋ **Interrupt by talking** | Optional barge-in: start speaking while Clickyy talks and it stops to listen (echo-cancelled). |
| 🌅 **Morning briefing** | "Brief me": time, weather, battery and today's reminders in one reply. |
| 🩺 **System report** | "How's my computer doing?": CPU, memory, battery, disk and network, with a warning when something's off. |
| 🌦️ **Weather** | "Do I need an umbrella?" via Open-Meteo. Free, no account. |
| 🧮 **Calculator & conversions** | "What's 15 percent of 240?", "convert 5 miles to km". Offline, with a real parser (no `eval`). |
| 👁️ **Screen vision** | "What's on my screen?": one screenshot, only after you confirm, sent to a vision model (Gemini, Claude, GPT). Never stored. |
| 📋 **Clipboard AI** | "Summarize / translate / proofread what I copied". |
| 🔔 **Proactive alerts** | Speaks up when the battery runs low or the CPU stays pegged. |
| 🎩 **Butler persona** | Composed, impeccably polite, dry wit. One of ten personalities. |
| 🧠 **Better local AI** | Small local models get only the relevant tools, fall back from GPU to CPU automatically when a GPU driver faults, and stay warm, so llama3.2 answers in about 1.2 s. |

### ⬇️ Install

1. **[Download Clickyy-AI-Setup.exe](https://github.com/chinmoyy12/clickyy-ai/releases/latest/download/Clickyy-AI-Setup.exe)** (~440 MB, Windows 11 x64, no admin needed). Offline speech recognition and the neural voice are included.
2. Run it. This build isn't code-signed yet, so if SmartScreen appears, click **More info → Run anyway**.
3. Press **Ctrl+Shift+Space** anytime to show Clickyy. For conversation, install [Ollama](https://ollama.com) and run `ollama pull llama3.2`, or add a cloud key in Settings → Credentials. You don't need to keep Ollama running: Clickyy starts it when needed, and uses any installed model if the configured one is missing.

<p align="center">
  <img src="docs/screenshots/main.png" width="31%" alt="Main window" />
  <img src="docs/screenshots/confirm.png" width="31%" alt="Confirmation dialog" />
  <img src="docs/screenshots/settings-voice.png" width="31%" alt="Voice settings" />
</p>

## What works today (verified on real hardware)

| Area | Verified how |
|---|---|
| Desktop app launches, packaged and installed | `npm run e2e` against the dev build and the NSIS-installed v0.2.0 app: **46/46 checks each** |
| **Live local AI** | `node scripts/live-test.mjs local` against the installed app with a real **llama3.2** on Ollama: streamed answer (about 1.2 s), contextual follow-up, a real tool call that changed the volume, and a model-proposed restart stopped at the confirmation. **6/6** |
| Neural voice + Whisper | Kokoro synthesizes through the app's IPC (about 1–1.7 s per sentence on this CPU); Whisper refines recorded speech to "set the volume to thirty percent"; a round-trip test has Kokoro speak and Whisper understand it |
| Offline speech recognition (Vosk) | Real Vosk engine transcribes recorded speech through the full app path (renderer IPC → main → Python service): final transcript "open notepad" |
| Wake phrases "Hey Clickyy", "Clickyy", "Jarvis" | Detected by the real engine on recorded speech in pytest; "Jarvis" also detected end to end in the running app |
| Offline speech output | Windows voices Zira, David and Mark are available to the app, and an utterance played to completion |
| Microphone capture | Real Realtek microphone array opened and measured from the app (peak level reported) |
| Windows control | Real volume read, set and restore via Core Audio; battery, CPU, RAM, disk, Wi-Fi, audio devices, window list, media session, app launch with window verification |
| Safety | Shell requests refused; power actions blocked until permitted; destructive actions require on-screen confirmation and decline cleanly; unknown apps never launched |
| Strict Offline | Remote hosts are blocked at the network layer (unit-tested); with no local model the app says so honestly |
| Bundled offline voice | The installed app runs the frozen speech engine (no Python needed): recognition and the "Jarvis" wake phrase pass end to end |
| Automated tests | **384 TypeScript tests** (Vitest) + **25 Python tests** (pytest, real Vosk, Whisper and Kokoro engines), typecheck, security lint — all passing |

Not yet verified: a live cloud call (pending an API key; every cloud adapter is tested against mocked HTTP and SDK transports, and `node scripts/live-test.mjs cloud --provider gemini` runs the same 6 live checks once a key is saved), and a spoken command from a person into the live microphone. See [docs/TEST_PLAN.md](docs/TEST_PLAN.md) for the manual checklist.

## Quick start (development)

```bash
cd apps/desktop
npm install
npm run build
npm start
```

Optional offline voice input (Python 3.10+, downloads ~40 MB):

```bash
powershell -ExecutionPolicy Bypass -File scripts/setup-speech.ps1
```

Run every check:

```bash
cd apps/desktop
npm run check
npm run e2e
```

Build the Windows installer (`apps/desktop/release/Clickyy-AI-Setup-0.1.0.exe`):

```bash
cd apps/desktop
npm run dist
```

Full setup, troubleshooting, Smart App Control notes and installed-app speech setup: [docs/SETUP.md](docs/SETUP.md).

## Using Clickyy

- **Type** in the box or press the **mic** button (push to talk). Switch to **Wake word** or **Conversation** mode in Settings → Listening.
- **Esc** stops everything. **Ctrl+Shift+Space** shows or hides the window. **Ctrl+Shift+M** mutes the microphone. The tray icon has **Emergency stop** and **Quit**.
- Try: "set volume to thirty percent", "open spotify and put it on the left", "start a 25 minute focus session", "remind me to stretch in 20 minutes", "what's using my memory", "remember that my project is called Atlas", "switch to work mode".
- Create **routines** in Settings → Routines, e.g. "coding mode" → open VS Code, open workspace, volume 20%, focus timer.
- To enable open-ended conversation, either install [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) and load a model, or add a key for Anthropic, Google Gemini, OpenAI, Groq, OpenRouter, Mistral, DeepSeek or xAI in Settings → Credentials. Then allow cloud use in Settings → AI & routing and click **Load models** to pick from the provider's live list.

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Process model, module boundaries, dependency decisions, data flow |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, privacy model, tool risk levels, what is stored where |
| [docs/CAPABILITIES.md](docs/CAPABILITIES.md) | Offline vs online capability matrix, voice provider compatibility matrix |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Generated command catalog and tool registry |
| [docs/SETUP.md](docs/SETUP.md) | Setup, model downloads, API keys, troubleshooting |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Automated test coverage, measured results, manual acceptance checklist |
| [docs/WAKE_WORDS.md](docs/WAKE_WORDS.md) | How wake phrases work, accuracy notes, tuning |
| [docs/SPEECH_PROTOCOL.md](docs/SPEECH_PROTOCOL.md) | Loopback protocol between the app and the speech service |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Installer build, code signing, distribution |
| [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) | External downloads, API keys, licenses, optional integrations |

## Repository layout

```
apps/desktop/            Electron + React + TypeScript app
  src/main/              main process: assistant core, tools, providers, storage, security, Windows bridge client
  src/preload/           minimal contextBridge API
  src/renderer/          UI, mic capture, TTS playback, voice interaction controller
  src/shared/            settings schema, IPC contract, shared types, voice profiles
  resources/windows/     bridge.ps1 (fixed allowlist of Windows operations)
  tests/                 Vitest suites
  scripts/               build, dev, e2e, security lint, docs generator
services/assistant/      Python speech service (FastAPI + Vosk), pytest suite
scripts/                 setup-speech.ps1, build-speech.ps1 (freeze for installer), make-speech-fixtures.ps1, make-icon.ps1
site/                    3D animated landing page (three.js), published to GitHub Pages
assets/                  animated README banner
docs/
```

To build the installer with offline voice bundled:

```bash
powershell -ExecutionPolicy Bypass -File scripts/setup-speech.ps1
```

```bash
powershell -ExecutionPolicy Bypass -File scripts/build-speech.ps1
```

```bash
cd apps/desktop && npm run dist
```

## Known limitations

These are honest gaps, not hidden ones.

1. **Cloud providers haven't been called live yet.** The Anthropic adapter and the OpenAI-compatible presets (Gemini, OpenAI, Groq, OpenRouter, Mistral, DeepSeek, xAI) are tested against mocked transports. The local path *is* verified live with llama3.2. Default model names are starting points; use **Load models** to pick a current one.
2. **Small local models are less capable than cloud ones.** llama3.2 (3B) handles questions and single actions well. Multi-step agent tasks work better with a cloud model or a larger local one.
3. **Wake words still use Vosk's small model.** "Jarvis" is the most reliable phrase; "Clickyy" is matched through sound-alikes. Commands themselves are transcribed by Whisper. There is no accent-robustness benchmark yet.
4. **The neural voice is CPU-bound.** About 1–1.7 s to the first sentence on an i5-11400H; slower PCs can switch to the Windows voice. Profiles adjust wording plus speed (and pitch on Windows voices); Kokoro has no emotion tags.
5. **Barge-in by talking needs reasonable echo cancellation.** Headphones are best. On loud speakers Clickyy may hear itself, so it's off by default.
6. **Not implemented:** calendar and email (needs OAuth integrations), document search over your files (RAG), workspace layout save/restore, process termination, cost tracking, macOS and Linux.
7. **Spotify playlists:** Clickyy opens Spotify search for the playlist; it can't press play on a specific playlist without the Spotify Web API (not integrated).
8. **The bundled speech engine is English only** (Vosk small en-US). Other languages need a different Vosk model via `CLICKYY_VOSK_MODEL`.
9. **Code signing is pending SignPath approval.** The release workflow signs every executable and the installer automatically once the SignPath secrets are added ([docs/SIGNING.md](docs/SIGNING.md)). Until then, Windows SmartScreen warns on first run, and PCs with Smart App Control enabled block the app.
