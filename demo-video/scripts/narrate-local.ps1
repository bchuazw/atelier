# Windows SAPI TTS fallback — generates a placeholder voiceover WAV from
# the same narration.md the real narrate.mjs uses. Use this when
# ELEVENLABS_API_KEY / OPENAI_API_KEY aren't available in the session.
# Swap the output for a better voice later without changing composition.

param(
    [string]$MarkdownPath = "$PSScriptRoot\narration.md",
    [string]$OutPath = "$PSScriptRoot\..\assets\voiceover.wav",
    [string]$VoiceNameHint = "Zira"   # Zira (F, en-US) ships with Win 10/11
)

Add-Type -AssemblyName System.Speech

# Strip markdown + timestamp markers, same as narrate.mjs does
$lines = Get-Content $MarkdownPath
$speakable = @()
foreach ($line in $lines) {
    if ($line -match '^#' -or $line -match '^---' -or [string]::IsNullOrWhiteSpace($line)) { continue }
    # Strip **[0:00] (label)** and similar timestamp markers
    $clean = $line -replace '^\*\*\[\d+:\d+\][^*]*\*\*', ''
    $clean = $clean.Trim()
    if ($clean.Length -eq 0) { continue }
    $speakable += $clean
}
$text = ($speakable -join "`n`n")

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
# Prefer female voice; fall back to default if Zira not installed
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -like "*$VoiceNameHint*" } | Select-Object -First 1
if ($voice) {
    $synth.SelectVoice($voice.VoiceInfo.Name)
    Write-Host "[narrate-local] voice=$($voice.VoiceInfo.Name)"
} else {
    Write-Host "[narrate-local] voice=$($synth.Voice.Name) (default, '$VoiceNameHint' not found)"
}
$synth.Rate = 0   # -10..+10; 0 is default ~185 wpm

# Ensure output dir
$dir = Split-Path $OutPath -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$synth.SetOutputToWaveFile($OutPath)
$synth.Speak($text)
$synth.Dispose()

$size = (Get-Item $OutPath).Length
Write-Host "[narrate-local] wrote $OutPath ($size bytes)"
