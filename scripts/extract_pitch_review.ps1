$ErrorActionPreference = "Stop"
$review = Join-Path (Split-Path -Parent $PSScriptRoot) "output\pitch-video\review"
$video = Join-Path (Split-Path -Parent $PSScriptRoot) "output\pasinpay-pitch-video.mp4"
$ffmpeg = "C:\Users\baghe\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe"
New-Item -ItemType Directory -Force $review | Out-Null
Get-ChildItem $review -Filter "*.png" -ErrorAction SilentlyContinue | Remove-Item -Force
foreach ($seconds in @(0, 15, 30, 45, 60, 75, 90, 100)) {
    $name = "frame-$($seconds.ToString('000')).png"
    & $ffmpeg -y -loglevel error -ss $seconds -i $video -frames:v 1 -q:v 2 (Join-Path $review $name)
}
Get-ChildItem $review | Select-Object Name, Length
