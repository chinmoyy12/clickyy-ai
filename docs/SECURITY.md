# Security & privacy

Clickyy treats every model response, transcript, web page, file name, window title and tool result as **untrusted input**. The model can only *request* registered tools; the main process decides whether, and how, anything happens.

## Trust boundaries

| Boundary | Enforcement (file) |
|---|---|
| Renderer ↔ main | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, custom `app://` protocol with strict CSP (`main.ts`); preload exposes only `invoke`, `on`, `sendAudio`, `ttsState` (`preload.ts`); every channel has a zod schema and a sender check (`ipc.ts`, `shared/ipc.ts`). Navigation, `window.open` and webviews are blocked. Permission requests are granted only for **audio** capture from the app origin. |
| Model → OS | `ToolExecutor` (`tools/executor.ts`): validate → permission → confirmation → run with timeout and abort → audit. Unknown tools are rejected. There is **no shell tool**; the security lint (`scripts/lint.mjs`) fails the build on `exec(`, `shell: true`, `eval`, `Invoke-Expression`, etc. |
| Main → Windows | `bridge.ps1` accepts only a fixed `switch` of operations; arguments are range-checked in TypeScript and again in PowerShell; key combinations come from a fixed allowlist; text typing escapes SendKeys metacharacters. Processes are started with `spawn(file, args, { shell: false })`. |
| Main → network | `NetGuard` (`security/netGuard.ts`) wraps every outbound fetch (Ollama, Anthropic SDK via its `fetch` option, OpenAI-compatible, cloud TTS). In Strict Offline only loopback hosts are reachable. Remote requests are reported to the UI ("Cloud active" badge plus a notice naming the provider). |
| Main ↔ speech service | Bound to `127.0.0.1`, random port, per-launch 48-hex-char bearer token, frame size limits, pydantic validation (`services/assistant/clickyy_speech/server.py`). |

## Tool risk levels

| Level | Examples | Policy |
|---|---|---|
| **L1 low** | status queries, volume, media, open approved app or URL, timers, lock screen | Runs when its permission is on |
| **L2 sensitive** | create or move files, close a window, read clipboard, type text, press shortcuts | Confirmation per tool policy; **always** confirmed when proposed by a model rather than spoken by the user |
| **L3 destructive** | shut down, restart, sign out, move file to Recycle Bin | **Always** confirmed, immediately before execution, with a button naming the exact action |

Confirmations (`tools/confirmations.ts`) are single-use, bound to a SHA-256 of the exact tool and validated input, expire after 60 seconds, and can be approved **only from the UI** over IPC. Voice can't approve, and neither can a model, a web page or a routine. A broad request never authorizes later steps: each routine step goes through the executor on its own.

## Files

- File tools see only **approved folders** plus the **workspace**, using canonical paths with symlinks and junctions resolved and boundary checks (`security/paths.ts`).
- Protected locations are always refused: `C:\Windows`, `Program Files`, `ProgramData`, credential and DPAPI folders, `.ssh`, `.aws`, `.gnupg`, UNC paths.
- No whole-disk scans: search is bounded (depth 6, 5,000 entries, 200 results).
- Nothing is overwritten. "Delete" means Recycle Bin, and it is L3.

## Secrets

- API keys are stored with Electron `safeStorage` (Windows DPAPI, tied to your Windows account) in `%APPDATA%\Clickyy AI\secrets.bin.json`. If OS encryption is unavailable, Clickyy refuses to store keys rather than writing plaintext.
- Keys never reach the renderer, which only sees `hasKey: boolean`. Logs, error messages, audit entries and stored history go through `redact()`, which removes known keys, `sk-…` patterns, bearer tokens and card-like numbers.
- `.env.example` contains placeholders only. No credentials are committed.

## Microphone and audio

- The microphone opens only in **push-to-talk** (while held), **wake-word** mode (shown by a persistent "mic on" badge) or an active **conversation**. Tracks are stopped when listening ends, so the Windows mic indicator matches reality.
- Audio is streamed only to the local speech service. It is **never written to disk** and **never sent to a cloud provider**: there is no cloud STT adapter by design.
- Emergency stop (tray menu, or the Stop button plus mute) cancels all actions, stops speech and mutes the mic. Microphone loss is detected and reported.

## Cloud use and consent

- Cloud reasoning requires both a non-strict policy **and** the explicit "Allow sending conversation text to the cloud" toggle (off by default).
- What is sent: your request text, recent conversation turns, saved memories and the tool list. Raw audio and file contents are never sent unless a tool you approved returned them in this turn.
- Strict Offline never falls back to the cloud; this is enforced by `orderProviders()` and again by `NetGuard`.

## Stored data

| Data | Where | Control |
|---|---|---|
| Settings, history, memories, apps, routines, reminders, audit | `%APPDATA%\Clickyy AI\clickyy.db` (SQLite, 3 rolling backups) | Settings → History & privacy / Memory; "Clear everything" |
| API keys | `%APPDATA%\Clickyy AI\secrets.bin.json` (DPAPI) | Settings → Credentials |
| Audio | not stored | — |

History is retained for a configurable number of days (default 30). Memories are saved only when you say "remember…" or add them in Settings; the model can't save memories by itself.

## Explicitly not implemented

Keylogging, hidden recording, screen capture, credential extraction, privilege elevation, disabling Windows security features, stealth persistence (launch-at-login is opt-in and visible), and process termination.

## Residual risks

- **Prompt injection through tool results** (for example window titles or file text) could steer a model toward calling permitted L1 tools. Mitigation: L2 and L3 tools always need on-screen confirmation for model-initiated calls; dangerous permissions are off by default.
- **Echo false wakes:** speech output saying the wake phrase could re-trigger detection. Mitigation: echo cancellation, cooldown, and a configurable interruption policy.
- **The PowerShell bridge runs with `-ExecutionPolicy Bypass`** for its own bundled script only. The script is part of the signed-once install and accepts no free-form commands.
