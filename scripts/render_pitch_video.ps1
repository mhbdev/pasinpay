$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pitchRoot = Join-Path $root "output\pitch-video"
$slides = Join-Path $pitchRoot "slides"
$audio = Join-Path $pitchRoot "audio"
$segments = Join-Path $pitchRoot "segments"
$final = Join-Path $root "output\pasinpay-pitch-video.mp4"
$thumbnail = Join-Path $root "output\pasinpay-pitch-thumbnail.png"
$ffmpeg = "C:\Users\baghe\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe"
$ffprobe = "C:\Users\baghe\AppData\Local\Microsoft\WinGet\Links\ffprobe.exe"

if (-not (Test-Path $ffmpeg)) { $ffmpeg = "ffmpeg" }
if (-not (Test-Path $ffprobe)) { $ffprobe = "ffprobe" }

New-Item -ItemType Directory -Force -Path $audio, $segments | Out-Null
Get-ChildItem $audio -Filter "audio-*.wav" -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem $segments -Filter "segment-*.mp4" -ErrorAction SilentlyContinue | Remove-Item -Force

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
if ($voices -contains "Microsoft David Desktop") {
    $synth.SelectVoice("Microsoft David Desktop")
} elseif ($voices -contains "Microsoft Zira Desktop") {
    $synth.SelectVoice("Microsoft Zira Desktop")
}
$synth.Rate = 0
$synth.Volume = 100

$scriptPath = Join-Path $pitchRoot "pitch-script.txt"
$paragraphs = (Get-Content $scriptPath -Raw) -split "\r?\n\r?\n" | Where-Object { $_.Trim() }
for ($i = 0; $i -lt $paragraphs.Count; $i++) {
    $number = ($i + 1).ToString("00")
    $path = Join-Path $audio "audio-$number.wav"
    $synth.SetOutputToWaveFile($path)
    $synth.Speak($paragraphs[$i].Trim())
    $synth.SetOutputToNull()
}
$synth.Dispose()

$durations = @()
for ($i = 0; $i -lt $paragraphs.Count; $i++) {
    $number = ($i + 1).ToString("00")
    $audioPath = Join-Path $audio "audio-$number.wav"
    $duration = (& $ffprobe -v error -show_entries format=duration -of csv=p=0 $audioPath).Trim()
    $seconds = [double]::Parse($duration, [Globalization.CultureInfo]::InvariantCulture) + 0.55
    $durations += $seconds
    $slidePath = Join-Path $slides "slide-$number.png"
    $segmentPath = Join-Path $segments "segment-$number.mp4"
    $fadeOutStartValue = [Math]::Max(0, ($seconds - 0.32))
    $fadeOutStart = $fadeOutStartValue.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture)
    $secondsText = $seconds.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture)
    $filter = "scale=1920:1080,fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOutStart}:d=0.32"
    & $ffmpeg -y -loglevel error -loop 1 -i $slidePath -t $secondsText -vf $filter -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p $segmentPath
}

$videoList = Join-Path $pitchRoot "video-list.txt"
$audioList = Join-Path $pitchRoot "audio-list.txt"
$videoLines = @()
$audioLines = @()
for ($i = 0; $i -lt $paragraphs.Count; $i++) {
    $number = ($i + 1).ToString("00")
    $videoLines += "file 'segments/segment-$number.mp4'"
    $audioLines += "file 'audio/audio-$number.wav'"
}
Set-Content -Path $videoList -Value $videoLines -Encoding ascii
Set-Content -Path $audioList -Value $audioLines -Encoding ascii

$visuals = Join-Path $pitchRoot "visuals.mp4"
$narration = Join-Path $pitchRoot "narration.wav"
& $ffmpeg -y -loglevel error -f concat -safe 0 -i $videoList -c copy $visuals
& $ffmpeg -y -loglevel error -f concat -safe 0 -i $audioList -c:a pcm_s16le $narration
& $ffmpeg -y -loglevel error -i $visuals -i $narration -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 128k -movflags +faststart -shortest $final
Copy-Item (Join-Path $slides "slide-01.png") $thumbnail -Force

$probe = & $ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_type,width,height,codec_name -of default=noprint_wrappers=1 $final
Write-Output $probe
Write-Output "Created: $final"
Write-Output "Thumbnail: $thumbnail"
