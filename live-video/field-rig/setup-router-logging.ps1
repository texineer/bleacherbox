# One-time Slate 7 change: keep the system log in flash (/root/syslog.log, rotated at about 256 KB
# to syslog.log.old) so a reboot no longer erases what happened before it. analyze-game.ps1 reads it.
# Only restarts the logging service: Wi-Fi, cameras and the stream are not touched.
#   powershell -ExecutionPolicy Bypass -File .\setup-router-logging.ps1
$Router = '172.16.100.1'

# No double quotes inside: Windows PowerShell 5.1 mangles them when passing args to ssh.
$sh = 'uci set system.@system[0].log_file=/root/syslog.log; uci set system.@system[0].log_size=256; uci commit system; /etc/init.d/log restart; sleep 2; logger -t baseball router logging to flash enabled; sleep 1; ls -l /root/syslog.log*; tail -n 2 /root/syslog.log; echo @@DATE; date'
$out = ssh -o BatchMode=yes -o ConnectTimeout=6 "root@$Router" $sh 2>$null
if ($LASTEXITCODE -ne 0 -or -not $out) { throw "SSH to root@$Router failed. Join Thundercats first." }
$out | ForEach-Object { Write-Host "  $_" }

if ("$out" -notmatch 'logging to flash enabled') { Write-Host 'Log file was not written; check /etc/init.d/log on the router.' -ForegroundColor Red; exit 1 }
# The analyzer lines router events up with OBS by clock time, so the two clocks must agree.
$i = [array]::IndexOf($out, '@@DATE')
try { $rt = [datetime]::ParseExact(($out[$i + 1] -replace '\s+', ' ' -creplace ' [A-Z]{2,5} ', ' '), 'ddd MMM d HH:mm:ss yyyy', [Globalization.CultureInfo]::InvariantCulture); $skew = [int][math]::Abs(((Get-Date) - $rt).TotalSeconds) }
catch { $skew = 0; Write-Host "Could not read the router clock ($($out[$i + 1]))." -ForegroundColor Yellow }
if ($skew -gt 60) { Write-Host "Router clock is $skew s off the laptop (time zone?). Set it in the Slate 7 admin page: System -> Time Zone." -ForegroundColor Yellow }
Write-Host 'Router log now survives reboots.' -ForegroundColor Green
