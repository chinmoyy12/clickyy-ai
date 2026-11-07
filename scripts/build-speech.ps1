# Freezes the Python speech service (plus the Vosk model) into a self-contained folder
# that electron-builder ships at resources/speech-service. No Python needed on the target PC.
#   powershell -ExecutionPolicy Bypass -File scripts\build-speech.ps1
$ErrorActionPreference = 'Stop'
$svc = Resolve-Path (Join-Path $PSScriptRoot '..\services\assistant')
$py = Join-Path $svc '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { throw 'Run scripts\setup-speech.ps1 first.' }
$model = Join-Path $svc 'models\vosk-model-small-en-us-0.15'
if (-not (Test-Path $model)) { throw 'Vosk model missing. Run scripts\setup-speech.ps1 first.' }

& $py -m pip install --quiet --disable-pip-version-check "pyinstaller>=6.10"
$work = Join-Path $env:TEMP 'clickyy-speech-build'
Push-Location $svc
try {
  & $py -m PyInstaller --noconfirm --clean --onedir --console --name clickyy-speech `
    --distpath (Join-Path $work 'dist') --workpath (Join-Path $work 'build') --specpath $work `
    --collect-all vosk --collect-submodules uvicorn --hidden-import _cffi_backend `
    --collect-all faster_whisper --collect-all ctranslate2 --collect-all tokenizers `
    --collect-all kokoro_onnx --collect-all onnxruntime --collect-all espeakng_loader --collect-all phonemizer --collect-all language_tags `
    --collect-all av --collect-submodules segments --collect-data csvw `
    run_speech.py
  if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed' }
} finally { Pop-Location }

$out = Resolve-Path (Join-Path $PSScriptRoot '..\apps\desktop\resources') | ForEach-Object { Join-Path $_ 'speech-service' }
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
Copy-Item -Recurse (Join-Path $work 'dist\clickyy-speech') $out
New-Item -ItemType Directory -Force (Join-Path $out 'models') | Out-Null
Copy-Item -Recurse $model (Join-Path $out 'models')
# Advanced voice models (optional): accurate recognition + neural voice.
# whisper-small: English + Hindi transcripts. whisper-base.en: fast wake-word verifier.
# (large-v3-turbo is not bundled; it is an optional download from Settings.)
foreach ($extra in @('whisper-small', 'whisper-base.en', 'kokoro')) {
  $src = Join-Path $svc "models\$extra"
  if (Test-Path $src) { Copy-Item -Recurse $src (Join-Path $out 'models') } else { Write-Warning "$extra not found; run scripts\download-voice-models.ps1 to include it" }
}
# Hugging Face download caches are not part of the model.
Get-ChildItem (Join-Path $out 'models') -Recurse -Directory -Force -Filter '.cache' | Remove-Item -Recurse -Force
$size = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Output "Speech service bundle ready: $out ($size MB)"
