# Windows packaging

```bash
cd apps/desktop
npm run dist
```

- **Tool:** electron-builder 26.18, NSIS target, x64. Configured in the `build` section of `apps/desktop/package.json`.
- **Output:** `apps/desktop/release/Clickyy-AI-Setup-<version>.exe` (~173 MB) plus `release/win-unpacked/`.
- **Contents:** `app.asar` (bundled main, preload and renderer; no `node_modules`), `resources/windows/bridge.ps1`, `resources/icon.png`, `resources/speech-service/` (frozen Vosk speech engine and model).
- **Public download:** each GitHub release carries `Clickyy-AI-Setup.exe`, so `https://github.com/chinmoyy12/clickyy-ai/releases/latest/download/Clickyy-AI-Setup.exe` always points at the newest build.
- **Install:** per user (`%LOCALAPPDATA%\Programs\Clickyy AI`), no admin. You can choose the directory; Start Menu and desktop shortcuts are created. Uninstalling keeps user data.
- **Silent install** (used by the automated test): `Clickyy-AI-Setup-0.1.0.exe /S`.
- **Verify a build:** `node scripts/e2e.mjs "<path to Clickyy AI.exe>"`.

## Speech service (bundled)

`scripts/build-speech.ps1` freezes the Python speech service with PyInstaller (`--onedir`) and copies it, together with the models, to `apps/desktop/resources/speech-service`. The models are:
- Vosk small-en: live captions and wake spotting.
- Whisper small (multilingual, 0.46 GB): English and Hindi transcripts.
- Whisper base.en: the wake verifier, and the fast English-only mode.
- Kokoro: neural voice, English and Hindi.

From 0.5.0 the installer is about 0.6 GB because of Whisper small. Whisper large-v3-turbo (1.6 GB) is not bundled. It is an optional in-app download (Settings › Voice › Best accuracy) into `%APPDATA%\Clickyy AI\models`, with a pinned revision and a SHA-256 check (`src/main/speech/models.ts`). electron-builder ships that folder as `resources/speech-service`, and the app runs `clickyy-speech.exe` from there, so installed users need no Python. Run the script before `npm run dist`. Without it, the installer still builds, but voice input is disabled with a clear message.

## Code signing (required for distribution)

The build is **unsigned**. Consequences:

- SmartScreen shows "Windows protected your PC" on first run.
- PCs with **Smart App Control** on will block the app outright. Electron's own binary is also unsigned upstream; SAC blocked it on the development PC until SAC was turned off.

To distribute, sign with an Authenticode certificate, for example Azure Trusted Signing or an OV/EV certificate. In electron-builder, set `win.azureSignOptions` (Trusted Signing) or `CSC_LINK`/`CSC_KEY_PASSWORD`. Sign the bundled Python runtime and wheels too if you ship them.
