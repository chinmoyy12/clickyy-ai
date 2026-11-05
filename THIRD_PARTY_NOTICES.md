# Third-party notices

Clickyy AI's own code is MIT-licensed (see `LICENSE`). The Windows installer also ships the following third-party components. Each is distributed under its own license.

## Bundled in the desktop app

| Component | License | Source |
|---|---|---|
| Electron (Chromium, Node.js) | MIT, plus Chromium's bundled licenses (`LICENSES.chromium.html` in the install folder) | github.com/electron/electron |
| React, React DOM, framer-motion, lucide-react, zod, sql.js, @anthropic-ai/sdk | MIT / ISC / Apache-2.0 | npm |

## Bundled offline speech engine (`resources/speech-service`)

The speech engine runs as a **separate program** (`clickyy-speech.exe`) that the app starts and talks to over a local loopback connection.

| Component | License | Source |
|---|---|---|
| Python runtime (frozen by PyInstaller) | PSF License | python.org |
| Vosk + Vosk small en-US 0.15 model | Apache-2.0 | alphacephei.com/vosk |
| faster-whisper, CTranslate2 | MIT | github.com/SYSTRAN/faster-whisper |
| Whisper base.en weights (CTranslate2 conversion by Systran) | MIT | huggingface.co/Systran/faster-whisper-base.en, from openai/whisper |
| kokoro-onnx | MIT | github.com/thewh1teagle/kokoro-onnx |
| Kokoro-82M v1.0 weights and voices | Apache-2.0 | huggingface.co/hexgrad/Kokoro-82M |
| ONNX Runtime | MIT | github.com/microsoft/onnxruntime |
| **espeak-ng** (via espeakng-loader) | **GPL-3.0-or-later** | github.com/espeak-ng/espeak-ng |
| **phonemizer** (fork used by kokoro-onnx) | **GPL-3.0** | github.com/bootphon/phonemizer |
| PyAV / FFmpeg libraries | BSD-3-Clause / LGPL-2.1 | github.com/PyAV-Org/PyAV, ffmpeg.org |
| Hugging Face tokenizers | Apache-2.0 | github.com/huggingface/tokenizers |
| FastAPI, Starlette, Uvicorn, Pydantic, NumPy | MIT / BSD | PyPI |

Because espeak-ng and phonemizer are GPL-3.0, the `clickyy-speech.exe` program as distributed is covered by GPL-3.0. Its complete corresponding source is this repository's `services/assistant` folder, built by `scripts/build-speech.ps1`, together with the upstream sources linked above. The Electron app is a separate program that communicates with it over a socket and remains MIT-licensed.

## Optional, not bundled

Ollama, LM Studio, and the models you download with them are installed separately under their own licenses (for example, the Llama 3.2 Community License).
