# What a release build holds on its first screens, against the bounds in
# MEMORY.md; exits 1 when any is over. Windows only (it reads the system's
# process and GPU counters).
#
#   tools\memory.ps1 -Exe target\release\fancy-gpui.exe [-Settle 20]
#
# Four runs, one after another, each on a new data directory of its own,
# with no sound, no tray icon, and the demo server named "memory-test":
# the connect screen (the real engine with nothing saved) and the demo
# server's screen, each in the default theme and in Nimbus. Each run is
# measured after `Settle` seconds and then stopped. A window shows for each
# run; nothing is posted to it.
#
# Commit (private bytes) is the figure that counts: the client trims its
# working set in the background (src/trim.rs), so the working set says
# little once it has, but the peak working set and the peak commit say what
# start-up took. GPU memory is the system's count for the process.
param(
    [Parameter(Mandatory)] [string]$Exe,
    [int]$Settle = 20
)

# Bounds in MB, from the figures in MEMORY.md with room for the window's
# size and the driver: commit after settling, peak commit, peak working
# set, GPU dedicated, GPU shared.
$bounds = @{
    "connect"        = @{ commit = 110; peakcommit = 160; peak = 120; gpuded = 45; gpushared = 15 }
    "connect nimbus" = @{ commit = 120; peakcommit = 170; peak = 130; gpuded = 70; gpushared = 25 }
    "server"         = @{ commit = 115; peakcommit = 165; peak = 130; gpuded = 45; gpushared = 15 }
    "server nimbus"  = @{ commit = 125; peakcommit = 170; peak = 130; gpuded = 70; gpushared = 20 }
}

$exe = (Resolve-Path $Exe).Path
$over = 0
foreach ($run in "connect", "connect nimbus", "server", "server nimbus") {
    $state, $theme = $run -split " "
    $data = Join-Path ([IO.Path]::GetTempPath()) ("fancy-gpui-memory-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Force $data | Out-Null
    $env:FANCY_GPUI_DATA_DIR = $data
    $env:FANCY_GPUI_DEMO_NAME = "memory-test"
    $env:FANCY_GPUI_SILENT = "1"
    $env:FANCY_GPUI_VOICE_MESSAGES = "silent"
    $env:FANCY_GPUI_TRAY = "off"
    $env:FANCY_GPUI_MODE = "dark"
    $env:FANCY_GPUI_THEME = $theme
    $env:FANCY_GPUI_ENGINE = $(if ($state -eq "server") { "demo" } else { $null })
    $env:FANCY_GPUI_DEMO = $(if ($state -eq "server") { "connected" } else { $null })
    $p = Start-Process -FilePath $exe -PassThru
    try {
        Start-Sleep -Seconds $Settle
        if ($p.HasExited) { throw "$run`: the client exited" }
        $gpu = @{ "dedicated usage" = 0.0; "shared usage" = 0.0 }
        $samples = (Get-Counter "\GPU Process Memory(pid_$($p.Id)_*)\Dedicated Usage", "\GPU Process Memory(pid_$($p.Id)_*)\Shared Usage" -ErrorAction SilentlyContinue).CounterSamples
        foreach ($sample in $samples) { $gpu[$sample.Path.Substring($sample.Path.LastIndexOf([char]92) + 1)] += $sample.CookedValue }
        $p.Refresh()
        $held = [ordered]@{
            commit     = [int]($p.PrivateMemorySize64 / 1MB)
            peakcommit = [int]($p.PeakPagedMemorySize64 / 1MB)
            peak       = [int]($p.PeakWorkingSet64 / 1MB)
            gpuded     = [int]($gpu["dedicated usage"] / 1MB)
            gpushared  = [int]($gpu["shared usage"] / 1MB)
        }
    } finally {
        if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force; [void]$p.WaitForExit(5000) }
        Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
    }
    $line = ($held.Keys | ForEach-Object {
        $mark = if ($held[$_] -gt $bounds[$run][$_]) { $over++; " OVER" } else { "" }
        "$_ $($held[$_])/$($bounds[$run][$_])$mark"
    }) -join ", "
    "{0,-15} {1}" -f $run, $line
}
if ($over) { "$over figure(s) over their bound (MB, held/bound)"; exit 1 }
"all within bounds (MB, held/bound)"
