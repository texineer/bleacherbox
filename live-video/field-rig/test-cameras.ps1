# Sends fake "Mevo" test patterns into the relay so you can practice switching
# in OBS without the cameras. Run start-game.ps1 first.
#   powershell -ExecutionPolicy Bypass -File .\test-cameras.ps1        # start
#   powershell -ExecutionPolicy Bypass -File .\test-cameras.ps1 -Stop  # stop
param([switch]$Stop)

$running = Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | Where-Object CommandLine -match 'rtmp://127.0.0.1:1935/live/mevo'
if ($Stop) { $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host 'Test feeds stopped.'; return }
if ($running) { Write-Host 'Test feeds already running.'; return }

$ff = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ff) { $ff = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
if (-not $ff) { throw 'ffmpeg not found. Install with: winget install Gyan.FFmpeg' }

$feeds = @(
    @{ path = 'live/mevo1'; label = 'MEVO 3B TEST'; pattern = 'testsrc'; tone = 400 },
    @{ path = 'live/mevo2'; label = 'MEVO 1B TEST'; pattern = 'testsrc2';   tone = 800 }
)
foreach ($f in $feeds) {
    $vf = "drawtext=fontfile=C\\:/Windows/Fonts/arialbd.ttf:text='$($f.label)':fontsize=96:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=80"
    Start-Process $ff -WindowStyle Hidden -ArgumentList "-hide_banner -loglevel error -re -f lavfi -i $($f.pattern)=size=1920x1080:rate=30 -f lavfi -i sine=frequency=$($f.tone):sample_rate=48000 -vf `"$vf`" -c:v libx264 -preset ultrafast -g 60 -b:v 3000k -c:a aac -f flv rtmp://127.0.0.1:1935/$($f.path)"
}
Write-Host 'Test feeds started (Mevo 3B + Mevo 1B). Stop with -Stop.'
