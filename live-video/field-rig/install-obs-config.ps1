# Installs the Baseball scene collection + GameChanger profile into OBS, and
# opens the firewall for the Mevo RTMP feeds. Run once (re-run with -Force to
# overwrite your OBS copies with the versions in this folder).
#
#   powershell -ExecutionPolicy Bypass -File .\install-obs-config.ps1 [-Force]
param([switch]$Force)
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$obs  = Join-Path $env:APPDATA 'obs-studio'

if (Get-Process obs64 -ErrorAction SilentlyContinue) {
    throw 'Close OBS first - it overwrites its config files when it exits.'
}
if (-not (Test-Path "$obs\user.ini")) {
    throw "OBS config not found at $obs. Open and close OBS once, then re-run."
}

function Copy-IfNeeded($src, $dst) {
    if ((Test-Path $dst) -and -not $Force) { Write-Host "  keep    $dst (exists; use -Force to overwrite)"; return }
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item $src $dst -Force
    Write-Host "  copied  $dst"
}

# Minimal INI setter: updates key in [section], adding section/key if missing.
function Set-Ini($path, $section, $key, $value) {
    $lines = [System.Collections.Generic.List[string]]::new()
    if (Test-Path $path) { foreach ($l in @(Get-Content $path)) { if ($null -ne $l) { $lines.Add($l) } } }
    $start = $lines.IndexOf("[$section]")
    if ($start -lt 0) {
        if ($lines.Count -and $lines[$lines.Count - 1] -ne '') { $lines.Add('') }
        $lines.Add("[$section]"); $lines.Add("$key=$value")
    } else {
        $end = $start + 1
        while ($end -lt $lines.Count -and $lines[$end] -notmatch '^\[') { $end++ }
        $i = -1
        for ($j = $start + 1; $j -lt $end; $j++) { if ($lines[$j] -like "$key=*") { $i = $j; break } }
        if ($i -ge 0) { $lines[$i] = "$key=$value" } else { $lines.Insert($end, "$key=$value") }
    }
    Set-Content $path $lines -Encoding utf8
}

Write-Host 'OBS profile + scene collection:'
# GameChanger = 1080p 4500 kbps, GameChanger_720 = 720p 3000 kbps; check-system -SpeedTest says which to use.
foreach ($p in Get-ChildItem "$root\obs\profiles" -Directory) {
    foreach ($f in Get-ChildItem $p.FullName -File) {
        Copy-IfNeeded $f.FullName "$obs\basic\profiles\$($p.Name)\$($f.Name)"
    }
}
Copy-IfNeeded "$root\obs\scenes\Baseball.json" "$obs\basic\scenes\Baseball.json"

# The strike zone is a browser source pointing at a local file; aim it at wherever this folder is.
$scene = "$obs\basic\scenes\Baseball.json"
$overlay = 'file:///' + ($root -replace '\\', '/') + '/overlays/strikezone.html'
$t = [IO.File]::ReadAllText($scene)
$n = $t -replace 'file:///[^"?]*/overlays/strikezone\.html', $overlay
if ($n -ne $t) { [IO.File]::WriteAllText($scene, $n, (New-Object Text.UTF8Encoding($false))); Write-Host "  strike zone overlay -> $overlay" }

# Make them the active profile/collection on next launch.
Set-Ini "$obs\user.ini" 'Basic' 'Profile' 'GameChanger'
Set-Ini "$obs\user.ini" 'Basic' 'ProfileDir' 'GameChanger'
Set-Ini "$obs\user.ini" 'Basic' 'SceneCollection' 'Baseball'
Set-Ini "$obs\user.ini" 'Basic' 'SceneCollectionFile' 'Baseball.json'

# Browser sources need software rendering on Windows ARM64.
Set-Ini "$obs\global.ini" 'General' 'BrowserHWAccel' 'false'
Set-Ini "$obs\user.ini"   'General' 'BrowserHWAccel' 'false'

New-Item -ItemType Directory -Force "$env:USERPROFILE\Videos\Baseball" | Out-Null
Write-Host '  set active profile=GameChanger, scenes=Baseball; browser HW accel off'

# Firewall: let the Mevos reach MediaMTX's RTMP port. Needs admin (UAC prompt).
$exe = "$root\tools\mediamtx\mediamtx.exe"
if (-not (Get-NetFirewallRule -DisplayName 'MediaMTX RTMP (Mevo)' -ErrorAction SilentlyContinue)) {
    Write-Host 'Adding firewall rule (approve the admin prompt)...'
    $cmd = "New-NetFirewallRule -DisplayName 'MediaMTX RTMP (Mevo)' -Direction Inbound -Program '$exe' -Protocol TCP -LocalPort 1935 -Action Allow -Profile Private,Public | Out-Null"
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', $cmd
}
if (Get-NetFirewallRule -DisplayName 'MediaMTX RTMP (Mevo)' -ErrorAction SilentlyContinue) {
    Write-Host '  firewall rule present'
} else {
    Write-Warning 'Firewall rule missing - Mevos will not be able to connect.'
}
Write-Host 'Done.'
