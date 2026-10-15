# Pre-game system check: laptop, Slate 7, internet, Starlink, cameras, CPE510s, relay, OBS.
#   powershell -ExecutionPolicy Bypass -File .\check-system.ps1            # at home
#   powershell -ExecutionPolicy Bypass -File .\check-system.ps1 -Field     # at the field (stricter)
#   add -SpeedTest for the network tests (~90 s): ping quality, laptop->router throughput,
#   and sustained upload measured from the router AND the laptop, to tell Starlink from Wi-Fi.
#   or -UploadMbps <n> to pick the OBS profile from an upload you measured elsewhere (Starlink app).
param([switch]$Field, [switch]$SpeedTest, [double]$UploadMbps)

$Router   = '172.16.100.1'
$Ssid     = 'Thundercats'
$LaptopIp = '172.16.100.10'
# Camera MAC addresses live in site.local.json (not in git; copy site.example.json). Without them
# the check still runs but skips the per-camera Wi-Fi association lines.
$site = try { Get-Content (Join-Path $PSScriptRoot 'site.local.json') -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $null }
function Get-SiteMac($k) { if ($site -and $site.macs.$k) { "$($site.macs.$k)".ToLower() } else { '' } }
$Cameras  = [ordered]@{
    'Beav (Mevo 3B)' = @{ Mac = (Get-SiteMac 'beav'); Ip = '172.16.100.51'; Kind = 'mevo'; Key = 'mevo1' }
    'Trey (Mevo 1B)' = @{ Mac = (Get-SiteMac 'trey'); Ip = '172.16.100.52'; Kind = 'mevo'; Key = 'mevo2' }
    'VM35 (CF)'      = @{ Mac = (Get-SiteMac 'vm35'); Ip = '172.16.100.50'; Kind = 'vm35' }
}
$Cpes = [ordered]@{ 'CPE510 home plate' = '172.16.100.2'; 'CPE510 centerfield' = '172.16.100.3' }
$Nano = @{ Ip = '172.16.100.4'; Ssid = 'beaver-nano' }   # NanoStation M5 at home plate, AP for the VM35
$Starlink = '192.168.100.1:9200'                           # dish gRPC API, reached through the Slate's WAN
$AudioMic = 'Cam - Mevo 3B'                                # the one OBS source that should be unmuted
$UpUrl    = 'https://speed.cloudflare.com/__up'

