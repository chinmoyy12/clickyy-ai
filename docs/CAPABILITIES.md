# Capability matrices

## 0.7: compared with other assistants

This is a gap analysis against what Google Assistant, Siri, Alexa, ChatGPT voice mode and Claude do on a laptop, plus the "Jarvis" ideal from films (a fast, proactive assistant that controls everything and still works offline). Ratings describe Windows laptop use. ✅ means built in and tested. ◐ means partial or needs setup. ❌ means not available. The other assistants' columns are a general summary of their public feature sets, not a measured benchmark.

| Capability | Google | Siri (Mac) | Alexa | ChatGPT voice | Claude | Clickyy 0.7 |
|---|---|---|---|---|---|---|
| Open and control apps, windows, settings | ◐ | ✅ (macOS) | ❌ | ❌ | ◐ (computer use, opt-in) | ✅ 199 commands, 128 tools, 1,450+ named actions |
| Volume, media, brightness, power, Wi-Fi, Bluetooth | ◐ | ✅ | ❌ | ❌ | ❌ | ✅ (power asks first) |
| Files: find, organize, zip, duplicates | ❌ | ◐ | ❌ | ❌ | ◐ | ✅ (never deletes) |
| Timers, reminders, to-dos, notes, focus sessions | ✅ | ✅ | ✅ | ◐ | ❌ | ✅ offline |
| Weather | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ no key (Open-Meteo) |
| **News headlines** | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ **new**, no key (Google News RSS) |
| **Encyclopedia answers ("who is…")** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ **new**, no key (Wikipedia); a local model goes further |
| Open-ended conversation and reasoning | ✅ (cloud) | ◐ | ◐ | ✅ (cloud) | ✅ (cloud) | ✅ **new** built-in AI (Qwen3 1.7B, offline, no setup); bigger models via Ollama or a cloud key |
| **Speed vs depth switch** | ❌ | ❌ | ❌ | ◐ (model picker) | ◐ (extended thinking) | ✅ **new** Fast / Balanced / Turbo, by voice or one tap |
| **Updates itself** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ **new** from GitHub releases, SHA-256 checked |
| **Understands reworded commands with no model or internet** | ❌ | ◐ | ❌ | ❌ | ❌ | ✅ **new** on-device neural brain |
| **Learns your phrasings** | ◐ | ◐ | ◐ | ◐ (memory) | ◐ (memory) | ✅ **new** experience memory, local only |
| Works fully offline | ❌ | ◐ | ❌ | ❌ | ❌ | ✅ commands, speech, brain and conversation (built-in AI) |
| Needs an account or API key | yes | yes | yes | yes | yes | **no** (optional) |
| Wake word, always listening | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ "Clicky" (English and Hindi) |
| Interrupt while it talks | ◐ | ◐ | ✅ | ✅ | ✅ | ✅ |
| Looks at the screen | ✅ (Lens) | ◐ | ❌ | ✅ | ✅ | ✅ (asks first, needs a vision model) |
| Email, calendar, smart home | ✅ | ✅ | ✅ | ◐ | ◐ | ❌ not connected yet (drafts only; it says so honestly) |
| Proactive suggestions | ✅ | ◐ | ◐ | ❌ | ❌ | ◐ briefing and reminders only |

### Also new in 0.7 (24 commands, 20 tools in total)

| Area | Say | Works |
|---|---|---|
| News and knowledge | "what's the news", "latest cricket news", "what does Wikipedia say about black holes" | online, no key |
| Dictionary | "define serendipity", "what does ubiquitous mean", "synonyms for happy", "opposite of generous" | online, no key (Free Dictionary API) |
| Air and sun | "what's the air quality", "AQI in Delhi", "when is sunset", "sunrise in Tokyo" | online, no key (Open-Meteo) |
| Fun | jokes, true facts, riddles with "tell me the answer", motivation, rock paper scissors, "pick between pizza and burger" | offline |
| Wellness | "help me relax", "I'm feeling stressed": guided box breathing | offline |
| Calculators | "EMI for 5 lakh at 9 percent for 3 years", "split 2500 among 5 with a 10 percent tip", "BMI 70 kg 175 cm", "is 2028 a leap year", "how long until 5 pm" | offline |
| Dates | "what day was August 15 1947", "what day is Christmas", "how old is someone born on June 2 2006" | offline |
| Words | "how do you spell necessary", "spell bravo phonetically", "2026 in Roman numerals" | offline |
| Passwords | "generate a strong password": cryptographically random, shown on screen, never spoken | offline |
| Windows panels | "snip part of my screen", "show my notifications", "open quick settings", "show available Wi-Fi networks", "connect to a second screen", "open Task View", "open the camera" | offline (fixed URIs, checked as registered on Windows 11) |

### Built-in AI (0.7)

Clickyy ships with **Qwen3 1.7B** (Apache-2.0, Q4_K_M, 1.1 GB) and **llama.cpp**'s server (MIT, CPU build). They live inside the installer, so nothing is downloaded at run time.
- **Running:** the server starts as a child process on `127.0.0.1` on a random port, without a shell, and needs a random per-run API key, so other programs on the PC can't use it. It loads about 4 s after Clickyy starts, and stops after 20 minutes unused to give back about 1.5 GB of memory. It works in Strict Offline mode.
- **Routing:** it is the default local model. Ollama or a local server becomes the fallback, or the first choice if you turn off "Try it before Ollama". Cloud models follow the routing policy as before.
- **Modes:** Fast caps answers at 400 tokens, with no thinking. Balanced allows 1,200. Turbo allows 4,096 and turns on Qwen3's thinking, which the app keeps off screen.
- **Measured on an i5-11400H (CPU only):**

  | Task | Time |
  |---|---|
  | Model load | 1.9 s |
  | Short factual answer | 0.55 s |
  | Two-sentence explanation | 1.4 s |
  | Arithmetic word problem with thinking (correct) | 5.9 s |
  | Volume tool call | 1.9 s |

