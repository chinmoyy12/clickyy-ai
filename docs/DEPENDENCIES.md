# External downloads, keys, licenses

## Downloads

| Item | Size | Source | Required for | License |
|---|---|---|---|---|
| Electron 45.2.1 runtime | ~110 MB | npm / github.com/electron | the app | MIT |
| Vosk small en-US 0.15 | 40 MB | alphacephei.com/vosk/models | voice input, wake phrases | Apache-2.0 |
| Python packages: vosk 0.3.45, fastapi, uvicorn, pydantic | ~60 MB | PyPI | speech service | Apache-2.0 / MIT / BSD |
| Ollama + a model (e.g. llama3.2, 2 GB) | varies | ollama.com | optional local conversation | MIT (Ollama); model licenses vary (Llama 3.2 Community License, Qwen Apache-2.0, …) |
| Windows voices | built in | Windows Settings → Speech | offline speech output | Windows license |

## Optional API keys

| Key | Used for | Where to enter |
|---|---|---|
| Anthropic API key | cloud reasoning (Claude) | Settings → Credentials |
| OpenAI-compatible key + base URL | cloud reasoning and/or cloud voice | Settings → Credentials, Settings → AI |

## npm packages (bundled)

react 19, react-dom, framer-motion 14, lucide-react, zod 4, sql.js 1.15 (SQLite in WASM), @anthropic-ai/sdk. Build-only: vite 8, tailwindcss 4, esbuild, typescript 5.9, vitest 5, electron-builder 26. All are MIT, ISC or Apache-2.0.

## Optional integrations (not yet implemented)

| Integration | Planned mechanism |
|---|---|
| Calendar / email | Microsoft Graph or Google APIs via OAuth (PKCE), minimum scopes, drafts confirmed before sending |
| Spotify playback of a specific playlist | Spotify Web API (OAuth) |
| Piper neural TTS | local ONNX voices in the speech service; check the license of the piper fork you use |
| faster-whisper | higher-accuracy local STT for final transcripts |
| Smart home | Home Assistant local API with a long-lived token stored via safeStorage |
