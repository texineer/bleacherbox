# Post-game report: reads the OBS log (plus the game-monitor CSV, router log and Starlink outage
# history when available) and writes logs\games\<date>\game-report.md. For every disconnect it
# names the hop that failed: laptop Wi-Fi, router-to-Starlink link, Starlink, or nothing local.
# Run right after the game, while still on Thundercats, so it can pull the router and dish logs.
#   powershell -ExecutionPolicy Bypass -File .\analyze-game.ps1 [-ObsLog <file>] [-NoFetch]
param([string]$ObsLog, [switch]$NoFetch)

$Router   = '172.16.100.1'
$Starlink = '192.168.100.1:9200'
$obsLogs  = "$env:APPDATA\obs-studio\logs"

if (-not $ObsLog) {
    $ObsLog = Get-ChildItem $obsLogs -Filter *.txt | Sort-Object LastWriteTime -Descending |
        Where-Object { Select-String -Path $_.FullName -Pattern 'Streaming Start' -SimpleMatch -Quiet } |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $ObsLog) { throw "No OBS log with a stream in $obsLogs" }
}
# OBS keeps its current log open; read it with sharing.
$fs = [IO.File]::Open($ObsLog, 'Open', 'Read', 'ReadWrite'); $sr = New-Object IO.StreamReader($fs)
$lines = $sr.ReadToEnd() -split "`r?`n"; $sr.Close()

$base = [datetime]::ParseExact(([IO.Path]::GetFileNameWithoutExtension($ObsLog)), 'yyyy-MM-dd HH-mm-ss', $null)
$outDir = Join-Path $PSScriptRoot ("logs\games\{0:yyyy-MM-dd}" -f $base)
New-Item -ItemType Directory -Force $outDir | Out-Null

# ---------------- Parse the OBS log ----------------
$day = $base.Date; $prev = $null
$sessions = [Collections.Generic.List[object]]::new(); $drops = [Collections.Generic.List[object]]::new()
$feedDown = @{}; $feedSpans = [Collections.Generic.List[object]]::new()
$audioLag = @{}; $scenes = @{}; $encLines = @(); $ifaces = [Collections.Generic.List[object]]::new()
$sendErr = 0; $failConn = 0; $maxBuf = 0
$cfg = 0; $res = ''; $live = $false; $up = $false; $cur = 0; $segT = $null; $sessStart = $null; $dropStart = $null
$minSec = @{}; $minKb = @{}; $secAt90 = 0; $secLow = 0; $kbSec = 0; $liveSec = 0

function Add-Span($t1, $t2, $v) {
    while ($t1 -lt $t2) {
        $m = $t1.Date.AddHours($t1.Hour).AddMinutes($t1.Minute)
        $e = $m.AddMinutes(1); if ($e -gt $t2) { $e = $t2 }
        $s = ($e - $t1).TotalSeconds; $k = $m.ToString('HH:mm')
        $script:minSec[$k] += $s; $script:minKb[$k] += $v * $s
        $script:liveSec += $s; $script:kbSec += $v * $s
        if ($v -ge 0.9 * $script:cfg) { $script:secAt90 += $s }
        if ($v -lt 1500) { $script:secLow += $s }
        $t1 = $e
    }
}
function Close-Seg($t) { if ($script:live -and $script:segT) { Add-Span $script:segT $t $(if ($script:up) { $script:cur } else { 0 }) }; $script:segT = $t }

