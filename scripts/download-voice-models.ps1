# Downloads the advanced offline voice models into services\assistant\models:
#   - Whisper base.en (CTranslate2 int8 conversion, MIT)   ~145 MB  accurate speech recognition
#   - Kokoro-82M v1.0 int8 ONNX + voice pack (Apache-2.0)  ~115 MB  natural neural voice
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$svc = Resolve-Path (Join-Path $PSScriptRoot '..\services\assistant')
$py = Join-Path $svc '.venv\Scripts\python.exe'
$models = Join-Path $svc 'models'
New-Item -ItemType Directory -Force $models | Out-Null

$whisper = Join-Path $models 'whisper-base.en'
if (-not (Test-Path (Join-Path $whisper 'model.bin'))) {
  Write-Output 'Downloading Whisper base.en (Systran/faster-whisper-base.en)'
  & $py -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-base.en', local_dir=r'$whisper', allow_patterns=['*.bin','*.json','*.txt'])"
}

$kokoro = Join-Path $models 'kokoro'
New-Item -ItemType Directory -Force $kokoro | Out-Null
$base = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0'
foreach ($f in @('kokoro-v1.0.int8.onnx', 'voices-v1.0.bin')) {
  $dst = Join-Path $kokoro $f
  if (-not (Test-Path $dst)) { Write-Output "Downloading $f"; Invoke-WebRequest "$base/$f" -OutFile $dst -UseBasicParsing }
}
Get-ChildItem $whisper, $kokoro -File | ForEach-Object { '{0,-28} {1,8:N1} MB' -f $_.Name, ($_.Length / 1MB) }
