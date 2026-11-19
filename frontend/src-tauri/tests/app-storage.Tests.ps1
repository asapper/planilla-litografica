# Proves that what the app keeps in its own storage on this PC (where the second copy of a session
# lives) survives what happens to a real install: the app closed and reopened, the app's processes
# killed, and the installer run again over the existing install (an upgrade).
# Installs the given installer, drives the app through the WebView2 debugging port and throws on the
# first failure. Runs on the Windows build agent against the storage-test variant
# (tauri.storage-test.conf.json), which only adds the debugging port the test needs.

param([Parameter(Mandatory = $true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$installer = Get-Item -LiteralPath $InstallerPath
$port = 9222

function Show-Diagnostics {
    Write-Host '--- diagnostics'
    Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'planilla|cargador|msedgewebview2|java' } |
        ForEach-Object {
            $cmd = ("$($_.CommandLine)" -replace '\s+', ' ')
            if ($cmd -match '--type=') { $cmd = $cmd.Substring(0, [Math]::Min(160, $cmd.Length)) }
            Write-Host ("{0} {1} {2}" -f $_.ProcessId, $_.Name, $cmd)
        }
    netstat -ano | Select-String 'LISTENING' | Select-String '127.0.0.1|0.0.0.0' | ForEach-Object { Write-Host $_ }
    Write-Host '---'
}

function Check($ok, $what) {
    if (-not $ok) { throw "FAIL: $what" }
    Write-Host "ok - $what"
}

function Install-App {
    $p = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
    Check ($p.ExitCode -eq 0) "installer $($installer.Name) ran silently (exit $($p.ExitCode))"
}

function App-Exe {
    $dirs = @("$env:LOCALAPPDATA\CargadorDePlanilla", "$env:ProgramFiles\CargadorDePlanilla")
    foreach ($d in $dirs) {
        $exe = Get-ChildItem -Path $d -Filter *.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch 'uninstall' } | Select-Object -First 1
        if ($exe) { return $exe.FullName }
    }
    throw 'Installed app not found.'
}

function Port-Open {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

# The app's WebView2 processes run from the shared runtime, so they are found by the app's user-data folder.
function App-WebViews {
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'msedgewebview2.exe' -and "$($_.CommandLine)" -match 'com\.planilla\.lito'
    })
}

# A read right after a relaunch must come from the new browser, never from one still shutting down.
function Wait-Stopped {
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if (-not (Port-Open) -and (App-WebViews).Count -eq 0) { return }
        Start-Sleep -Milliseconds 500
    }
    Show-Diagnostics
    throw "The app's WebView2 is still running 60 s after the app stopped."
}

function Stop-Leftovers {
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and ($_.Path -like "$env:LOCALAPPDATA\CargadorDePlanilla\*" -or $_.Path -like "$env:ProgramFiles\CargadorDePlanilla\*")
    } | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Start-App {
    Wait-Stopped
    $p = Start-Process -FilePath (App-Exe) -PassThru
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        if (Port-Open) { return $p }
        if ($p.HasExited) { Show-Diagnostics; throw "The app exited at start (code $($p.ExitCode))." }
        Start-Sleep -Seconds 1
    }
    Show-Diagnostics
    throw 'The app did not open its WebView2 debugging port within 90 s.'
}

# Windows PowerShell 5.1 turns any stderr line of a native command into an error under 'Stop', so a
# Node warning would fail the job: only the exit code decides.
function Storage($action, $value) {
    $ErrorActionPreference = 'Continue'
    Push-Location (Join-Path $repo 'frontend')
    try {
        $out = & node e2e/webview-storage.mjs $action $value 2>&1
        if ($LASTEXITCODE -ne 0) { throw "webview-storage.mjs $action failed: $out" }
        return ($out | Select-Object -Last 1).ToString().Trim()
    } finally { Pop-Location }
}

# A newly started browser has no sessionStorage, so finding the canary set next to the marker means
# the read reached the old instance and proves nothing.
function Read-Marker {
    $r = Storage get | ConvertFrom-Json
    Check ($r.canary -eq '') 'the read comes from a newly started browser (its sessionStorage is empty)'
    return $r.marker
}

function Close-App($p) {
    # The window's close button: the app saves, stops its backend and exits.
    $null = $p.CloseMainWindow()
    Check ($p.WaitForExit(45000)) 'the app closed through its own close sequence'
    Stop-Leftovers
}

# The whole process tree at once (the app, its WebView2 browser and renderers, its backend), so
# WebView2 gets no chance to shut down cleanly and write its storage out.
function Kill-App($p) {
    $ErrorActionPreference = 'Continue'
    $out = & taskkill /F /T /PID $p.Id 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -ne 0) { Show-Diagnostics; throw "taskkill failed (exit $code): $out" }
    $deadline = (Get-Date).AddSeconds(5)
    while ((App-WebViews).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
    $left = App-WebViews
    if ($left.Count -gt 0) { Show-Diagnostics }
    Check ($left.Count -eq 0) "no WebView2 process of the app outlives the kill ($($left.Count) left)"
    Stop-Leftovers
}

try {
    Install-App

    $app = Start-App
    Storage set 'closed-normally' | Write-Host
    Close-App $app
    $app = Start-App
    Check ((Read-Marker) -eq 'closed-normally') 'kept after the app is closed and reopened'

    Storage set 'before-a-kill' | Write-Host
    Start-Sleep -Seconds 10
    Kill-App $app
    $app = Start-App
    Check ((Read-Marker) -eq 'before-a-kill') "kept after the app's processes are killed 10 s after the write"

    # How soon a write is safe from a kill: reported, not required (the backend copy covers the gap).
    Storage set 'one-second-before-a-kill' | Write-Host
    Start-Sleep -Seconds 1
    Kill-App $app
    $app = Start-App
    $quick = Read-Marker
    Write-Host "info - a write 1 s before a kill is $(if ($quick -eq 'one-second-before-a-kill') { 'kept' } else { "lost (read back '$quick')" })"

    Storage set 'before-an-upgrade' | Write-Host
    Close-App $app
    Install-App
    $app = Start-App
    Check ((Read-Marker) -eq 'before-an-upgrade') 'kept after the installer runs again over the install (an upgrade)'
    Close-App $app
} finally {
    Stop-Leftovers
}