foreach ($l in $lines) {
    if ($l -notmatch '^(\d\d):(\d\d):(\d\d)\.(\d{3}): (.*)$') { continue }
    $t = $day.AddHours([int]$Matches[1]).AddMinutes([int]$Matches[2]).AddSeconds([int]$Matches[3]).AddMilliseconds([int]$Matches[4])
    if ($prev -and $t -lt $prev.AddHours(-1)) { $day = $day.AddDays(1); $t = $t.AddDays(1) }
    $prev = $t; $msg = $Matches[5]

    if ($msg -match '^\s+bitrate:\s+(\d+)\s*$') { $cfg = [int]$Matches[1] }
    elseif ($msg -match 'output resolution:\s+(\S+)') { $res = $Matches[1] }
    elseif ($msg -match '==== Streaming Start') { $live = $true; $up = $true; $cur = $cfg; $segT = $t; $sessStart = $t }
    elseif ($msg -match '==== Streaming Stop') {
        Close-Seg $t
        if ($dropStart) { $drops.Add([pscustomobject]@{ Start = $dropStart; End = $t; Sec = [int]($t - $dropStart).TotalSeconds }); $dropStart = $null }
        if ($sessStart) { $sessions.Add([pscustomobject]@{ Start = $sessStart; End = $t }) }
        $live = $false; $sessStart = $null
    }
    elseif ($msg -match 'bitrate (increased|decreased) to: (\d+)') { Close-Seg $t; $cur = [int]$Matches[2] }
    elseif ($msg -match '\] Disconnected from ') { Close-Seg $t; $up = $false; if ($live) { $dropStart = $t } }
    elseif ($msg -match 'Connection to .* successful' -and $live -and -not $up) {
        Close-Seg $t; $up = $true; $cur = $cfg
        if ($dropStart) { $drops.Add([pscustomobject]@{ Start = $dropStart; End = $t; Sec = [int]($t - $dropStart).TotalSeconds }); $dropStart = $null }
    }
    elseif ($msg -match 'RTMP send error') { $sendErr++ }
    elseif ($msg -match 'Connection to .* failed|failed to connect socket') { $failConn++ }
    elseif ($msg -match '^Source (.+?) audio is lagging') { $audioLag[$Matches[1]]++ }
    elseif ($msg -match 'Max audio buffering reached') { $maxBuf++ }
    elseif ($msg -match "^\[Media Source '(.+?)'\]: Disconnected") { if (-not $feedDown[$Matches[1]]) { $feedDown[$Matches[1]] = $t } }
    elseif ($msg -match "^\[Media Source '(.+?)'\]: Reconnected") {
        $n = $Matches[1]; if ($feedDown[$n]) { $feedSpans.Add([pscustomobject]@{ Source = $n; Start = $feedDown[$n]; End = $t }); $feedDown.Remove($n) }
    }
    elseif ($msg -match "User switched to scene '(.+)'") { $scenes[$Matches[1]]++ }
    elseif ($msg -match 'skipped frames due to encoding lag|lagged frames due to rendering|Number of .*frames') { $encLines += "$('{0:HH:mm:ss}' -f $t) $($msg.Trim())" }
    elseif ($msg -match '\] Interface: (.+)$') { if (-not $ifaces.Count -or $ifaces[$ifaces.Count - 1].Text -ne $Matches[1]) { $ifaces.Add([pscustomobject]@{ Time = $t; Text = $Matches[1] }) } }
}
if ($live) { Close-Seg $prev; $sessions.Add([pscustomobject]@{ Start = $sessStart; End = $prev }) }
foreach ($n in $feedDown.Keys) { $feedSpans.Add([pscustomobject]@{ Source = $n; Start = $feedDown[$n]; End = $prev }) }
if (-not $sessions.Count) { throw "No stream session found in $ObsLog" }
function In-Live($t) { foreach ($s in $sessions) { if ($t -ge $s.Start -and $t -le $s.End) { return $true } }; $false }
function Live-Overlap($a, $b) {
    $sum = 0
    foreach ($s in $sessions) { $x = if ($a -gt $s.Start) { $a } else { $s.Start }; $y = if ($b -lt $s.End) { $b } else { $s.End }; if ($y -gt $x) { $sum += ($y - $x).TotalSeconds } }
    $sum
}

# ---------------- Monitor CSV, router log, Starlink history ----------------
$mon = @(Get-ChildItem $outDir -Filter 'monitor-*.csv' -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { Import-Csv $_.FullName } |
    ForEach-Object { $_ | Add-Member -NotePropertyName T -NotePropertyValue ([datetime]$_.time) -PassThru })

