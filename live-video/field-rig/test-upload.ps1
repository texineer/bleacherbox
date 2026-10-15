# Can ONE connection hold a stream's bitrate? OBS sends RTMP over a single TCP connection at a
# steady rate, so this uploads at a capped rate (like OBS) and reports how much of it got through.
# 100% = it kept up; less = the connection fell behind, which in OBS means dropped bitrate/disconnects.
#   powershell -ExecutionPolicy Bypass -File .\test-upload.ps1 [-Kbps 2000,3000,4500] [-Seconds 45]
param([string]$Kbps = '2000,3000,4500', [int]$Seconds = 45)   # string: -File passes '500,1000' as one token
$rates = @($Kbps -split ',' | ForEach-Object { [int]$_ })

$url = 'https://speed.cloudflare.com/__up'
$cc = ((netsh int tcp show supplemental | Select-String 'Congestion Control Provider' | Select-Object -First 1) -replace '.*:\s*', '').Trim()
Write-Host ("Upload test {0:HH:mm:ss}, TCP congestion control: {1}" -f (Get-Date), $cc) -ForegroundColor White

$rows = foreach ($k in $rates) {
    $bytes = [int]($k * 1000 / 8 * $Seconds)
    $f = Join-Path $env:TEMP "baseball-paced-$k.bin"
    [IO.File]::WriteAllBytes($f, (New-Object byte[] $bytes))
    $o = & curl.exe -s -o NUL -m ($Seconds * 4) --limit-rate "$([int]($k * 1000 / 8))" -X POST --data-binary "@$f" -H 'Content-Type: application/octet-stream' -w '%{size_upload} %{time_total}' $url
    Remove-Item -LiteralPath $f -ErrorAction SilentlyContinue
    if ("$o" -match '^(\d+)\S* ([\d.]+)') {
        $got = [double]$Matches[1] * 8 / [double]$Matches[2] / 1000
        $pct = [math]::Round(100 * $got / $k)
        $st = if ($pct -ge 97) { 'HOLDS' } elseif ($pct -ge 85) { 'MARGINAL' } else { 'FAILS' }
        Write-Host ('  {0,5} kbps for {1} s: got {2,5} kbps ({3,3}%)  {4}' -f $k, $Seconds, [int]$got, $pct, $st) -ForegroundColor $(switch ($st) { 'HOLDS' { 'Green' } 'MARGINAL' { 'Yellow' } default { 'Red' } })
        [pscustomobject]@{ Time = (Get-Date); CC = $cc; Kbps = $k; GotKbps = [int]$got; Pct = $pct }
    } else { Write-Host "  $k kbps: test failed" -ForegroundColor Red }
}
$log = Join-Path $PSScriptRoot ("logs\upload-tests-{0:yyyy-MM-dd}.csv" -f (Get-Date))
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$rows | Export-Csv $log -Append -NoTypeInformation
Write-Host "Saved to $log" -ForegroundColor DarkGray