$results = [System.Collections.Generic.List[object]]::new()
function Add-Result($Area, $Item, $Status, $Detail) {
    $results.Add([pscustomobject]@{ Area = $Area; Item = $Item; Status = $Status; Detail = $Detail })
}
function Test-Port($Ip, $Port, $TimeoutMs = 800) {
    $c = New-Object Net.Sockets.TcpClient
    try { return $c.ConnectAsync($Ip, $Port).Wait($TimeoutMs) } catch { return $false } finally { $c.Close() }
}
function Test-Ping($Ip) { Test-Connection $Ip -Count 2 -Quiet -ErrorAction SilentlyContinue }
function Find-Tool($exe) {
    $cmd = Get-Command $exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "$exe.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
# Pings in the background (so router and internet can run side by side); Read-PingRun waits and summarizes.
function Start-PingRun($Ip, $Count) {
    $f = [IO.Path]::GetTempFileName()
    $p = Start-Process ping -ArgumentList "-n $Count -w 1000 $Ip" -RedirectStandardOutput $f -NoNewWindow -PassThru
    @{ Proc = $p; File = $f; Count = $Count }
}
function Read-PingRun($run) {
    $run.Proc.WaitForExit()
    $ms = @(foreach ($l in Get-Content $run.File) { if ($l -match 'time[=<](\d+)ms') { [int]$Matches[1] } })
    Remove-Item $run.File -ErrorAction SilentlyContinue
    $jit = 0; for ($i = 1; $i -lt $ms.Count; $i++) { $jit += [math]::Abs($ms[$i] - $ms[$i - 1]) }
    [pscustomobject]@{
        LossPct = [math]::Round(100 * ($run.Count - $ms.Count) / $run.Count, 1)
        Avg     = $(if ($ms.Count) { [int]($ms | Measure-Object -Average).Average } else { 0 })
        Max     = $(if ($ms.Count) { ($ms | Measure-Object -Maximum).Maximum } else { 0 })
        Jitter  = $(if ($ms.Count -gt 1) { [int]($jit / ($ms.Count - 1)) } else { 0 })
    }
}
# Upload samples are fixed-size POSTs that must complete, so socket buffering can't inflate them.
# Each sample is sized from the previous one to last about 4 s.
function Get-UploadStats($samples) {
    $s = @($samples | Select-Object -Skip 1 | Sort-Object)   # first sample is the 2 MB warm-up
    if (-not $s.Count) { return $null }
    [pscustomobject]@{ Min = $s[0]; Median = $s[[int][math]::Floor($s.Count / 2)]; Count = $s.Count }
}
function Measure-LaptopUpload {
    $bytes = 2000000
    foreach ($i in 1..6) {
        $f = Join-Path $env:TEMP 'baseball-upload.bin'
        [IO.File]::WriteAllBytes($f, (New-Object byte[] $bytes))
        $o = & curl.exe -s -o NUL -m 20 -X POST --data-binary "@$f" -H 'Content-Type: application/octet-stream' -w '%{size_upload} %{time_total}' $UpUrl
        if ("$o" -match '^(\d+)\S* ([\d.]+)' -and [double]$Matches[2] -gt 0) {
            $bps = [double]$Matches[1] / [double]$Matches[2]
            [math]::Round($bps * 8 / 1e6, 1)
            $bytes = [int][math]::Min(40e6, [math]::Max(1e6, $bps * 4))
        }
    }
    Remove-Item (Join-Path $env:TEMP 'baseball-upload.bin') -ErrorAction SilentlyContinue
}
function Measure-RouterUpload {
    # No double quotes in here: Windows PowerShell 5.1 mangles them when passing args to ssh.
    $sh = 'command -v curl >/dev/null || { echo NOCURL; exit 0; }; n=2000000; for i in 1 2 3 4 5 6; do r=$(head -c $n /dev/zero | curl -s -m 20 -o /dev/null -X POST --data-binary @- -H ''Content-Type: application/octet-stream'' -w ''%{size_upload} %{time_total}'' ' + $UpUrl + '); echo $r; n=$(echo $r | awk ''{ s = 2000000; if ($2 > 0) s = $1 / $2 * 4; if (s < 1000000) s = 1000000; if (s > 40000000) s = 40000000; print int(s) }''); done'
    $out = ssh -o BatchMode=yes -o ConnectTimeout=6 "root@$Router" $sh 2>$null
    if ("$out" -match 'NOCURL') { return 'NOCURL' }
    foreach ($l in $out) { if ($l -match '^(\d+)\S* ([\d.]+)' -and [double]$Matches[2] -gt 0) { [math]::Round([double]$Matches[1] * 8 / [double]$Matches[2] / 1e6, 1) } }
}
function Invoke-Starlink($Request) {
    $g = Find-Tool 'grpcurl'
    if (-not $g) { return 'NOTOOL' }
    # Passed as an argument with \" escapes: Windows PowerShell 5.1 strips bare quotes from native
    # args, and piping it in adds a BOM that grpcurl rejects.
    $json = & $g -plaintext -max-time 4 -d ($Request -replace '"', '\"') $Starlink SpaceX.API.Device.Device/Handle 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    ($json -join "`n") | ConvertFrom-Json
}

# ---------------- Laptop ----------------
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object IPAddress -like '172.16.100.*' | Select-Object -First 1
if (-not $lanIp) {
    Add-Result 'Laptop' 'On Slate 7 network' 'FAIL' "No 172.16.100.x address. Join '$Ssid' or plug into the Slate 7."
} else {
    $alias = $lanIp.InterfaceAlias
    if ($lanIp.IPAddress -eq $LaptopIp) { Add-Result 'Laptop' 'IP address' 'PASS' "$LaptopIp on $alias" }
    else { Add-Result 'Laptop' 'IP address' 'WARN' "$($lanIp.IPAddress) on $alias (expected $LaptopIp; Mevos point there). Wired adapter needs its own reservation." }

    $adapter = Get-NetAdapter -InterfaceAlias $alias -ErrorAction SilentlyContinue
    if ($adapter.PhysicalMediaType -match '802\.11|Wireless') {
        $wl = netsh wlan show interfaces
        $ssidNow = (($wl | Select-String '^\s+SSID\s+:') -replace '.*:\s*', '' | Select-Object -First 1)
        $signal  = (($wl | Select-String '^\s+Signal\s+:') -replace '.*:\s*', '' | Select-Object -First 1)
        $ok = if ($ssidNow -eq $Ssid) { 'PASS' } else { 'FAIL' }
        Add-Result 'Laptop' 'Wi-Fi' $ok "SSID '$ssidNow', signal $signal"
        if ($Field) { Add-Result 'Laptop' 'Connection type' 'WARN' 'On Wi-Fi. Plug into the Slate 7 with a USB-C Ethernet adapter at the field.' }
    } else {
        Add-Result 'Laptop' 'Connection type' 'PASS' "Wired ($alias)"
    }

    $prof = Get-NetConnectionProfile -InterfaceAlias $alias -ErrorAction SilentlyContinue
    if ($prof.NetworkCategory -eq 'Private') { Add-Result 'Laptop' 'Network type' 'PASS' 'Private' }
    else { Add-Result 'Laptop' 'Network type' 'WARN' "$($prof.NetworkCategory) (should be Private)" }
}

$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($bat) {
    if ($bat.BatteryStatus -eq 2) { Add-Result 'Laptop' 'Power' 'PASS' "On AC, battery $($bat.EstimatedChargeRemaining)%" }
    else { Add-Result 'Laptop' 'Power' 'WARN' "ON BATTERY ($($bat.EstimatedChargeRemaining)%). Plug in for the game." }
}
$freeGb = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
# Relay saves each camera raw (~2-3 GB/camera/hour, 3 cameras) plus any OBS recording: a doubleheader needs ~25 GB.
Add-Result 'Laptop' 'Disk space (recordings)' $(if ($freeGb -ge 30) { 'PASS' } elseif ($freeGb -ge 15) { 'WARN' } else { 'FAIL' }) "$freeGb GB free on C: (raw camera recordings use about 7-9 GB per hour; kept 7 days in Videos\Baseball\raw)"

# ---------------- Slate 7 + Wi-Fi ----------------
$leases = @(); $assoc = @{}; $sshOk = $false
if (-not (Test-Ping $Router)) {
    Add-Result 'Slate 7' 'Router reachable' 'FAIL' "$Router not answering"
} else {
    Add-Result 'Slate 7' 'Router reachable' 'PASS' $Router
    $remote = 'echo @@LOAD; cat /proc/loadavg; echo @@UP; cat /proc/uptime; echo @@LEASES; cat /tmp/dhcp.leases; echo @@A5; iwinfo wlan1 assoclist; echo @@A2; iwinfo wlan0 assoclist; echo @@I5; iwinfo wlan1 info; echo @@ROUTE; ip route show default; echo @@WANC; cat /sys/class/net/eth0/carrier; echo @@LANC; cat /sys/class/net/eth1/carrier; echo @@LOGF; uci -q get system.@system[0].log_file; echo @@END'
    $out = ssh -o BatchMode=yes -o ConnectTimeout=6 "root@$Router" $remote 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) {
        $sshOk = $true
        $sec = @{}; $cur = $null
        foreach ($line in $out) { if ($line -match '^@@(\w+)$') { $cur = $Matches[1]; $sec[$cur] = @() } elseif ($cur) { $sec[$cur] += $line } }

        $load = ($sec.LOAD -split ' ')[0]; $upH = [math]::Round(([double](($sec.UP -split ' ')[0])) / 3600, 1)
        Add-Result 'Slate 7' 'Health' $(if ([double]$load -lt 2) { 'PASS' } else { 'WARN' }) "load $load, up $upH h"

        $route = "$($sec.ROUTE)"
        $wan = if ($route -match 'dev (\S+)') { $Matches[1] } else { '' }
        if (-not $wan) { Add-Result 'Slate 7' 'Internet source' 'FAIL' 'No default route. Is Starlink connected?' }
        elseif ($wan -like 'sta*') {
            $st = if ($Field) { 'WARN' } else { 'PASS' }
            Add-Result 'Slate 7' 'Internet source' $st "Wi-Fi repeater ($wan). At the field use Starlink on the WAN port instead."
        } else { Add-Result 'Slate 7' 'Internet source' 'PASS' "Wired WAN ($wan)" }
        if ($Field -and "$($sec.WANC)".Trim() -ne '1') { Add-Result 'Slate 7' 'WAN port link' 'FAIL' 'No link on the WAN port. Check the Starlink Ethernet adapter cable and Starlink power.' }

        if ("$($sec.LANC)".Trim() -eq '1') { Add-Result 'Slate 7' 'LAN port link' 'PASS' 'up (NanoStation injector)' }
        else { Add-Result 'Slate 7' 'LAN port link' $(if ($Field) { 'FAIL' } else { 'SKIP' }) 'No link. Plug the PoE injector LAN cable into the Slate 7 LAN port.' }

        $logFile = "$($sec.LOGF)".Trim()
        if ($logFile) { Add-Result 'Slate 7' 'Log saved to flash' 'PASS' "$logFile (survives a reboot)" }
        else { Add-Result 'Slate 7' 'Log saved to flash' 'WARN' 'Off, so a reboot erases the evidence. Run setup-router-logging.ps1' }

        $chan = if ("$($sec.I5)" -match 'Channel: (\d+)') { [int]$Matches[1] } else { 0 }
        if ($Field -and $chan -ne 36) { Add-Result 'Slate 7' '5 GHz channel' 'WARN' "Channel $chan. Set fixed channel 36 at the field (CPE link uses 149/157)." }
        else { Add-Result 'Slate 7' '5 GHz channel' 'PASS' "Channel $chan" }

        $leases = foreach ($l in $sec.LEASES) { $p = $l -split ' '; if ($p.Count -ge 3) { [pscustomobject]@{ Mac = $p[1].ToLower(); Ip = $p[2] } } }
        foreach ($band in 'A5', 'A2') {
            foreach ($l in $sec[$band]) {
                if ($l -match '^([0-9A-Fa-f:]{17})\s+(-?\d+) dBm') { $assoc[$Matches[1].ToLower()] = @{ Signal = [int]$Matches[2]; Band = $(if ($band -eq 'A5') { '5 GHz' } else { '2.4 GHz' }) } }
            }
        }
        $total = $assoc.Count
        Add-Result 'Slate 7' "Wi-Fi '$Ssid'" $(if ($total -gt 0) { 'PASS' } else { 'WARN' }) "$total device(s) connected"
    } else {
        Add-Result 'Slate 7' 'SSH access' 'WARN' "SSH to root@$Router failed; Wi-Fi/DHCP checks skipped."
    }
}

