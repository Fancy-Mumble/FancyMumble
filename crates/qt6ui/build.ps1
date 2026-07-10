# Build helper for qt6ui.
#
# qt6ui must be built with the GNU (MinGW) Rust toolchain against the MinGW
# Qt 6 kit, because MSVC and MinGW use incompatible C++ ABIs and only the
# MinGW Qt kit is installed on this machine.
#
# Usage:
#   .\build.ps1                # debug build
#   .\build.ps1 --release      # optimised, size-tuned build
#   .\build.ps1 run            # build + run (pass 'run' as first arg)
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)] $Rest)

$ErrorActionPreference = "Stop"

# --- Locate the Qt kit + its matching MinGW toolchain ---------------------
$Qt    = if ($env:QT6_MINGW_DIR) { $env:QT6_MINGW_DIR } else { "C:\Qt\6.10.0\mingw_64" }
$Mingw = if ($env:QT6_MINGW_GCC) { $env:QT6_MINGW_GCC } else { "C:\Qt\Tools\mingw1310_64" }

if (-not (Test-Path "$Qt\bin\qmake.exe"))  { throw "qmake not found under $Qt (set QT6_MINGW_DIR)" }
if (-not (Test-Path "$Mingw\bin\g++.exe")) { throw "g++ not found under $Mingw (set QT6_MINGW_GCC)" }

# cxx-qt-build finds Qt via qmake; the MinGW g++ must be first on PATH so both
# the C++ glue and the final Rust link use the Qt-compatible compiler.
$env:QMAKE = "$Qt\bin\qmake.exe"
$env:PATH  = "$Mingw\bin;$Qt\bin;$env:PATH"

$run = $false
$cargoArgs = @()
foreach ($a in $Rest) {
    if ($a -eq "run") { $run = $true } else { $cargoArgs += $a }
}
$verb = if ($run) { "run" } else { "build" }

Write-Host "qt6ui: cargo $verb (gnu toolchain, Qt at $Qt)" -ForegroundColor Cyan
& cargo "+stable-x86_64-pc-windows-gnu" $verb @cargoArgs
