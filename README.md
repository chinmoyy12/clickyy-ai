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

### ⬇️ Install

1. **[Download Clickyy-AI-Setup.exe](https://github.com/chinmoyy12/clickyy-ai/releases/latest/download/Clickyy-AI-Setup.exe)** (~175 MB, Windows 11 x64, no admin needed).
2. Run it. This early build isn't code-signed yet, so if SmartScreen appears, click **More info → Run anyway**.
3. Press **Ctrl+Shift+Space** anytime to show Clickyy. Offline voice recognition is included. To add a model, go to Settings → AI & routing.

<p align="center">
  <img src="docs/screenshots/main.png" width="31%" alt="Main window" />
  <img src="docs/screenshots/confirm.png" width="31%" alt="Confirmation dialog" />
  <img src="docs/screenshots/settings-voice.png" width="31%" alt="Voice settings" />
</p>

## What works today (verified on real hardware)

| Area | Verified how |
|---|---|
| Desktop app launches, packaged and installed | `npm run e2e` against the dev build, `release/win-unpacked`, and the NSIS-installed app: **35/35 checks each** |
| Offline speech recognition (Vosk) | Real Vosk engine transcribes recorded speech through the full app path (renderer IPC → main → Python service): final transcript "open notepad" |
| Wake phrases "Hey Clickyy", "Clickyy", "Jarvis" | Detected by the real engine on recorded speech in pytest; "Jarvis" also detected end to end in the running app |
| Offline speech output | Windows voices Zira, David and Mark are available to the app, and an utterance played to completion |
| Microphone capture | Real Realtek microphone array opened and measured from the app (peak level reported) |
| Windows control | Real volume read, set and restore via Core Audio; battery, CPU, RAM, disk, Wi-Fi, audio devices, window list, media session, app launch with window verification |
| Safety | Shell requests refused; power actions blocked until permitted; destructive actions require on-screen confirmation and decline cleanly; unknown apps never launched |
| Strict Offline | Remote hosts are blocked at the network layer (unit-tested); with no local model the app says so honestly |
| Bundled offline voice | The installed app runs the frozen speech engine (no Python needed): recognition and the "Jarvis" wake phrase pass end to end |
| Automated tests | **312 TypeScript tests** (Vitest) + **16 Python tests** (pytest), typecheck, security lint — all passing |

Not verified here: a live local LLM (Ollama and LM Studio aren't installed on the build PC), live cloud calls to any provider (no keys were available; all adapters are tested against mocked HTTP and SDK transports), and a spoken command from a person into the live microphone. See [docs/TEST_PLAN.md](docs/TEST_PLAN.md) for the manual checklist.

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

1. **No local LLM or cloud call was exercised live.** All provider adapters (Ollama, LM Studio-style local servers, Anthropic, and the OpenAI-compatible presets for Gemini, OpenAI, Groq, OpenRouter, Mistral, DeepSeek and xAI) are tested against mocked HTTP and SDK transports, including streaming, incremental tool calls, 401s, timeouts, fallback chains and Strict Offline blocking. Default model names are starting points; providers rename models, so use **Load models** to pick a current one.
2. **Vosk small-model accuracy is modest.** It handles short commands well and long dictation poorly. "Clickyy" is matched through sound-alikes because it isn't in the model's dictionary (see WAKE_WORDS). There is no accent-robustness benchmark yet.
3. **The default voice is a Windows SAPI/OneCore voice (Zira).** It is clear and offline, but not human-quality. Only rate, pitch and volume are adjustable; Windows voices have no emotion tags, and profiles adjust wording plus speed and pitch only. The cloud voice option (OpenAI-compatible `/audio/speech`) is implemented but was not tested live. Piper neural TTS is not integrated yet.
4. **There is no real voice amplitude for Windows voices.** Chromium doesn't expose it, so the orb shows a steady speaking pulse. Cloud audio drives the orb from a real analyser.
5. **Barge-in works only through the wake phrase or the Stop button.** Interrupting by just talking over the assistant isn't implemented, to avoid echo-triggered false stops.
6. **Not implemented:** calendar and email integrations (Phase C), local document RAG and screen understanding (Phase D), clipboard-based "read selected text aloud", workspace layout save/restore, process termination, cost tracking, macOS and Linux.
7. **Spotify playlists:** Clickyy opens Spotify search for the playlist; it can't press play on a specific playlist without the Spotify Web API (not integrated).
8. **The bundled speech engine is English only** (Vosk small en-US). Other languages need a different Vosk model via `CLICKYY_VOSK_MODEL`.
9. **The installer is unsigned.** Windows SmartScreen will warn, and on PCs with Smart App Control enabled it won't run until it is code-signed (see PACKAGING).
