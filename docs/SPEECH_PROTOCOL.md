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
  "engines": { "vosk": { "ready": true, "error": null, "model": "…" } },
  "wakeSupport": { "hey_clickyy": true, "clickyy": true, "jarvis": true } }
```

## `WS /ws/stt?token=<token>`

The client sends text control messages and binary audio:

| Message | Meaning |
|---|---|
| `{"type":"start","mode":"wake"\|"command","phrases":[…],"sensitivity":0.5,"cooldown_ms":2000}` | Start a session (replaces any current one) |
| binary frame | PCM16LE, mono, 16 kHz, ≤ 64,000 bytes, even length (the app sends 100 ms frames) |
| `{"type":"stop"}` | Flush and emit the final result |
| `{"type":"cancel"}` | Discard the session |
| `{"type":"ping"}` | Server replies `pong` |

The server sends:

| Event | Meaning |
|---|---|
| `ready` | Session started (includes the active grammar) |
| `partial {text}` | Command mode, changing hypothesis |
| `final {text, confidence}` | Endpointed utterance |
| `silence {forced}` | Endpoint with no words |
| `wake {phrase, confidence}` | Wake mode detection |
| `error {code, message}` | `bad_frame`, `bad_json`, `bad_start`, `engine_unavailable` |