# ---------------- Internet ----------------
if (Test-Ping '1.1.1.1') {
    $ms = [int](Test-Connection 1.1.1.1 -Count 4 | Measure-Object ResponseTime -Average).Average
    Add-Result 'Internet' 'Connectivity' $(if ($ms -lt 100) { 'PASS' } else { 'WARN' }) "ping 1.1.1.1 avg $ms ms"
    try { $null = Resolve-DnsName gc.com -ErrorAction Stop -QuickTimeout; Add-Result 'Internet' 'DNS' 'PASS' 'resolves' } catch { Add-Result 'Internet' 'DNS' 'FAIL' 'name lookup failed' }
} else {
    Add-Result 'Internet' 'Connectivity' 'FAIL' 'No internet (ping 1.1.1.1 failed)'
}

# ---------------- Network tests (-SpeedTest) ----------------
# Each hop is measured on its own so a weak stream can be pinned on Wi-Fi, the Slate 7, or Starlink.
$upLaptop = $null; $upRouter = $null
if ($SpeedTest -and (Test-Ping '1.1.1.1')) {
    Write-Host 'Running network tests (about 90 s)...' -ForegroundColor DarkGray
    $onSlate = [bool]$lanIp
    $pr = if ($onSlate) { Start-PingRun $Router 30 }
    $pi = Start-PingRun '1.1.1.1' 30
    if ($pr) {
        $r = Read-PingRun $pr
        $st = if ($r.LossPct -eq 0 -and $r.Max -lt 100) { 'PASS' } elseif ($r.LossPct -le 2) { 'WARN' } else { 'FAIL' }
        Add-Result 'Network tests' 'Laptop -> router (30 s)' $st "loss $($r.LossPct)%, avg $($r.Avg) ms, max $($r.Max) ms. Loss here = laptop Wi-Fi/cable."
    }
    $r = Read-PingRun $pi
    $st = if ($r.LossPct -le 1 -and $r.Max -lt 300) { 'PASS' } elseif ($r.LossPct -le 4) { 'WARN' } else { 'FAIL' }
    Add-Result 'Network tests' 'Internet ping (30 s)' $st "loss $($r.LossPct)%, avg $($r.Avg) ms, max $($r.Max) ms, jitter $($r.Jitter) ms"

    if ($onSlate -and $sshOk) {
        $f = Join-Path $env:TEMP 'baseball-lan.bin'
        [IO.File]::WriteAllBytes($f, (New-Object byte[] 20000000))
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $p = Start-Process ssh -ArgumentList "-o BatchMode=yes -o ConnectTimeout=6 root@$Router cat >/dev/null" -RedirectStandardInput $f -NoNewWindow -Wait -PassThru
        $sec2 = $sw.Elapsed.TotalSeconds; Remove-Item $f -ErrorAction SilentlyContinue
        if ($p.ExitCode -eq 0) {
            $mbps = [math]::Round(160 / $sec2, 0)
            Add-Result 'Network tests' 'Laptop -> router speed' $(if ($mbps -ge 40) { 'PASS' } elseif ($mbps -ge 15) { 'WARN' } else { 'FAIL' }) "$mbps Mbps (20 MB over SSH; only needs to beat the stream by a wide margin)"
        } else { Add-Result 'Network tests' 'Laptop -> router speed' 'WARN' 'SSH copy failed' }

        $samples = @(Measure-RouterUpload)
        if ($samples -contains 'NOCURL') { Add-Result 'Network tests' 'Router upload (Starlink)' 'WARN' 'curl not installed on the Slate 7' }
        else {
            $upRouter = Get-UploadStats $samples
            if ($upRouter) {
                $st = if ($upRouter.Min -ge 8) { 'PASS' } elseif ($upRouter.Min -ge 5) { 'WARN' } else { 'FAIL' }
                Add-Result 'Network tests' 'Router upload (Starlink)' $st "min $($upRouter.Min), median $($upRouter.Median) Mbps over $($upRouter.Count) samples. Measured on the Slate 7, no Wi-Fi involved."
            } else { Add-Result 'Network tests' 'Router upload (Starlink)' 'FAIL' 'test failed (no internet from the router?)' }
        }
    }

    $upLaptop = Get-UploadStats @(Measure-LaptopUpload)
    if ($upLaptop) {
        $st = if ($upLaptop.Min -ge 8) { 'PASS' } elseif ($upLaptop.Min -ge 5) { 'WARN' } else { 'FAIL' }
        Add-Result 'Network tests' 'Laptop upload (stream path)' $st "min $($upLaptop.Min), median $($upLaptop.Median) Mbps over $($upLaptop.Count) samples"
    } else { Add-Result 'Network tests' 'Laptop upload (stream path)' 'FAIL' 'test failed' }

    if ($upLaptop -and $upRouter) {
        $where = if ($upLaptop.Median -lt 0.6 * $upRouter.Median) { "the laptop's link (Wi-Fi). Router gets $($upRouter.Median) Mbps, laptop only $($upLaptop.Median). Plug the laptop in." }
                 else { "Starlink itself (router and laptop see about the same upload)." }
        Add-Result 'Network tests' 'Upload limited by' 'INFO' $where
    }
}

