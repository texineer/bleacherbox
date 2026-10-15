# Copies OBS's current Baseball scenes + GameChanger profile back into this folder,
# so tweaks (like the strike zone position) survive a reinstall. Close OBS first.
#   powershell -ExecutionPolicy Bypass -File .\save-obs-config.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$obs  = Join-Path $env:APPDATA 'obs-studio'

if (Get-Process obs64 -ErrorAction SilentlyContinue) {
    throw 'Close OBS first - it only writes its scene file when it exits.'
}

Copy-Item "$obs\basic\scenes\Baseball.json" "$root\obs\scenes\Baseball.json" -Force
Write-Host 'saved  obs\scenes\Baseball.json'

# Profile, minus service.json: that holds the GameChanger stream key.
foreach ($p in 'GameChanger', 'GameChanger_720') {
    if (-not (Test-Path "$obs\basic\profiles\$p")) { continue }
    New-Item -ItemType Directory -Force "$root\obs\profiles\$p" | Out-Null
    foreach ($f in 'basic.ini', 'streamEncoder.json') {
        Copy-Item "$obs\basic\profiles\$p\$f" "$root\obs\profiles\$p\$f" -Force
        Write-Host "saved  obs\profiles\$p\$f"
    }
}
