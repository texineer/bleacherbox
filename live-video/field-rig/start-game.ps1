# Game-day launcher: starts the MediaMTX relay, then OBS, then the game monitor.
# Default is NDI: the Mevos send NDI straight to the x64 OBS (start-obs-x64-ndi.ps1); the relay
# still carries the VM35. -Rtmp is the old path: Mevos push RTMP to the relay, normal (ARM) OBS.
#   powershell -ExecutionPolicy Bypass -File .\start-game.ps1 [-Rtmp]
param([switch]$Rtmp)
$root   = $PSScriptRoot
$mtxDir = "$root\tools\mediamtx"
$obsExe = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OBSProject.OBSStudio_Microsoft.Winget.Source_8wekyb3d8bbwe\bin\64bit\obs64.exe"
$ndiObs = 'C:\Users\rpbea\Tools\obs-x64\bin\64bit\obs64.exe'
$mevos  = [ordered]@{ 'Beav (Mevo 3B)' = '172.16.100.51'; 'Trey (Mevo 1B)' = '172.16.100.52' }

if (-not (Get-Process mediamtx -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path "$mtxDir\mediamtx.exe")) { throw "mediamtx.exe not found in $mtxDir (it's not in git; copy it from the stream laptop's field-rig\tools\mediamtx)." }
    # Own window so you can watch cameras connect; close it after the game.
    Start-Process "$mtxDir\mediamtx.exe" -ArgumentList "`"$mtxDir\baseball.yml`"" -WorkingDirectory $mtxDir -WindowStyle Minimized
    Start-Sleep -Seconds 2
    if (Get-Process mediamtx -ErrorAction SilentlyContinue) { Write-Host 'MediaMTX relay started (minimized window).' }
    else { Write-Host 'MediaMTX relay did NOT start. Run tools\mediamtx\mediamtx.exe by hand to see why.' -ForegroundColor Red }
} else {
    Write-Host 'MediaMTX relay already running.'
}

$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
Write-Host ''
Write-Host "Laptop IP: $ip   (should be 172.16.100.10 on the Slate 7)"

if ($Rtmp) {
    Write-Host 'Mevo app -> Live -> custom RTMP:'
    Write-Host "  Mevo 3B:  server rtmp://$ip`:1935/live   stream key  mevo1"
    Write-Host "  Mevo 1B:  server rtmp://$ip`:1935/live   stream key  mevo2"
    Write-Host ''
    if (-not (Get-Process obs64 -ErrorAction SilentlyContinue)) {
        Start-Process $obsExe -WorkingDirectory (Split-Path $obsExe)
    }
} else {
    # NDI Mode is a camera setting; the Mevo answers on 5960 when it's on. Cameras can take a minute to boot.
    Write-Host 'Mevos (NDI):'
    foreach ($name in $mevos.Keys) {
        $c = New-Object Net.Sockets.TcpClient
        $ndi = try { $c.ConnectAsync($mevos[$name], 5960).Wait(1500) -and $c.Connected } catch { $false } finally { $c.Close() }
        if ($ndi) { Write-Host "  $name  NDI on" -ForegroundColor Green }
        elseif (Test-Connection $mevos[$name] -Count 1 -Quiet) { Write-Host "  $name  on Wi-Fi but NDI is OFF. Mevo app -> ... -> gear -> NDI Mode on" -ForegroundColor Yellow }
        else { Write-Host "  $name  not on the network yet (still booting, or not on Thundercats)" -ForegroundColor Yellow }
    }
    Write-Host ''
    $running = Get-Process obs64 -ErrorAction SilentlyContinue
    if ($running | Where-Object Path -ne $ndiObs) {
        Write-Host 'The normal OBS is open. Close it, then run this again to open the NDI OBS.' -ForegroundColor Yellow
    } elseif (-not $running) {
        & "$root\start-obs-x64-ndi.ps1"
        Write-Host 'Paste the GameChanger stream key in Settings -> Stream if it is not saved yet.'
    }
}

# Network monitor for analyze-game.ps1. Stops by itself 10 minutes after OBS closes.
if (-not (Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object CommandLine -match 'game-monitor\.ps1')) {
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$root\game-monitor.ps1`"" -WindowStyle Minimized
    Write-Host 'Game monitor started (minimized window). After the game run analyze-game.ps1.'
}
