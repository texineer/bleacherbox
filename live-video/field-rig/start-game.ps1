# Game-day launcher: starts the MediaMTX relay, then OBS.
#   powershell -ExecutionPolicy Bypass -File .\start-game.ps1
$root   = $PSScriptRoot
$mtxDir = "$root\tools\mediamtx"
$obsExe = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OBSProject.OBSStudio_Microsoft.Winget.Source_8wekyb3d8bbwe\bin\64bit\obs64.exe"

if (-not (Get-Process mediamtx -ErrorAction SilentlyContinue)) {
    # Own window so you can watch cameras connect; close it after the game.
    Start-Process "$mtxDir\mediamtx.exe" -ArgumentList "`"$mtxDir\baseball.yml`"" -WorkingDirectory $mtxDir -WindowStyle Minimized
    Write-Host 'MediaMTX relay started (minimized window).'
} else {
    Write-Host 'MediaMTX relay already running.'
}

$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
Write-Host ''
Write-Host "Laptop IP: $ip   (should be 172.16.100.10 on the Slate 7)"
Write-Host 'Mevo app -> Live -> custom RTMP:'
Write-Host "  Mevo 3B:  server rtmp://$ip`:1935/live   stream key  mevo1"
Write-Host "  Mevo 1B:  server rtmp://$ip`:1935/live   stream key  mevo2"
Write-Host ''

if (-not (Get-Process obs64 -ErrorAction SilentlyContinue)) {
    Start-Process $obsExe -WorkingDirectory (Split-Path $obsExe)
}

# Network monitor for analyze-game.ps1. Stops by itself 10 minutes after OBS closes.
if (-not (Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object CommandLine -match 'game-monitor\.ps1')) {
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$root\game-monitor.ps1`"" -WindowStyle Minimized
    Write-Host 'Game monitor started (minimized window). After the game run analyze-game.ps1.'
}
