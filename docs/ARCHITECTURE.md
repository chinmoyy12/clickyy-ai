# Clickyy AI — Architecture

## 1. Environment baseline (recorded 2026-11-03)

| Item | Value |
|---|---|
| OS | Windows 11 Home Single Language 10.0.26300 |
| CPU / RAM | Intel i5-11400H, 15.7 GB |
| Node.js / npm | 24.20.0 / 11.19.0 |
| Python | 3.12.10 (venv in `services/assistant/.venv`) |
| Electron | 45.2.1 |
| Speech (OS) | SAPI recognizer `MS-1033-80-DESK` (en-US); voices Microsoft Zira (F) and David (M) |
| Local LLM | None installed (Ollama absent) |
| Microphone | Realtek Microphone Array |

**Smart App Control:** it was on at first and blocked unsigned binaries: `electron.exe`, Rolldown's native binding, the Vosk/cffi DLL, `pydantic-core`, and locally compiled executables. The user turned it off on 2026-11-03 so we could use the Electron stack. A machine that has SAC on will block an unsigned Clickyy build. Distributing the app therefore needs Authenticode signing (see `docs/PACKAGING.md`).

## 2. Process model

```
┌──────────────────────── Electron ────────────────────────┐
│ Renderer (React, sandboxed, contextIsolation, CSP)        │
│   • UI, voice orb, settings                               │
│   • Mic capture (getUserMedia → AudioWorklet → 16 kHz PCM)│
│   • Local TTS playback (Windows voices via speechSynthesis)│
│        │ window.clickyy.* (preload, typed + validated)    │
│ Main process (Node)                                        │
│   • IPC router (zod-validated, sender-origin checked)     │
│   • Assistant core: session → router → orchestrator       │
│   • Tool registry + executor (policy, confirm, audit)     │
│   • Providers: Ollama / Anthropic / OpenAI-compatible     │
│   • Network guard (Strict Offline enforcement)            │
│   • Storage: SQLite (sql.js/WASM) + safeStorage secrets   │
│   • Scheduler (reminders, timers, focus)                  │
│   • Windows bridge ─────► powershell.exe bridge.ps1       │
│   • Speech service supervisor ─► python speech service    │
└───────────────────────────────────────────────────────────┘
        loopback WS (127.0.0.1, random port, bearer token)
┌──────────── services/assistant (Python, optional) ───────┐
│ FastAPI: /health, /ws/stt (Vosk wake grammar + dictation)│
└───────────────────────────────────────────────────────────┘
```

The app launches and works without the Python service: you can type commands, and the app reports that voice input is in degraded mode. If no LLM is configured, deterministic commands still work.

## 3. Module boundaries (`apps/desktop/src`)

| Module | Responsibility | Must not |
|---|---|---|
| `shared/` | IPC contract, zod schemas, settings schema, DTO types | import Node or DOM APIs |
| `main/storage` | SQLite migrations, repositories, backups | know about UI |
| `main/security` | secret store, redaction, URL and path validation | — |
| `main/tools` | tool definitions, registry, executor, confirmation broker | call LLMs |
| `main/windows` | PowerShell bridge with fixed allowlisted ops | accept free-form commands |
| `main/assistant` | command catalog, deterministic router, session context, orchestrator, agent runner, speech-style formatter | touch the OS directly (only through tools) |
| `main/providers` | LLM and TTS adapters, network guard | execute tools |
| `main/speech` | Python service supervisor + STT client | — |
| `preload/` | minimal `contextBridge` API | expose `ipcRenderer` |
| `renderer/` | UI and audio I/O | access Node or the filesystem |

## 4. Key dependency decisions

| Need | Choice | Why |
|---|---|---|
| Desktop shell | Electron 45 | per spec, mature security model |
| UI | React 19 + TypeScript + Vite 8 + Tailwind 4 + framer-motion + lucide-react | per spec |
| SQLite | **sql.js** (WASM) | no native rebuild against the Electron ABI; DB is small; written atomically |
| Validation | zod 4 | shared between main and renderer |
| Secrets | Electron `safeStorage` (DPAPI on Windows) | OS-backed, no native module |
| Windows APIs | persistent `powershell.exe` running a bundled script with a fixed op allowlist; Core Audio and user32 accessed through `Add-Type` | no unsigned helper exe; ops are an enum, args are typed and range-checked |
| Offline STT + wake | **Vosk** (Apache-2.0) small en-US model (40 MB) with grammar-restricted recognizer for wake phrases | real streaming partials, offline, small, permissive license |
| Offline TTS | Windows voices (SAPI/OneCore) through Chromium `speechSynthesis` | offline, no download, feminine voice (Zira) available |
| Cloud TTS (optional) | OpenAI-compatible `/v1/audio/speech` | documented API |
| Local LLM | Ollama HTTP API (`127.0.0.1:11434`) | most common local runtime; detected, not required |
| Cloud LLM | Anthropic Messages API (default), OpenAI-compatible chat completions | documented tool calling |
| Tests | Vitest (TS), pytest (Python) | — |
| Packaging | electron-builder NSIS | maintained |

## 5. Request flow

1. **Input**: the user either types, or speaks. With voice, the renderer `VoiceController` (a single-session state machine) opens the mic, streams 100 ms PCM frames over IPC, and receives `partial`, `final` and `wake` events from the speech service.
2. **`Assistant.submit()`** (main): it cancels any in-flight turn, persists the message (if history is on), then calls `route()`.
3. **`route()`** normalizes the text (wake prefix, politeness, spoken numbers, ASR fixes) and matches the ordered **command catalog** (70 commands). It splits compound commands only when every clause is a command, fills pending clarification slots, and matches user **routines**.
4. **Deterministic hit**: the matched command goes to `ToolExecutor.execute()` and the result becomes a spoken reply. No model is involved, so this works offline.
5. **No hit**: `ProviderManager.candidates()` orders providers by policy and consent. The LLM loop runs for at most 6 rounds; each model tool call goes through the same executor with `origin: 'llm'`, which forces confirmation for L2 and L3. On provider failure, the partial exchange is discarded and the next provider is tried. With no provider, Clickyy replies honestly.
6. **Reply**: the main process sends the `{text, speech, style}` event, and the renderer speaks it (Windows voice or cloud audio) using profile- and style-adjusted prosody. The controller then decides between follow-up listening and returning to rest.

## 6. Threat model (summary — full model in `SECURITY.md`)

| Asset | Threat | Mitigation |
|---|---|---|
| OS control | LLM or webpage prompt injection causing harmful actions | LLM can only *request* registered tools; schemas validated; risk levels; L2/L3 need a UI confirmation token bound to the exact action; no shell tool |
| Files | path traversal, reading secrets | approved-root allowlist, `realpath` boundary checks, protected-path denylist, no recursive whole-disk scan |
| API keys | leakage to renderer or logs | keys live only in main (safeStorage); renderer sees `hasKey: boolean`; log redaction |
| Microphone | covert recording | capture only in visible listening states; audio never persisted; never sent to the cloud (cloud STT not implemented); emergency mute |
| Network | silent cloud use in Strict Offline | every outbound request goes through `netGuard`, which rejects non-loopback hosts in strict mode; the UI shows when the cloud is in use |
| IPC | compromised renderer | `sandbox`, `contextIsolation`, no `nodeIntegration`, CSP, sender URL checks, zod on every channel |
| Process launching | arbitrary exe | app registry with validated absolute paths or detected installs; unknown exe needs confirmation; `spawn` with arg arrays and `shell:false` |