### Gaps that remain
- **Email, calendar and smart home** need account sign-in (OAuth). Clickyy drafts emails and messages, but you press Send. It says plainly that the rest isn't connected.
- **Proactive help** (for example "you have a meeting in 10 minutes, and traffic is heavy") needs calendar access first.
- **Deep offline reasoning** is limited by laptop size. The built-in Qwen3 1.7B answers everyday questions in about 0.5–2 s and handles simple tool use and arithmetic (Turbo makes it think first), but it is much weaker than cloud models on hard problems. Use Ollama for a bigger local model, or a cloud key.

## The on-device brain (0.7)

Clickyy understands requests in three layers. Each layer runs only when the one before it didn't answer:

1. **Rules** (instant and exact): 199 commands with hand-written patterns.
2. **Neural brain** (under 1 ms, offline, no key) for reworded commands the rules miss, such as "is the charger connected" or "capture my display".
   - **Features:** each sentence becomes a 4,096-dimension hashed vector of words, word pairs and character trigrams.
   - **Network:** a small neural network (4,096 → 64 ReLU → 199 intents, softmax).
   - **Training:** done at build time on about 10,000 augmented sentences from the catalog examples, written paraphrases and "not a command" examples. Weights are 8-bit quantized in `brain/weights.json` (363 KB). Retrain with `node scripts/train-brain.mjs`; a test fails if the data changed without retraining.
   - **Safety gates:** it acts only at 90% confidence or higher.
     - It refuses when the request asks for thinking ("why", "explain"…) or is a definition question ("what are computer processes").
     - At least half of the meaningful words must belong to the predicted command.
     - It runs only commands with one fixed action. Anything with details to fill in, or anything risky, is never run from a guess.
   - **Suggestions:** between 60% and 90% it asks "Did you mean …? Say yes and I'll do it."
   - **Experience memory:** when a language model handles a request with one safe, low-risk tool call, the brain remembers the exact phrase. The phrase then works offline next time.
     - Matching is exact after removing filler words, so "seventeen and four" never replays "seventeen and three".
     - Reminders, messages, files and anything that needs confirmation are never learned.
     - Learned phrases are listed, and can be forgotten, in Settings, AI, Offline brain.
3. **Language model**: local (Ollama) or cloud, for real conversation and multi-step tasks. Settings, AI, Offline brain downloads a free local model in one click, so Clickyy can think and answer with no internet and no API key.

When no model exists, "who is / what is / tell me about X" is answered from Wikipedia if you're online. This never happens in Strict Offline or with web access turned off.

**Measured (tests/brain.test.ts and tests/holdout.test.ts, phrasings not in the training data):**
- **Set 1** (64 commands): top-1 accuracy is at least 80%, and acted-on precision is at least 97% (enforced by the tests).
- **Set 2** (42 commands written later):
  - Rules alone handled 18.
  - Rules plus brain handled 29.
  - The brain made 0 wrong actions.
  - 0 of 30 general questions triggered a command.

  Set 2 was used to find and fix rule bugs, so treat it as a regression check, not a blind score.

## Laptop control added in 0.4 (from the 10,000-command analysis)

| Area | Tools | Safety |
|---|---|---|
| Interactive Excel builder | `sheet.create` with 30 templates (budget, invoice, EMI/loan with prepayment, inventory, payroll, gradebook, habit tracker…) or your own columns | writes new files only, in Documents\Clickyy\Sheets |
| Code projects | `document.save`, `project.save` (write, scaffold with tests, document, debug) | code is **never run**; Clickyy names the command to run it yourself; destructive requests are refused |
| Windows features (35) | `system.feature`: on, off, toggle, status, reset, settings | Wi-Fi off asks first; privacy and security switches only open Settings |
| Diagnostics (25 areas) | `system.diagnostic`: brief, assess against safe limits, 10-second sample; speak, file, JSON, Excel, clipboard, notification, note, email draft, snapshot | read-only; clipboard and screenshots need their permissions |
| Power | `power.now`, `power.schedule`, `power.cancel_scheduled`, `display.brightness`, `audio.mic_level` | sleep, hibernate, shutdown, restart and sign-out ask first; needs the power permission |
| Apps and windows | `apps.status`, `apps.force_quit`, `apps.restart`, `apps.startup`, `apps.clear_cache`, `windows.close_app`, `windows.manage`, `windows.screenshot`, `app.audio` | force quit asks first and protects Windows processes and Clickyy; never runs as administrator |
| Files by type | `files.by_type`, `files.duplicates`, `files.bulk` (organize, date-stamp, zip, back up) | home folder and approved folders only; never deletes or overwrites; organize and rename ask first |
| Music | `music.play` (Spotify or YouTube Music), `media.play_local`, `media.stop_after`, `media.pause_in` | lyrics are searched, not saved |
| Productivity | `todo.*`, `notes.*`, `checklist.read`, `time.log`, `time.summary`, `stopwatch.control`, repeating, snoozed and rescheduled reminders | stored locally |
| Messages | `message.email`, `message.whatsapp` | drafts only; you press Send |
| Web | private-window search in Chrome, Edge, Firefox, Brave and Opera | validated https URLs only |

Open-ended study requests (explain, quiz, roadmap, mock interview and similar) go to the language model on purpose.

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