# ---------------- Starlink ----------------
$sl = Invoke-Starlink '{"get_status":{}}'
if ($sl -eq 'NOTOOL') {
    Add-Result 'Starlink' 'Dish status' 'WARN' 'grpcurl not installed: winget install fullstorydev.grpcurl'
} elseif (-not $sl) {
    Add-Result 'Starlink' 'Dish status' $(if ($Field) { 'WARN' } else { 'SKIP' }) "API at $Starlink not answering (Starlink not on the WAN port?)"
} else {
    $d = $sl.dishGetStatus
    $upMin = [math]::Round([double]$d.deviceState.uptimeS / 60)
    Add-Result 'Starlink' 'Dish status' 'PASS' "$($d.deviceInfo.hardwareVersion), up $upMin min$(if ($upMin -lt 60) { ' (rebooted recently)' })"
    $obs_ = [math]::Round(100 * [double]$d.obstructionStats.fractionObstructed, 2)
    $st = if ($d.obstructionStats.currentlyObstructed) { 'WARN' } elseif ($obs_ -le 0.5) { 'PASS' } elseif ($obs_ -le 3) { 'WARN' } else { 'FAIL' }
    Add-Result 'Starlink' 'Obstruction' $st "$obs_% of sky blocked$(if ($d.obstructionStats.currentlyObstructed) { ', obstructed RIGHT NOW' }). Move the dish if over 0.5% (Starlink app -> Check for obstructions)."
    $drop = [math]::Round(100 * [double]$d.popPingDropRate, 1)
    Add-Result 'Starlink' 'Latency / drops now' $(if ($drop -le 1) { 'PASS' } else { 'WARN' }) "$([math]::Round([double]$d.popPingLatencyMs)) ms, $drop% ping drop"
    $alerts = @($d.alerts.PSObject.Properties | Where-Object Value -eq $true | Select-Object -ExpandProperty Name)
    Add-Result 'Starlink' 'Alerts' $(if ($alerts.Count) { 'WARN' } else { 'PASS' }) $(if ($alerts.Count) { $alerts -join ', ' } else { 'none' })

    $h = (Invoke-Starlink '{"get_history":{}}').dishGetHistory
    if ($h) {
        $drops = @($h.popPingDropRate | ForEach-Object { [double]$_ })
        $outSec = @($drops | Where-Object { $_ -ge 1 }).Count
        $avg = if ($drops.Count) { [math]::Round(100 * ($drops | Measure-Object -Average).Average, 1) } else { 0 }
        $st = if ($outSec -le 5) { 'PASS' } elseif ($outSec -le 30) { 'WARN' } else { 'FAIL' }
        Add-Result 'Starlink' 'Last 15 min' $st "$outSec s fully down, $avg% avg ping drop. A few seconds per 15 min is normal; more means obstruction or congestion."
        $nowGps = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - 315964800 + 18) * 1e9
        $recent = @($h.outages | Where-Object { [double]$_.startTimestampNs -gt $nowGps - 3600e9 })
        if ($recent.Count) {
            $causes = ($recent | Group-Object cause | ForEach-Object { "$($_.Count)x $($_.Name)" }) -join ', '
            Add-Result 'Starlink' 'Outages, last hour' $(if ($recent.Count -le 2) { 'INFO' } else { 'WARN' }) "$($recent.Count): $causes"
        }
    }
}

