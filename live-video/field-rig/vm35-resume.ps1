# Undoes vm35-release.ps1: the relay pulls the VM35 again and OBS's Cam - CF reconnects by itself
# within a few seconds. The camera URL comes from baseball.yml so it stays in one place.
#   powershell -ExecutionPolicy Bypass -File .\vm35-resume.ps1
$api = 'http://127.0.0.1:9997/v3'
$yml = Join-Path $PSScriptRoot 'tools\mediamtx\baseball.yml'

$src = (Select-String -Path $yml -Pattern '^\s+source:\s+(rtsp://\S+)' | Select-Object -First 1).Matches.Groups[1].Value
if (-not $src) { throw "No VM35 source URL found in $yml" }

try {
    Invoke-RestMethod -Method Patch "$api/config/paths/patch/vm35" -ContentType 'application/json' -Body (@{ source = $src } | ConvertTo-Json) | Out-Null
} catch { throw "Relay not answering on $api. Is MediaMTX running (start-game.ps1)? $($_.Exception.Message)" }

# Give the relay a few seconds to reconnect, then report.
foreach ($i in 1..10) {
    Start-Sleep -Seconds 1
    $p = try { Invoke-RestMethod "$api/paths/get/vm35" } catch { $null }
    if ($p.ready) { Write-Host "VM35 back: relay is pulling it ($($p.tracks -join ', ')). OBS reconnects Cam - CF on its own." -ForegroundColor Green; return }
}
Write-Host 'Relay is trying to reach the VM35 but no video yet. If the NearStream app is still open, close it; if the camera is restarting, give it about 40 s. The relay keeps retrying.' -ForegroundColor Yellow
