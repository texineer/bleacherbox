# Frees the VM35 for the NearStream app (zoom, focus, settings): the relay stops pulling the
# centerfield camera, so the app no longer says "camera busy". The Mevo feeds keep running and
# OBS stays open; Cam - CF goes dark until vm35-resume.ps1. Close the NearStream app before resuming.
#   powershell -ExecutionPolicy Bypass -File .\vm35-release.ps1
$api = 'http://127.0.0.1:9997/v3'

$obs = Get-Process obs64 -ErrorAction SilentlyContinue
if ($obs) {
    $live = Get-NetTCPConnection -OwningProcess $obs.Id -State Established -ErrorAction SilentlyContinue |
        Where-Object { $_.RemoteAddress -notlike '127.*' -and $_.RemoteAddress -notlike '172.16.*' -and $_.RemoteAddress -notlike '::*' -and $_.RemotePort -in 443, 1935 }
    if ($live) { Write-Host 'OBS is LIVE: the CF camera will go dark on the stream until you resume it.' -ForegroundColor Yellow }
}

try {
    # 'publisher' = wait for someone to send video here instead of pulling the camera; nobody will.
    Invoke-RestMethod -Method Patch "$api/config/paths/patch/vm35" -ContentType 'application/json' -Body '{"source":"publisher"}' | Out-Null
} catch { throw "Relay not answering on $api. Is MediaMTX running (start-game.ps1)? $($_.Exception.Message)" }

Write-Host 'VM35 released. Use the NearStream app now, then close it completely and run vm35-resume.ps1.' -ForegroundColor Green