# ---------------- Cameras ----------------
$relayPubs = @(Get-NetTCPConnection -LocalPort 1935 -State Established -ErrorAction SilentlyContinue | Select-Object -ExpandProperty RemoteAddress)
foreach ($name in $Cameras.Keys) {
    $cam = $Cameras[$name]
    $lease = $leases | Where-Object Mac -eq $cam.Mac | Select-Object -First 1
    $ip = if ($lease) { $lease.Ip } else { $cam.Ip }
    $wifi = $assoc[$cam.Mac]

    if ($sshOk) {
        if (-not $cam.Mac) {
            Add-Result $name 'Wi-Fi' 'SKIP' 'No MAC for this camera in site.local.json'
        } elseif ($wifi) {
            $st = if ($wifi.Signal -ge -70) { 'PASS' } else { 'WARN' }
            Add-Result $name 'Wi-Fi' $st "$($wifi.Band), $($wifi.Signal) dBm"
        } elseif ($cam.Kind -eq 'vm35') {
            Add-Result $name 'Wi-Fi' 'PASS' 'Not on Thundercats (expected: it connects through the NanoStation beaver-nano)'
        } else {
            Add-Result $name 'Wi-Fi' 'FAIL' "Not connected to '$Ssid'. Power it on / join Wi-Fi in the Mevo app."
        }
    }
    if ($ip -ne $cam.Ip) { Add-Result $name 'IP address' 'WARN' "$ip (reserved $($cam.Ip); switches next time it rejoins)" }

    if (-not (Test-Ping $ip)) { Add-Result $name 'Reachable' 'FAIL' "$ip not answering"; continue }
    Add-Result $name 'Reachable' 'PASS' $ip

    if ($cam.Kind -eq 'mevo') {
        if ($relayPubs -contains $ip) {
            Add-Result $name 'Streaming to relay' 'PASS' "live on key $($cam.Key)"
            $ffprobe = Find-Tool 'ffprobe'
            if ($ffprobe) {
                $info = & $ffprobe -v error -rtsp_transport tcp -timeout 5000000 -select_streams v:0 -show_entries stream=width,height,avg_frame_rate -of csv=p=0 "rtsp://127.0.0.1:8554/live/$($cam.Key)" 2>$null
                if ($info -match '^(\d+),(\d+),(\d+)/(\d+)') {
                    $res = "$($Matches[1])x$($Matches[2]) @ $([math]::Round([double]$Matches[3] / [double]$Matches[4]))fps"
                    Add-Result $name 'Video' $(if ([int]$Matches[2] -ge 720) { 'PASS' } else { 'WARN' }) $res
                }
            }
        } else { Add-Result $name 'Streaming to relay' 'WARN' "Not live. Mevo app: Go Live, Custom RTMP rtmp://$LaptopIp`:1935/live key $($cam.Key)" }
    } else {
        if (-not (Test-Port $ip 554 1500)) { Add-Result $name 'RTSP port 554' 'FAIL' 'closed. Camera still booting?'; continue }
        $pulling = Get-NetTCPConnection -RemoteAddress $ip -RemotePort 554 -State Established -ErrorAction SilentlyContinue | Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name -eq 'mediamtx' }
        $released = try { (Invoke-RestMethod 'http://127.0.0.1:9997/v3/config/paths/get/vm35' -TimeoutSec 2).source -eq 'publisher' } catch { $false }
        Add-Result $name 'Relay pulling RTSP' $(if ($pulling) { 'PASS' } else { 'WARN' }) $(if ($pulling) { 'connected' } elseif ($released) { 'RELEASED for the NearStream app. Close the app, then run vm35-resume.ps1' } else { 'Relay not connected (is MediaMTX running?)' })
        $ffprobe = Find-Tool 'ffprobe'
        if ($ffprobe) {
            $info = & $ffprobe -v error -rtsp_transport tcp -timeout 5000000 -select_streams v:0 -show_entries stream=width,height,avg_frame_rate -of csv=p=0 "rtsp://$ip`:554/live/mainstream" 2>$null
            if ($info -match '^(\d+),(\d+),(\d+)/(\d+)') {
                $res = "$($Matches[1])x$($Matches[2]) @ $([math]::Round([double]$Matches[3] / [double]$Matches[4]))fps"
                Add-Result $name 'Video' $(if ($Matches[2] -eq '1080') { 'PASS' } else { 'WARN' }) $(if ($Matches[2] -eq '1080') { $res } else { "$res (set 1080p in NearStream app, then restart camera)" })
            } else { Add-Result $name 'Video' 'WARN' 'Could not read stream info' }
        }
    }
}

