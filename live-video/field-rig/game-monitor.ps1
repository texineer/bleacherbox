# In-game network monitor. Every few seconds it records each hop of the stream path to a CSV,
# so after the game analyze-game.ps1 can say which hop failed at each OBS disconnect.
# start-game.ps1 launches it in its own minimized window. Close the window (or Ctrl+C) to stop;
# it also stops by itself 10 minutes after OBS closes.
#   powershell -ExecutionPolicy Bypass -File .\game-monitor.ps1 [-IntervalSec 5]
#
# Columns: gw_ms / inet_ms = ping to the Slate 7 / 1.1.1.1 (blank = lost), wifi_mbps / wifi_signal = laptop
# Wi-Fi link (or 'wired'), wan_route / wan_link = router has a default route / WAN port carrier,
# sl_* = Starlink dish (latency, ping drop 0-1, uplink kbps, obstructed now, uptime s), obs_live = OBS
# connected to GameChanger, obs_feeds = camera feeds into OBS.
param([int]$IntervalSec = 5)

$Router   = '172.16.100.1'
$Starlink = '192.168.100.1:9200'
$outDir   = Join-Path $PSScriptRoot ("logs\games\{0:yyyy-MM-dd}" -f (Get-Date))
New-Item -ItemType Directory -Force $outDir | Out-Null
$csv = Join-Path $outDir ("monitor-{0:HHmmss}.csv" -f (Get-Date))
'time,gw_ms,inet_ms,wifi_mbps,wifi_signal,wan_route,wan_link,router_load,sl_ms,sl_drop,sl_up_kbps,sl_obstructed,sl_uptime_s,obs_live,obs_feeds' | Set-Content $csv -Encoding ASCII

$grpcurl = (Get-Command grpcurl -ErrorAction SilentlyContinue).Source
$ping = New-Object Net.NetworkInformation.Ping
function Ping-Ms($ip) {
    try { $r = $ping.Send($ip, 1000); if ($r.Status -eq 'Success') { return [int]$r.RoundtripTime } } catch {}
    return ''
}

$Host.UI.RawUI.WindowTitle = 'Game monitor - close after the game'
Write-Host "Game monitor writing $csv"
Write-Host 'Leave this window open during the game.' -ForegroundColor DarkGray

$router = @{ Route = ''; Link = ''; Load = '' }; $sl = @{ Ms = ''; Drop = ''; Up = ''; Obs = ''; Upt = '' }
$tick = 0; $obsGoneSince = $null
while ($true) {
    $t0 = Get-Date

    $gw = Ping-Ms $Router
    $inet = Ping-Ms '1.1.1.1'

    $wifiMbps = 'wired'; $wifiSig = ''
    $wl = netsh wlan show interfaces
    if ("$wl" -match 'State\s+:\s+connected') {
        $rx = ($wl | Select-String '^\s+Receive rate') -replace '.*:\s*', ''
        $sg = ($wl | Select-String '^\s+Signal') -replace '.*:\s*', ''
        $alias = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object IPAddress -like '172.16.100.*' | Select-Object -First 1).InterfaceAlias
        if (-not $alias -or (Get-NetAdapter -InterfaceAlias $alias -ErrorAction SilentlyContinue).PhysicalMediaType -match '802\.11|Wireless') {
            $wifiMbps = "$rx".Trim(); $wifiSig = "$sg".Trim().TrimEnd('%')
        }
    }

    # Router and dish every third tick (about 15 s): enough to catch a 4-minute outage's cause.
    if ($tick % 3 -eq 0) {
        $out = ssh -o BatchMode=yes -o ConnectTimeout=3 "root@$Router" 'read l x < /proc/loadavg; echo $l; ip route show default | head -1; cat /sys/class/net/eth0/carrier' 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) {
            $router.Load = "$($out[0])".Trim()
            $router.Route = if ("$($out[1])" -match 'dev (\S+)') { $Matches[1] } else { 'none' }
            $router.Link = "$($out[-1])".Trim()
        } else { $router = @{ Route = ''; Link = ''; Load = '' } }

        $sl = @{ Ms = ''; Drop = ''; Up = ''; Obs = ''; Upt = '' }
        if ($grpcurl) {
            $j = & $grpcurl -plaintext -max-time 3 -d '{\"get_status\":{}}' $Starlink SpaceX.API.Device.Device/Handle 2>$null
            if ($LASTEXITCODE -eq 0 -and $j) {
                $d = (($j -join "`n") | ConvertFrom-Json).dishGetStatus
                $sl.Ms = [math]::Round([double]$d.popPingLatencyMs)
                $sl.Drop = [math]::Round([double]$d.popPingDropRate, 3)
                $sl.Up = [math]::Round([double]$d.uplinkThroughputBps / 1000)
                $sl.Obs = [int][bool]$d.obstructionStats.currentlyObstructed
                $sl.Upt = $d.deviceState.uptimeS
            }
        }
    }

    $obsLive = ''; $feeds = ''
    $obs = Get-Process obs64 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($obs) {
        $obsGoneSince = $null
        $conns = @(Get-NetTCPConnection -OwningProcess $obs.Id -State Established -ErrorAction SilentlyContinue)
        $feeds = @($conns | Where-Object { $_.RemotePort -eq 8554 -and $_.RemoteAddress -like '127.*' }).Count
        $obsLive = [int][bool]($conns | Where-Object { $_.RemoteAddress -notlike '127.*' -and $_.RemoteAddress -notlike '172.16.*' -and $_.RemoteAddress -notlike '::*' -and $_.RemotePort -in 443, 1935 })
    } elseif (-not $obsGoneSince) { $obsGoneSince = Get-Date }
    elseif (((Get-Date) - $obsGoneSince).TotalMinutes -ge 10) { Write-Host 'OBS closed 10 minutes ago; monitor stopping.'; break }

    $row = @(('{0:yyyy-MM-dd HH:mm:ss}' -f $t0), $gw, $inet, $wifiMbps, $wifiSig, $router.Route, $router.Link, $router.Load,
             $sl.Ms, $sl.Drop, $sl.Up, $sl.Obs, $sl.Upt, $obsLive, $feeds) -join ','
    Add-Content $csv $row -Encoding ASCII

    # One status line per tick; red flags the hop that is failing.
    $bad = if ($gw -eq '') { 'LAPTOP->ROUTER LOST' } elseif ($router.Route -eq 'none') { 'ROUTER LOST STARLINK' } elseif ($inet -eq '') { 'INTERNET PING LOST' } elseif ($sl.Drop -ne '' -and [double]$sl.Drop -ge 0.5) { 'STARLINK DROPPING' } else { '' }
    $line = '{0:HH:mm:ss}  router {1,4}ms  inet {2,4}ms  wifi {3,6}  SL {4,3}ms drop {5,5} up {6,6}k  OBS {7} feeds {8}' -f $t0, $gw, $inet, $wifiMbps, $sl.Ms, $sl.Drop, $sl.Up, $(if ($obsLive -eq 1) { 'LIVE' } elseif ($obs) { 'idle' } else { 'off ' }), $feeds
    Write-Host $line -ForegroundColor $(if ($bad) { 'Red' } else { 'Gray' }) -NoNewline
    Write-Host $(if ($bad) { "  $bad" } else { '' }) -ForegroundColor Red

    $tick++
    $wait = $IntervalSec - ((Get-Date) - $t0).TotalSeconds
    if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
}
