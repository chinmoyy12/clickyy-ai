# Sets up the optional local speech service (Vosk) for Clickyy.
#   powershell -ExecutionPolicy Bypass -File scripts\setup-speech.ps1            # dev: services\assistant
#   powershell -ExecutionPolicy Bypass -File scripts\setup-speech.ps1 -Install   # copy to %LOCALAPPDATA%\Clickyy AI\speech-service for the installed app
# Requires Python 3.10+ on PATH. Downloads ~40 MB (Vosk small English model, Apache-2.0) from alphacephei.com.
param([switch]$Install)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$src = Resolve-Path (Join-Path $PSScriptRoot '..\services\assistant')
$target = if ($Install) { Join-Path $env:LOCALAPPDATA 'Clickyy AI\speech-service' } else { $src.Path }

if ($Install) {
  New-Item -ItemType Directory -Force $target | Out-Null
  Copy-Item -Recurse -Force (Join-Path $src 'clickyy_speech') $target
  Copy-Item -Force (Join-Path $src 'requirements.txt') $target
}

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw 'Python 3.10+ was not found on PATH. Install it from python.org and re-run.' }
$venv = Join-Path $target '.venv'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
  Write-Output "Creating virtual environment in $venv"
  & $python -m venv $venv
}
$py = Join-Path $venv 'Scripts\python.exe'
Write-Output 'Installing dependencies (vosk, fastapi, uvicorn, pydantic)'
& $py -m pip install --quiet --disable-pip-version-check -r (Join-Path $target 'requirements.txt')

$models = Join-Path $target 'models'
$model = Join-Path $models 'vosk-model-small-en-us-0.15'
if (-not (Test-Path $model)) {
  $existing = Join-Path $src 'models\vosk-model-small-en-us-0.15'
  New-Item -ItemType Directory -Force $models | Out-Null
  if ($Install -and (Test-Path $existing)) {
    Copy-Item -Recurse $existing $models
  } else {
    Write-Output 'Downloading Vosk small English model (~40 MB)'
    $zip = Join-Path $models 'model.zip'
    Invoke-WebRequest 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip' -OutFile $zip -UseBasicParsing
    Expand-Archive $zip $models -Force
    Remove-Item $zip
  }
}
& $py -c "import vosk; m = vosk.Model(r'$model'); print('Vosk model OK:', m.vosk_model_find_word('jarvis') >= 0)"
Write-Output "Speech service ready at $target"