# ---------------- CPE510 bridge ----------------
# The NanoStation replaced the CPE510 pair (2026-10-04); only expect the CPEs when it isn't there.
$nanoUp = Test-Ping $Nano.Ip
foreach ($name in $Cpes.Keys) {
    $ip = $Cpes[$name]
    if (Test-Ping $ip) { Add-Result 'CPE510 bridge' $name 'PASS' $ip }
    elseif ($nanoUp) { Add-Result 'CPE510 bridge' $name 'SKIP' "$ip not answering (not used: NanoStation carries the CF link)" }
    elseif ($Field) { Add-Result 'CPE510 bridge' $name 'FAIL' "$ip not answering (power / PoE injector / aim)" }
    else { Add-Result 'CPE510 bridge' $name 'SKIP' "$ip not answering (OK if not set up yet)" }
}

# ---------------- NanoStation (CF link) ----------------
if (Test-Ping $Nano.Ip) {
    $web = Test-Port $Nano.Ip 443
    Add-Result 'NanoStation (CF link)' 'Reachable' 'PASS' "$($Nano.Ip)$(if ($web) { ', settings page up' })"
    $vm = $Cameras['VM35 (CF)']
    if ($sshOk) {
        if ($vm.Mac -and $assoc[$vm.Mac]) { Add-Result 'NanoStation (CF link)' 'VM35 on beaver-nano' 'WARN' "VM35 is on Thundercats instead. Switch it to '$($Nano.Ssid)' in the NearStream app." }
        elseif (Test-Ping $vm.Ip) { Add-Result 'NanoStation (CF link)' 'VM35 on beaver-nano' 'PASS' "VM35 reachable and not on Thundercats, so it's on '$($Nano.Ssid)' (signal: NanoStation Stations page)" }
        else { Add-Result 'NanoStation (CF link)' 'VM35 on beaver-nano' 'FAIL' "VM35 not reachable on either network. Off, or can't join '$($Nano.Ssid)' (wrong password, or airMAX still on)." }
    }
} else {
    $st = if ($Field) { 'FAIL' } else { 'SKIP' }
    Add-Result 'NanoStation (CF link)' 'Reachable' $st "$($Nano.Ip) not answering (injector power / cable to Slate LAN port)"
}

