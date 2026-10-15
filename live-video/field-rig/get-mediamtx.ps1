# Downloads the MediaMTX relay into tools\mediamtx (the .exe isn't kept in git: 55 MB).
# Version pinned to what the rig was tested with. The x64 build runs fine on the Snapdragon
# laptop under Windows' emulation.
#   powershell -ExecutionPolicy Bypass -File .\get-mediamtx.ps1
$ver = 'v1.21.1'
$dir = Join-Path $PSScriptRoot 'tools\mediamtx'
if (Test-Path "$dir\mediamtx.exe") { Write-Host "Already there: $dir\mediamtx.exe"; return }
$zip = Join-Path $env:TEMP "mediamtx_$ver.zip"
& curl.exe -sL -o $zip "https://github.com/bluenviron/mediamtx/releases/download/$ver/mediamtx_${ver}_windows_amd64.zip"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $zip)) { throw "Download failed for MediaMTX $ver" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    foreach ($e in $z.Entries | Where-Object Name -in 'mediamtx.exe', 'LICENSE') {
        [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $dir $e.Name), $true)
    }
} finally { $z.Dispose() }
Remove-Item $zip
Write-Host "MediaMTX $ver installed in $dir (config: baseball.yml)" -ForegroundColor Green
