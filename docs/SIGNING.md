# Code signing with SignPath (free for open source)

Signing removes the "Windows protected your PC" SmartScreen warning over time and lets Clickyy run on PCs with **Smart App Control** on. The release workflow (`.github/workflows/release.yml`) already contains the signing steps. They switch on automatically once the secrets below exist; until then releases are built unsigned.

## 1. Apply (you, ~10 minutes, approval usually takes a few days)

1. Go to <https://signpath.org> and choose **Apply for free code signing** (SignPath Foundation, for OSS projects).
2. Project: `https://github.com/chinmoyy12/clickyy-ai` · License: you need an OSI-approved license in the repo. MIT is added as `LICENSE`.
3. Their requirements: the project is public, builds run on GitHub Actions (done), releases are built from source by CI (done, via `release.yml`), and the project has a code-signing policy page (this file plus `README` → Security).
4. Once approved, SignPath creates an organization for you. The certificate is issued to **SignPath Foundation**, so users see "Publisher: SignPath Foundation".

## 2. Configure SignPath (after approval)

In the SignPath web UI:

1. **Project** with slug `clickyy-ai`, linked to the GitHub repository (trusted build system: GitHub.com).
2. **Signing policy** with slug `release-signing` (or set the repo variable `SIGNPATH_SIGNING_POLICY`).
3. Two **artifact configurations**:

`app-files`: signs every executable inside the unpacked app (Electron, the bundled speech engine, DLLs and Python extension modules):

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file-set>
      <include path="*.exe" />
      <include path="**/*.exe" />
      <include path="*.dll" />
      <include path="**/*.dll" />
      <include path="**/*.pyd" min-matches="0" />
      <for-each>
        <authenticode-sign />
      </for-each>
    </pe-file-set>
  </zip-file>
</artifact-configuration>
```

`installer`: signs the NSIS setup program:

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file path="Clickyy-AI-Setup-*.exe">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

(GitHub uploads artifacts as zip files, which is why both start with `<zip-file>`. Check the exact element names against SignPath's current artifact-configuration docs when you create them.)

## 3. Connect GitHub

In **github.com/chinmoyy12/clickyy-ai → Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | API token of a SignPath CI user with submitter rights |
| Variable | `SIGNPATH_ORGANIZATION_ID` | your SignPath organization ID |
| Variable | `SIGNPATH_SIGNING_POLICY` | optional, default `release-signing` |

## 4. Release

```bash
git tag v0.1.1
```

```bash
git push origin v0.1.1
```

The workflow builds, signs both passes, verifies the Authenticode signature in its log, and attaches `Clickyy-AI-Setup.exe` to the release. The download link `https://github.com/chinmoyy12/clickyy-ai/releases/latest/download/Clickyy-AI-Setup.exe` then serves the signed build.

## Code signing policy

- Only builds produced by this repository's GitHub Actions release workflow, from a tagged commit on `main`, are submitted for signing.
- Releases are approved manually by the maintainer (@chinmoyy12) in SignPath before signing.
- Signed binaries never include third-party code that isn't built or bundled from the sources listed in `docs/DEPENDENCIES.md`.
- Privacy: Clickyy sends no telemetry; see `docs/SECURITY.md`.