# ---------------- Laptop software ----------------
$mtx = Get-Process mediamtx -ErrorAction SilentlyContinue
if ($mtx) {
    $listen = Get-NetTCPConnection -OwningProcess $mtx.Id -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique
    $ok = ($listen -contains 1935) -and ($listen -contains 8554)
    Add-Result 'Software' 'MediaMTX relay' $(if ($ok) { 'PASS' } else { 'FAIL' }) "running, listening on $(($listen | Sort-Object) -join ', ')"
} else { Add-Result 'Software' 'MediaMTX relay' 'FAIL' 'Not running. Run start-game.ps1' }

$fw = Get-NetFirewallRule -DisplayName 'MediaMTX RTMP (Mevo)' -ErrorAction SilentlyContinue
Add-Result 'Software' 'Firewall rule (port 1935)' $(if ($fw -and $fw.Enabled -eq 'True') { 'PASS' } else { 'FAIL' }) $(if ($fw) { "enabled=$($fw.Enabled)" } else { 'missing. Run install-obs-config.ps1' })

$obs = Get-Process obs64 -ErrorAction SilentlyContinue
if ($obs) {
    $conns = @(Get-NetTCPConnection -OwningProcess $obs.Id -State Established -ErrorAction SilentlyContinue)
    $feeds = @($conns | Where-Object { $_.RemotePort -eq 8554 -and $_.RemoteAddress -like '127.*' }).Count
    Add-Result 'Software' 'OBS camera feeds' $(if ($feeds -ge 3) { 'PASS' } elseif ($feeds -gt 0) { 'WARN' } else { 'FAIL' }) "$feeds of 3 feeds connected"
    $live = $conns | Where-Object { $_.RemoteAddress -notlike '127.*' -and $_.RemoteAddress -notlike '172.16.*' -and $_.RemoteAddress -notlike '::*' -and $_.RemotePort -in 443, 1935 }
    Add-Result 'Software' 'OBS stream' 'INFO' $(if ($live) { "LIVE (connected to $($live[0].RemoteAddress))" } else { 'not streaming' })
    $ui = Get-Content "$env:APPDATA\obs-studio\user.ini" -ErrorAction SilentlyContinue
    $prof = ($ui | Select-String '^Profile=') -replace 'Profile=', ''; $coll = ($ui | Select-String '^SceneCollection=') -replace 'SceneCollection=', ''
    Add-Result 'Software' 'OBS profile / scenes' $(if ($prof -in 'GameChanger', 'GameChanger 720' -and $coll -eq 'Baseball') { 'PASS' } else { 'WARN' }) "profile '$prof', scenes '$coll'"
} else { Add-Result 'Software' 'OBS' 'WARN' 'Not running. Run start-game.ps1' }

$mon = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object CommandLine -match 'game-monitor\.ps1'
Add-Result 'Software' 'Game monitor' $(if ($mon) { 'PASS' } elseif ($obs) { 'WARN' } else { 'INFO' }) $(if ($mon) { 'running (logs every 5 s for analyze-game.ps1)' } else { 'not running. start-game.ps1 starts it' })

