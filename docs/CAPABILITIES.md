# Capability matrices

## Offline vs online

"Offline" means it works with the network disabled once the listed local components are installed. A ✅ in the last column means it was verified on the development PC (Windows 11 26300, i5-11400H).

| Capability | Strict Offline | Smart Hybrid | Online Preferred | Needs | Verified |
|---|---|---|---|---|---|
| Typed deterministic commands (87) | ✅ | ✅ | ✅ | nothing | ✅ e2e |
| Open any Start-menu app by name | ✅ | ✅ | ✅ | nothing (read at launch) | ✅ e2e (119 apps found) |
| 760 websites by name, with "Chrome or Edge?" and a remembered choice | opens the browser* | ✅ | ✅ | a browser | ✅ unit + e2e |
| Search inside 68 sites (YouTube, Amazon, Wikipedia…) | opens the browser* | ✅ | ✅ | a browser | ✅ unit |
| 118 Settings pages, 52 Windows tools, 31 special folders | ✅ | ✅ | ✅ | nothing | ✅ unit (fixed targets) |
| World clock (307 places), dice, coin, random numbers, days until | ✅ | ✅ | ✅ | nothing | ✅ unit + e2e |
| Currency conversion (28 currencies) | ❌ blocked | ✅ | ✅ | network (ECB rates via Frankfurter) | unit (mocked HTTP) |
| Self-test | ✅ | ✅ | ✅ | nothing | ✅ e2e (7/7) |
| Always-listening switch | ✅ | ✅ | ✅ | speech service | ✅ e2e |
| Wake phrases | ✅ | ✅ | ✅ | speech service + Vosk model | ✅ recorded speech |
| Speech recognition | ✅ (Vosk) | ✅ (Vosk) | ✅ (Vosk) | speech service + model | ✅ recorded speech |
| Speech output, Windows voice | ✅ | ✅ | ✅ | an installed Windows voice | ✅ played |
| Speech output, cloud voice | ❌ blocked | ✅ if selected | ✅ if selected | OpenAI-compatible key + base URL | ⚠️ mock only |
| System status, volume, media, windows, apps | ✅ | ✅ | ✅ | Windows bridge (built in) | ✅ real APIs |
| Timers, reminders, focus sessions | ✅ | ✅ | ✅ | nothing | ✅ unit + e2e |
| Memory, history, routines | ✅ | ✅ | ✅ | nothing | ✅ unit + e2e |
| Opening websites / web search | opens the browser* | ✅ | ✅ | a browser | ✅ (URL validation) |
| Spotify search | opens Spotify* | ✅ | ✅ | Spotify app | unit |
| Open-ended conversation | ✅ with a local model | local first, cloud if allowed | cloud first, local fallback | Ollama + model, or API key | ⚠️ mock only |
| Model tool calling | ✅ with a local model | ✅ | ✅ | as above | ⚠️ mock only |
| Raw audio to the cloud | never | never | never | — | by design |

\* Clickyy itself makes no remote request; your browser or Spotify does.

If no model is available, Clickyy says so and continues with deterministic commands. It never pretends to have answered.

## Voice provider compatibility

| Engine | Offline | Rate | Pitch | Volume | Emotion/style tags | Streaming | Interruptible | Amplitude for orb | License | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Windows voices via `speechSynthesis` (Zira, Aria if installed, etc.) | ✅ | ✅ | ✅ | ✅ | ❌ | sentence-by-sentence | ✅ between and within sentences | ❌ (Chromium doesn't expose it) | ships with Windows | **default, verified** |
| Cloud, OpenAI-compatible `/v1/audio/speech` | ❌ | ❌ | ❌ | ✅ (playback) | provider-dependent (not used) | whole reply | ✅ | ✅ real analyser | provider terms | implemented, not live-tested |
| Piper (neural, local) | ✅ | ✅ | ❌ | ✅ | ❌ | sentence | ✅ | ✅ | MIT (rhasspy/piper) / GPL-3 (piper1-gpl) — verify | **not integrated** (recommended next step) |

**Voice profiles** (Sweet, Natural, Elegant, Playful, Professional, Soothing, Energetic, Charming, Custom) change wording in the system prompt and built-in phrases, plus speed and pitch multipliers on engines that support them. They don't change confirmations or safety rules. Adaptive expression picks a delivery style from the *situation* (greeting, success, error, explanation); it never analyzes your voice or emotions.

## Speech recognition engines

| Engine | Offline | Partials | Wake grammar | Size | License | Status |
|---|---|---|---|---|---|---|
| Vosk small en-US 0.15 | ✅ | ✅ | ✅ | 40 MB | Apache-2.0 | **default, verified** |
| Vosk large en-US 0.22 | ✅ | ✅ | ❌ (no dynamic grammar) | 1.8 GB | Apache-2.0 | can be swapped in for dictation via `CLICKYY_VOSK_MODEL`; wake mode needs the small model |
| faster-whisper / whisper.cpp | ✅ | ❌ (utterance level) | ❌ | 75 MB+ | MIT | not integrated |
| Cloud STT | ❌ | — | — | — | — | intentionally not implemented |

## Language model providers

| Provider | Kind | Streaming | Tool calling | Notes |
|---|---|---|---|---|
| Ollama (`/api/chat`) | local, loopback | ✅ NDJSON | ✅ | Works in Strict Offline. Model discovery from `/api/tags`. |
| Anthropic (official `@anthropic-ai/sdk`, beta Messages stream) | cloud | ✅ | ✅ | Default model `claude-opus-5-5`, effort `low` by default for voice latency, server-side refusal fallback (`fallbacks: "default"`) enabled on supported models |
| OpenAI, Google Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI (presets) and any custom OpenAI-compatible API | cloud | ✅ SSE, incremental tool-call deltas | ✅ | Documented OpenAI-compatible endpoints; live model list via `/models`; per-provider encrypted keys |
| LM Studio / llama.cpp server / vLLM | local, loopback | ✅ | ✅ (model-dependent) | Works in Strict Offline |
| Fallback chain | — | — | — | primary cloud → fallback cloud → local model, with a circuit breaker per provider |
