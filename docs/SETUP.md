# Setup & troubleshooting

## Requirements

- Windows 11 x64.
- Node.js 22+ (developed on 24.20) to build.
- Python 3.10+ (developed on 3.12.10), only for voice input.

## 1. Build and run

```bash
cd apps/desktop
npm install
npm run build
npm start
```

`npm run dev` runs Vite with hot reload for the renderer and esbuild watch for main and preload.

npm 11 holds back package install scripts until you approve them. `esbuild` and `electron-winstaller` are approved in `package.json` (`allowScripts`). If `node_modules/electron/dist/electron.exe` is missing after install, run `node node_modules/electron/install.js`.

## 2. Voice input

The **installer already includes** the offline speech engine. These steps are only for development builds, or to rebuild the bundle.

```bash
powershell -ExecutionPolicy Bypass -File scripts/setup-speech.ps1
```

This creates `services/assistant/.venv`, installs `vosk`, `fastapi`, `uvicorn` and `pydantic`, downloads the Vosk small English model (~40 MB) from alphacephei.com, and checks that it loads.

For the **installed** app, add `-Install`. It copies the service to `%LOCALAPPDATA%\Clickyy AI\speech-service`, which the installed app finds automatically. You can also point Clickyy anywhere with the environment variables `CLICKYY_SPEECH_DIR`, `CLICKYY_PYTHON` and `CLICKYY_VOSK_MODEL`.

Then go to Settings → Listening & wake word, which should show **Vosk ready**.

## 3. Conversation with a local model (optional, offline)

1. Install Ollama from <https://ollama.com>.
2. Pull a model that supports tool calling, e.g. `ollama pull llama3.2` (2 GB) or `ollama pull qwen3`.
3. In Settings → AI & routing → Local model, choose the model and click **Test local model**.

LM Studio, llama.cpp `llama-server` or vLLM work too: choose **LM Studio / llama.cpp / vLLM** as the runtime (default URL `http://127.0.0.1:1234/v1`).

## 4. Cloud providers (optional)

1. Settings → Credentials: paste a key for any of **Anthropic (Claude), Google Gemini, OpenAI, Groq, OpenRouter, Mistral, DeepSeek, xAI (Grok)**, or a custom OpenAI-compatible service. Get keys at console.anthropic.com, aistudio.google.com, platform.openai.com, console.groq.com, openrouter.ai, console.mistral.ai, platform.deepseek.com and console.x.ai.
2. Settings → AI & routing: pick **Smart Hybrid** or **Online Preferred** and switch on **Allow sending conversation text to the cloud**.
3. Choose the primary provider, click **Load models**, and pick one. Optionally set a **fallback provider**. **Test** checks the key and model.

Clickyy never asks for account passwords.

## 5. Installer

```bash
cd apps/desktop
npm run dist
```

This produces `release/Clickyy-AI-Setup-0.1.0.exe`, a per-user NSIS installer (no admin) that can change the install directory and adds Start Menu and desktop shortcuts. Uninstalling keeps your data in `%APPDATA%\Clickyy AI`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "An Application Control policy has blocked this file" when building, running Electron, or importing Python packages | **Smart App Control** blocks unsigned binaries (Electron, Rolldown, Vosk, pydantic-core). Either turn it off yourself (Windows Security → App & browser control → Smart App Control; on some builds it can't be turned back on without resetting Windows), or use a code-signed build (see PACKAGING.md). |
| "Speech service not installed" | Run `setup-speech.ps1` (add `-Install` for the installed app). |
| "Microphone access was denied" | Windows Settings → Privacy & security → Microphone: turn on **Microphone access** and **Let desktop apps access your microphone**. |
| Mic badge is on but nothing is recognized | Check the level meter (the orb pulses with your voice). Pick the right default input device in Windows Sound settings. Speak a short command. |
| Wake phrase triggers too often or not at all | Settings → Listening: adjust **Sensitivity** (lower is stricter) and **Cooldown**. "Jarvis" is the most reliable phrase (see WAKE_WORDS.md). |
| "No speech voices are installed" | Windows Settings → Time & language → Speech → Add voices. |
| "No local model runtime found" | Start Ollama (`ollama serve`) or install it. |
| Cloud: "API key was rejected" | Re-paste the key in Settings → Credentials. |
| Cloud requests do nothing | Strict Offline blocks them by design. Check the policy and the consent toggle. |
| Volume, window or battery commands fail | Settings → Diagnostics → **Windows bridge** shows its state. The bridge needs `powershell.exe` (built in) and FullLanguage mode. |
| Shortcut doesn't register | Another app owns it. Change it in Settings → General. Diagnostics logs the conflict. |
| Window disappeared | It's in the tray (close behavior = Hide to tray). Click the tray icon or press Ctrl+Shift+Space. |
| Reset everything | Quit Clickyy and delete `%APPDATA%\Clickyy AI`. |

Logs (secrets redacted) are in Settings → Diagnostics.
