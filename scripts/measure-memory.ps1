# Measure the working set / private memory of a process tree.
# Usage: .\measure-memory.ps1 -RootPid 1234 [-Label "visible"]
param(
    [Parameter(Mandatory = $true)][int]$RootPid,
    [string]$Label = ""
)

$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name

# Collect the root and all (transitive) children.
$treeIds = New-Object System.Collections.Generic.HashSet[int]
$null = $treeIds.Add($RootPid)
$added = $true
while ($added) {
    $added = $false
    foreach ($p in $all) {
        if ($treeIds.Contains([int]$p.ParentProcessId) -and -not $treeIds.Contains([int]$p.ProcessId)) {
            $null = $treeIds.Add([int]$p.ProcessId)
            $added = $true
        }
    }
}

$rows = foreach ($procId in $treeIds) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($null -ne $proc) {
        [PSCustomObject]@{
            Pid          = $procId
            Name         = $proc.Name
            WorkingSetMB = [math]::Round($proc.WorkingSet64 / 1MB, 1)
            PrivateMB    = [math]::Round($proc.PrivateMemorySize64 / 1MB, 1)
        }
    }
}

if ($Label) { Write-Output "=== $Label ===" }
$rows | Sort-Object WorkingSetMB -Descending | Format-Table -AutoSize | Out-String
$wsTotal = [math]::Round(($rows | Measure-Object WorkingSetMB -Sum).Sum, 1)
$privTotal = [math]::Round(($rows | Measure-Object PrivateMB -Sum).Sum, 1)
Write-Output "TOTAL: workingSet=$($wsTotal)MB private=$($privTotal)MB processes=$($rows.Count)"