# ---------------- OBS settings ----------------
# Read from OBS's saved files. OBS rewrites the scene file on changes and on exit.
# Two profiles: 'GameChanger' (1080p 4500 kbps) and 'GameChanger 720' (720p 3000 kbps); -SpeedTest picks one.
$obsDir = "$env:APPDATA\obs-studio\basic"
function Read-ObsProfile($dir) {
    $ini = @{}; $sect = ''
    foreach ($l in Get-Content "$obsDir\profiles\$dir\basic.ini" -ErrorAction SilentlyContinue) {
        if ($l -match '^\[(.+)\]$') { $sect = $Matches[1] } elseif ($l -match '^([^=]+)=(.*)$') { $ini["$sect.$($Matches[1])"] = $Matches[2] }
    }
    $enc = Get-Content "$obsDir\profiles\$dir\streamEncoder.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
    if (-not $ini.Count -or -not $enc) { return $null }
    [pscustomobject]@{ Name = $ini['General.Name']; Ini = $ini; Enc = $enc; Total = [int]$enc.bitrate + [int]$ini['AdvOut.Track1Bitrate'] }
}
$userIni = Get-Content "$env:APPDATA\obs-studio\user.ini" -ErrorAction SilentlyContinue
$activeDir = (($userIni | Select-String '^ProfileDir=') -replace 'ProfileDir=', '' | Select-Object -First 1)
if (-not $activeDir) { $activeDir = 'GameChanger' }
$active = Read-ObsProfile $activeDir
if ($active) {
    $ini = $active.Ini; $enc = $active.Enc; $kbps = [int]$enc.bitrate; $total = $active.Total
    Add-Result 'OBS settings' 'Output' 'INFO' "profile '$($active.Name)': $($ini['Video.OutputCX'])x$($ini['Video.OutputCY']) @ $($ini['Video.FPSCommon']) fps, $($enc.rate_control) $kbps kbps, $($enc.preset)"
    # Router and laptop samples run a minute apart and Starlink swings, so plan for the worse of the two.
    $up = if ($upLaptop -and $upRouter) { if ($upRouter.Min -lt $upLaptop.Min) { $upRouter } else { $upLaptop } }
          elseif ($upLaptop) { $upLaptop } elseif ($upRouter) { $upRouter } elseif ($UploadMbps) { [pscustomobject]@{ Min = $UploadMbps } }
    if ($up) {
        # Keep the stream to about 60% of the worst sample: Starlink upload swings a lot.
        $safe = [int]([math]::Floor($up.Min * 1000 * 0.6 / 250) * 250)
        $p1080 = Read-ObsProfile 'GameChanger'; $p720 = Read-ObsProfile 'GameChanger_720'
        $pick = if ($p1080 -and $safe -ge $p1080.Total) { $p1080 } elseif ($p720) { $p720 }
        if ($pick) {
            $st = if ($pick.Name -eq $active.Name) { 'PASS' } else { 'WARN' }
            $why = "upload min $($up.Min) Mbps, safe about $safe kbps; 1080p needs $($p1080.Total)"
            Add-Result 'OBS settings' 'Profile for today' $st $(if ($st -eq 'PASS') { "'$($pick.Name)' ($why)" } else { "Use '$($pick.Name)': OBS menu Profile -> $($pick.Name), then paste today's stream key ($why)" })
        }
        $st = if ($total -le $safe) { 'PASS' } else { 'WARN' }
        $tip = if ($total -gt $safe) { " Even 720p is over: lower its bitrate to about $([math]::Max(1000, $safe - 128)) kbps, or fix the upload (Starlink view, wire the laptop)." } else { '' }
        Add-Result 'OBS settings' 'Bitrate vs upload' $st "stream needs $total kbps; safe for measured upload is about $safe kbps.$(if ($pick -and $pick.Name -ne $active.Name -and $pick.Total -le $safe) { ' Switching profile fixes it.' } else { $tip })"
    } else { Add-Result 'OBS settings' 'Profile for today' 'INFO' 'Run with -SpeedTest to pick 1080p or 720p from the measured upload' }
    $dyn = $ini['Output.DynamicBitrate'] -eq 'true'; $rec = $ini['Output.Reconnect'] -eq 'true'
    Add-Result 'OBS settings' 'Dynamic bitrate / reconnect' $(if ($dyn -and $rec) { 'PASS' } else { 'WARN' }) "dynamic bitrate $(if ($dyn) { 'on' } else { 'OFF' }), auto-reconnect $(if ($rec) { 'on' } else { 'OFF' })"
}
$scenes = Get-Content "$obsDir\scenes\Baseball.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
if ($scenes) {
    $camSrc = @($scenes.sources | Where-Object id -eq 'ffmpeg_source')
    $unmuted = @($camSrc | Where-Object { -not $_.muted } | Select-Object -ExpandProperty name)
    $ok = ($unmuted.Count -eq 1) -and ($unmuted[0] -eq $AudioMic)
    Add-Result 'OBS settings' 'Audio' $(if ($ok) { 'PASS' } else { 'WARN' }) $(if ($ok) { "only '$AudioMic' unmuted (ambient mic)" } elseif (-not $unmuted.Count) { "ALL cameras muted: the stream has no sound. Unmute '$AudioMic' in the OBS mixer." } else { "unmuted: $($unmuted -join ', '). Only '$AudioMic' should be." })
}

# ---------------- Report ----------------
$colors = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red'; SKIP = 'DarkGray'; INFO = 'Cyan' }
Write-Host ''
Write-Host ("Baseball stream check  {0:yyyy-MM-dd HH:mm}  {1}" -f (Get-Date), $(if ($Field) { '(field mode)' } else { '(home mode)' })) -ForegroundColor White
foreach ($grp in $results | Group-Object Area) {
    Write-Host ''
    Write-Host $grp.Name -ForegroundColor White
    foreach ($r in $grp.Group) {
        Write-Host ('  [{0}] ' -f $r.Status) -ForegroundColor $colors[$r.Status] -NoNewline
        Write-Host ('{0,-26} {1}' -f $r.Item, $r.Detail)
    }
}
$fails = @($results | Where-Object Status -eq 'FAIL').Count
$warns = @($results | Where-Object Status -eq 'WARN').Count
Write-Host ''
$summaryColor = if ($fails) { 'Red' } elseif ($warns) { 'Yellow' } else { 'Green' }
Write-Host ("Summary: {0} pass, {1} warn, {2} fail" -f @($results | Where-Object Status -eq 'PASS').Count, $warns, $fails) -ForegroundColor $summaryColor
exit $fails
