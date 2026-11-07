# Speech service protocol

Process: `python -m clickyy_speech`, started and supervised by the Electron main process (`src/main/speech/service.ts`).

## Startup

| Env var | Meaning |
|---|---|
| `CLICKYY_TOKEN` | Per-launch random bearer token (≥ 32 chars). Required. |
| `CLICKYY_PORT` | `0` = OS-assigned port. |
| `CLICKYY_VOSK_MODEL` | Model directory. |

The service binds to **127.0.0.1 only** and prints `CLICKYY_READY port=<n>` on stdout. The supervisor restarts it at most three times with backoff, then reports `failed`.

## `GET /health`

Header `Authorization: Bearer <token>`. Returns 401 otherwise.

```json
{ "status": "ready" | "degraded",
  "engines": { "vosk": { "ready": true, "error": null, "model": "…" },
               "whisper": { "available": true, "ready": true, "model": "whisper-small", "multilingual": true },
               "wakeVerifier": { "available": true, "ready": true },
               "kokoro": { "available": true, "ready": false } },
  "wakeSupport": { "hey_clickyy": true, "clickyy": true, "jarvis": true } }
```

## `WS /ws/stt?token=<token>`

The client sends text control messages and binary audio:

| Message | Meaning |
|---|---|
| `{"type":"start","mode":"wake"\|"command","phrases":[…],"sensitivity":0.7,"cooldown_ms":2000,"accurate":true,"languages":["en","hi"],"verify":true}` | Start a session (replaces any current one). `languages`: one or both of `en`/`hi`; with both, Whisper detects the language per utterance (Urdu counts as Hindi). `verify`: second-stage wake check |
| binary frame | PCM16LE, mono, 16 kHz, ≤ 64,000 bytes, even length (the app sends 100 ms frames) |
| `{"type":"stop"}` | Flush and emit the final result |
| `{"type":"cancel"}` | Discard the session |
| `{"type":"ping"}` | Server replies `pong` |

The server sends:

| Event | Meaning |
|---|---|
| `ready` | Session started (includes the active grammar) |
| `partial {text}` | Command mode, changing hypothesis |
| `final {text, confidence, engine?, language?, draft?}` | Endpointed utterance. `engine:"whisper"` when re-read by Whisper; `language` is `en` or `hi` (Hindi comes back in Devanagari); `draft` is the Vosk text |
| `silence {forced}` | Endpoint with no words |
| `wake {phrase, confidence, verified?, command?, language?}` | Wake detection. `command` is what was said after the wake word in the same breath ("Clicky, open Spotify" → `open Spotify`) |
| `error {code, message}` | `bad_frame`, `bad_json`, `bad_start`, `engine_unavailable` |
