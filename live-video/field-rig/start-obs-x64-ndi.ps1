# TEST ONLY: opens the portable x64 OBS (C:\Users\rpbea\Tools\obs-x64) that has the DistroAV NDI plugin.
# It runs under Windows' x64 emulation; tested 2026-10-14: 3 x 1080p feeds + x264 1080p30 at
# 4500 kbps, 0 skipped frames, ~26% laptop CPU. It has its own settings (portable mode) and no
# stream key, so it can't touch the normal OBS or stream by accident.
# Close the normal OBS first so the two don't compete for the camera feeds.
#   powershell -ExecutionPolicy Bypass -File .\start-obs-x64-ndi.ps1
$dir = 'C:\Users\rpbea\Tools\obs-x64'
# The NDI runtime installer sets this machine-wide; set it here too so OBS finds NDI even if
# Windows hasn't passed the new setting to this session yet.
$env:NDI_RUNTIME_DIR_V6 = [Environment]::GetEnvironmentVariable('NDI_RUNTIME_DIR_V6', 'Machine')
if (-not $env:NDI_RUNTIME_DIR_V6) { throw 'NDI runtime not installed: winget install --exact --id NDI.NDIRuntime' }
Start-Process "$dir\bin\64bit\obs64.exe" -ArgumentList '--portable --multi' -WorkingDirectory "$dir\bin\64bit"
Write-Host 'x64 OBS (NDI test) starting. Add a source: + -> NDI Source -> pick the Mevo.'
