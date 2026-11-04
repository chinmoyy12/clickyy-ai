# Synthesizes 16 kHz mono WAV fixtures with the offline Windows SAPI voice.
# Used by services/assistant/tests to exercise the real Vosk engine deterministically.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot '..\services\assistant\tests\fixtures'
New-Item -ItemType Directory -Force $out | Out-Null
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$phrases = [ordered]@{
  'open_notepad'     = 'open notepad'
  'hey_jarvis'       = 'hey jarvis'
  'hey_clicky'       = 'hey clicky'
  'clicky'           = 'clicky'
  'weather_sentence' = 'the weather is lovely today and I am going for a walk'
  'volume_thirty'    = 'set the volume to thirty percent'
}
foreach ($k in $phrases.Keys) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.Rate = -1
  $s.SetOutputToWaveFile((Join-Path $out "$k.wav"), $fmt)
  $s.Speak($phrases[$k])
  $s.Dispose()
  Write-Output "wrote $k.wav"
}