$routerEvents = @(); $slOutages = @()
if (-not $NoFetch) {
    $rlog = ssh -o BatchMode=yes -o ConnectTimeout=5 "root@$Router" 'cat /root/syslog.log.old /root/syslog.log 2>/dev/null' 2>$null
    if ($LASTEXITCODE -eq 0 -and $rlog) {
        $rlog | Set-Content (Join-Path $outDir 'router-syslog.txt') -Encoding UTF8
        $routerEvents = foreach ($l in $rlog) {
            if ($l -match '^\w{3} (\w{3}) +(\d+) (\d\d:\d\d:\d\d) (\d{4}) (.*)$' -and $Matches[5] -match 'netifd|eth0|wan|udhcpc|link is|carrier|kernel.*(up|down)') {
                $t = [datetime]::ParseExact("$($Matches[1]) $($Matches[2]) $($Matches[4]) $($Matches[3])", 'MMM d yyyy HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
                if ($t -ge $sessions[0].Start.AddMinutes(-15) -and $t -le $sessions[$sessions.Count - 1].End) { [pscustomobject]@{ Time = $t; Text = $Matches[5] } }
            }
        }
    }
    $grpcurl = (Get-Command grpcurl -ErrorAction SilentlyContinue).Source
    if ($grpcurl) {
        $j = & $grpcurl -plaintext -max-time 6 -d '{\"get_history\":{}}' $Starlink SpaceX.API.Device.Device/Handle 2>$null
        if ($LASTEXITCODE -eq 0 -and $j) {
            $j | Set-Content (Join-Path $outDir 'starlink-history.json') -Encoding UTF8
            $gps0 = [datetime]'1980-01-06'
            $slOutages = foreach ($o in (($j -join "`n") | ConvertFrom-Json).dishGetHistory.outages) {
                $s = $gps0.AddSeconds([double]$o.startTimestampNs / 1e9 - 18).ToLocalTime()
                $e = $s.AddSeconds([double]$o.durationNs / 1e9)
                if ($e -ge $sessions[0].Start -and $s -le $sessions[$sessions.Count - 1].End) { [pscustomobject]@{ Start = $s; End = $e; Cause = $o.cause } }
            }
        }
    }
}

# ---------------- Name the failing hop for each disconnect ----------------
foreach ($d in $drops) {
    $w = @($mon | Where-Object { $_.T -ge $d.Start.AddSeconds(-30) -and $_.T -le $d.Start.AddSeconds(5) })
    $slHit = $slOutages | Where-Object { $_.Start -le $d.Start.AddSeconds(5) -and $_.End -ge $d.Start.AddSeconds(-30) } | Select-Object -First 1
    $cause = ''; $ev = ''
    if (@($w | Where-Object { $_.gw_ms -eq '' -and $_.wifi_mbps -ne '' }).Count) {
        $cause = 'Laptop Wi-Fi / LAN'; $ev = "router ping lost in $(@($w | Where-Object gw_ms -eq '').Count) of $($w.Count) samples"
    } elseif (@($w | Where-Object { $_.wan_route -eq 'none' -or $_.wan_link -eq '0' }).Count) {
        $cause = 'Router lost Starlink (WAN)'; $ev = 'no default route or no WAN link on the Slate 7'
    } elseif ($slHit) {
        $cause = 'Starlink outage'; $ev = "dish logged $($slHit.Cause) $('{0:HH:mm:ss}' -f $slHit.Start), $([int]($slHit.End - $slHit.Start).TotalSeconds) s"
    } elseif (@($w | Where-Object { $_.sl_drop -ne '' -and [double]$_.sl_drop -ge 0.3 }).Count -or @($w | Where-Object sl_obstructed -eq '1').Count) {
        $peak = (@($w | Where-Object sl_drop -ne '' | ForEach-Object { [double]$_.sl_drop }) | Measure-Object -Maximum).Maximum
        $cause = 'Starlink (drops/obstruction)'; $ev = "dish ping drop up to $([math]::Round(100 * $peak))%"
    } elseif (@($w | Where-Object { $_.inet_ms -eq '' -and $_.gw_ms -ne '' }).Count) {
        $cause = 'Internet past the router (Starlink)'; $ev = 'router answered, 1.1.1.1 did not'
    } elseif ($w.Count) {
        $cause = 'No local fault seen'; $ev = 'all hops answered; upstream congestion or GameChanger side'
    } else { $cause = 'No monitor data'; $ev = 'game-monitor.ps1 was not running' }
    $d | Add-Member -NotePropertyName Cause -NotePropertyValue $cause
    $d | Add-Member -NotePropertyName Evidence -NotePropertyValue $ev
}

# ---------------- Write the report ----------------
$first = $sessions[0].Start; $last = $sessions[$sessions.Count - 1].End
$window = ($sessions | ForEach-Object { ($_.End - $_.Start).TotalSeconds } | Measure-Object -Sum).Sum
$downSec = ($drops | Measure-Object Sec -Sum).Sum; if (-not $downSec) { $downSec = 0 }
$avgKb = if ($liveSec) { [int]($kbSec / $liveSec) } else { 0 }
$pct = { param($s) [math]::Round(100 * $s / [math]::Max(1, $liveSec)) }
$fmtDur = { param($s) '{0}h {1:00}m' -f [int][math]::Floor($s / 3600), [int][math]::Floor(($s % 3600) / 60) }

$md = [Collections.Generic.List[string]]::new()
$md.Add("# Game report $('{0:yyyy-MM-dd}' -f $base)"); $md.Add('')
$md.Add("Live $('{0:HH:mm}' -f $first) to $('{0:HH:mm}' -f $last) ($(& $fmtDur $window)), $res, configured $cfg kbps. $($drops.Count) disconnects, $([math]::Round($downSec / 60, 1)) min off air ($([math]::Round(100 * (1 - $downSec / [math]::Max(1, $window)), 1))% uptime)."); $md.Add('')
$md.Add('## Bitrate'); $md.Add('')
$md.Add("- Average sent: **$avgKb kbps** of $cfg configured")
$md.Add("- At 90%+ of configured: $(& $pct $secAt90)% of live time")
$md.Add("- Under 1500 kbps (soft picture): $(& $pct $secLow)% of live time")
$md.Add("- RTMP send errors: $sendErr; failed connection attempts: $failConn")
$md.Add('- Per-minute averages: `bitrate-by-minute.csv`'); $md.Add('')

$md.Add('## Disconnects'); $md.Add('')
if ($drops.Count) {
    $md.Add('| Start | Off air | Failing hop | Evidence |'); $md.Add('| --- | --- | --- | --- |')
    foreach ($d in $drops) { $md.Add("| $('{0:HH:mm:ss}' -f $d.Start) | $($d.Sec) s | $($d.Cause) | $($d.Evidence) |") }
    $md.Add('')
    $byCause = $drops | Group-Object Cause | Sort-Object Count -Descending | ForEach-Object { "$($_.Name): $($_.Count) ($(($_.Group | Measure-Object Sec -Sum).Sum) s)" }
    $md.Add("By hop: $($byCause -join '; ')"); $md.Add('')
} else { $md.Add('None.'); $md.Add('') }

$md.Add('## Camera feeds (time dark while live)'); $md.Add('')
$md.Add('| Feed | Drops while live | Dark while live |'); $md.Add('| --- | --- | --- |')
foreach ($g in $feedSpans | Group-Object Source | Sort-Object Name) {
    $sec = ($g.Group | ForEach-Object { Live-Overlap $_.Start $_.End } | Measure-Object -Sum).Sum
    $n = @($g.Group | Where-Object { (Live-Overlap $_.Start $_.End) -gt 0 }).Count
    $md.Add("| $($g.Name) | $n | $([math]::Round($sec / 60, 1)) min |")
}
$md.Add('')

$md.Add('## Audio'); $md.Add('')
if ($audioLag.Count) { foreach ($k in $audioLag.Keys) { $md.Add("- $k audio lagging and restarted: $($audioLag[$k]) times") } } else { $md.Add('- No audio lag events') }
if ($maxBuf) { $md.Add("- OBS hit max audio buffering $maxBuf time(s): adds up to about 1 s of delay") }
$md.Add('')

if ($mon.Count) {
    $lm = @($mon | Where-Object { In-Live $_.T })
    $loss = { param($col) [math]::Round(100 * @($lm | Where-Object { $_.$col -eq '' }).Count / [math]::Max(1, $lm.Count), 1) }
    $slRows = @($lm | Where-Object sl_drop -ne '')
    $wifiRates = @($lm | Where-Object { $_.wifi_mbps -match '^[\d.]+$' } | ForEach-Object { [double]$_.wifi_mbps })
    $md.Add('## Network while live (game monitor)'); $md.Add('')
    $md.Add("- Laptop -> router ping lost: $(& $loss 'gw_ms')% of $($lm.Count) samples")
    $md.Add("- Internet ping lost: $(& $loss 'inet_ms')%")
    if ($wifiRates.Count) { $md.Add("- Laptop Wi-Fi link: min $(($wifiRates | Measure-Object -Minimum).Minimum), median $(($wifiRates | Sort-Object)[[int]($wifiRates.Count / 2)]) Mbps") }
    else { $md.Add('- Laptop wired') }
    $md.Add("- Router without Starlink (no route / WAN link): $(@($lm | Where-Object { $_.wan_route -eq 'none' -or $_.wan_link -eq '0' }).Count) samples")
    if ($slRows.Count) {
        $md.Add("- Starlink ping drop: avg $([math]::Round(100 * (@($slRows | ForEach-Object { [double]$_.sl_drop }) | Measure-Object -Average).Average, 1))%, samples with 30%+ drop: $(@($slRows | Where-Object { [double]$_.sl_drop -ge 0.3 }).Count); obstructed samples: $(@($slRows | Where-Object sl_obstructed -eq '1').Count)")
        $up = @($slRows | Where-Object sl_uptime_s -ne '' | ForEach-Object { [double]$_.sl_uptime_s })
        for ($i = 1; $i -lt $up.Count; $i++) { if ($up[$i] -lt $up[$i - 1]) { $md.Add("- **Starlink rebooted** near $('{0:HH:mm:ss}' -f $slRows[$i].T)") } }
    } else { $md.Add('- Starlink dish API not reachable during the game') }
    $md.Add('')
} else { $md.Add('## Network while live'); $md.Add(''); $md.Add('No game-monitor data: start it with start-game.ps1 so drops can be pinned on a hop.'); $md.Add('') }

if ($slOutages) {
    $md.Add('## Starlink outages (dish history)'); $md.Add(''); $md.Add('| Start | Length | Cause |'); $md.Add('| --- | --- | --- |')
    foreach ($o in $slOutages) { $md.Add("| $('{0:HH:mm:ss}' -f $o.Start) | $([math]::Round(($o.End - $o.Start).TotalSeconds, 1)) s | $($o.Cause) |") }
    $md.Add('')
}
if ($routerEvents) {
    $md.Add('## Router WAN events'); $md.Add('')
    foreach ($e in $routerEvents | Select-Object -Last 40) { $md.Add("- $('{0:HH:mm:ss}' -f $e.Time) $($e.Text)") }
    $md.Add('')
}
if ($ifaces.Count) { $md.Add('## Laptop network interface (from OBS)'); $md.Add(''); foreach ($i in $ifaces) { $md.Add("- $('{0:HH:mm:ss}' -f $i.Time) $($i.Text)") }; $md.Add('') }
$md.Add('## Encoder'); $md.Add('')
if ($encLines) { foreach ($e in $encLines) { $md.Add("- $e") } } else { $md.Add('- No encoding or rendering lag reported') }
$md.Add('')
if ($scenes.Count) { $md.Add('## Scene switches'); $md.Add(''); foreach ($k in $scenes.Keys | Sort-Object) { $md.Add("- $k : $($scenes[$k])") }; $md.Add('') }
$md.Add("Source: $([IO.Path]::GetFileName($ObsLog))$(if ($mon.Count) { ", $($mon.Count) monitor samples" })")

$report = Join-Path $outDir 'game-report.md'
$md | Set-Content $report -Encoding UTF8
'minute,avg_kbps' | Set-Content (Join-Path $outDir 'bitrate-by-minute.csv') -Encoding ASCII
foreach ($k in $minSec.Keys | Sort-Object) { Add-Content (Join-Path $outDir 'bitrate-by-minute.csv') "$k,$([int]($minKb[$k] / [math]::Max(1, $minSec[$k])))" -Encoding ASCII }

Write-Host ''
Write-Host $md[2] -ForegroundColor White
Write-Host "Average $avgKb kbps of $cfg; under 1500 kbps $(& $pct $secLow)% of the time."
foreach ($d in $drops) { Write-Host ('  {0:HH:mm:ss}  {1,4} s  {2}' -f $d.Start, $d.Sec, $d.Cause) -ForegroundColor $(if ($d.Sec -ge 60) { 'Red' } else { 'Yellow' }) }
Write-Host ''
Write-Host "Report: $report"
