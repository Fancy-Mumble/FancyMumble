# bench-app.ps1
#
# Reproducible launch + idle-memory + idle-CPU benchmark for the
# released Fancy Mumble desktop app.
#
# Usage:
#   .\scripts\bench-app.ps1                       # Quick run (10s settle)
#   .\scripts\bench-app.ps1 -Settle 30            # Wait 30s before sampling
#   .\scripts\bench-app.ps1 -Label baseline       # Tag the run
#   .\scripts\bench-app.ps1 -Label after -Save    # Append to bench-history.csv
#
# Reports:
#   - cold start time-to-window-shown (ms)
#   - per-process WS / private MB / handle count / thread count
#   - 5s sustained idle CPU% across all app processes
#   - total commit charge, total handle count
#   - binary size
#
# Always kills any existing mumble-tauri / msedgewebview2 processes
# spawned by us before the run so the numbers are reproducible.

[CmdletBinding()]
param(
    [string]$Exe   = "$PSScriptRoot\..\target\release\mumble-tauri.exe",
    [int]   $Settle = 12,
    [int]   $CpuSample = 5,
    [string]$Label = "run",
    [switch]$Save
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) {
    throw "Release binary not found at $Exe.  Run `cargo tauri build --no-bundle` first."
}
$Exe = (Resolve-Path $Exe).Path

function Stop-AppProcs {
    Stop-Process -Name mumble-tauri,msedgewebview2 -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

function Get-Descendants($rootPid) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$rootPid"
    $all = @($children)
    foreach ($c in $children) {
        $all += Get-Descendants $c.ProcessId
    }
    return $all
}

Stop-AppProcs

Write-Host "==> Launching $Exe"
$launchStart = Get-Date
$proc = Start-Process -FilePath $Exe -PassThru
# Wait until the main window appears
$windowAppeared = $null
$timeout = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $timeout) {
    $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0) {
        $windowAppeared = Get-Date
        break
    }
    Start-Sleep -Milliseconds 100
}
if (-not $windowAppeared) {
    Stop-AppProcs
    throw "Main window never appeared within 20s"
}
$launchMs = [int]($windowAppeared - $launchStart).TotalMilliseconds
Write-Host "    cold-start time to window shown: $launchMs ms"

Write-Host "==> Settling $Settle s for renderer + WebView2 to finish initial work"
Start-Sleep -Seconds $Settle

$root = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)"
if (-not $root) {
    Stop-AppProcs
    throw "Root process disappeared during settle"
}
$tree = @($root) + (Get-Descendants $proc.Id)

# CPU sample
Write-Host "==> Sampling CPU for $CpuSample s"
$cpuBefore = @{}
foreach ($p in $tree) {
    $proc2 = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    if ($proc2) { $cpuBefore[$p.ProcessId] = $proc2.TotalProcessorTime.TotalMilliseconds }
}
Start-Sleep -Seconds $CpuSample
$logicalCpus = (Get-CimInstance Win32_Processor | Measure-Object NumberOfLogicalProcessors -Sum).Sum

$rows = foreach ($p in $tree) {
    $proc2 = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    if (-not $proc2) { continue }
    $prev = if ($cpuBefore.ContainsKey($p.ProcessId)) { $cpuBefore[$p.ProcessId] } else { 0 }
    $cpuMs = $proc2.TotalProcessorTime.TotalMilliseconds - $prev
    $cpuPct = [math]::Round(($cpuMs / ($CpuSample * 1000.0 * $logicalCpus)) * 100, 2)
    [PSCustomObject]@{
        PID      = $p.ProcessId
        Name     = $p.Name
        WS_MB    = [math]::Round($proc2.WorkingSet64    / 1MB, 1)
        Priv_MB  = [math]::Round($proc2.PrivateMemorySize64 / 1MB, 1)
        Handles  = $proc2.HandleCount
        Threads  = $proc2.Threads.Count
        CPUpct   = $cpuPct
    }
}

$rows | Format-Table -AutoSize

$total = [PSCustomObject]@{
    Label      = $Label
    Timestamp  = (Get-Date -Format 's')
    LaunchMs   = $launchMs
    Procs      = $rows.Count
    WS_MB      = [math]::Round(($rows | Measure-Object WS_MB    -Sum).Sum, 1)
    Priv_MB    = [math]::Round(($rows | Measure-Object Priv_MB  -Sum).Sum, 1)
    Handles    = ($rows | Measure-Object Handles -Sum).Sum
    Threads    = ($rows | Measure-Object Threads -Sum).Sum
    IdleCPUpct = [math]::Round(($rows | Measure-Object CPUpct  -Sum).Sum, 2)
    BinaryMB   = [math]::Round((Get-Item $Exe).Length / 1MB, 2)
}

Write-Host ""
Write-Host "===================== TOTAL ====================="
$total | Format-List
Write-Host "================================================="

if ($Save) {
    $csv = Join-Path $PSScriptRoot 'bench-history.csv'
    if (-not (Test-Path $csv)) {
        $total | Export-Csv -Path $csv -NoTypeInformation
    } else {
        $total | Export-Csv -Path $csv -NoTypeInformation -Append
    }
    Write-Host "Appended to $csv"
}

Stop-AppProcs
Write-Host "Test process killed."
