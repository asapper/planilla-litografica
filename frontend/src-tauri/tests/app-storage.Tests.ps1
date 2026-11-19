# Proves that what the app keeps in its own storage on this PC (where the second copy of a session
# lives) survives what happens to a real install: the app closed and reopened, the app killed (a
# crash or a power cut), and the installer run again over the existing install (an upgrade).
# Installs the installer just built, drives the app through the WebView2 debugging port and throws
# on the first failure. Runs on the Windows build agent after the NSIS build.

param([string]$InstallerPath = '')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$installer = if ($InstallerPath) { Get-Item -LiteralPath $InstallerPath } else {
    Get-ChildItem (Join-Path $repo 'frontend\src-tauri\target\release\bundle\nsis\*.exe') | Select-Object -First 1
}
if (-not $installer) { throw 'No NSIS installer found: build the app first.' }

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

function Stop-Leftovers {
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and ($_.Path -like "$env:LOCALAPPDATA\CargadorDePlanilla\*" -or $_.Path -like "$env:ProgramFiles\CargadorDePlanilla\*")
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# The app passes its own WebView2 arguments, which override the environment variable; the WebView2
# policy for one executable overrides them instead. Set on this build agent only, never shipped.
$policy = 'HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'

function Start-App {
    $exe = App-Exe
    New-Item -Path $policy -Force | Out-Null
    New-ItemProperty -Path $policy -Name (Split-Path $exe -Leaf) -Value '--remote-debugging-port=9222' -PropertyType String -Force | Out-Null
    $p = Start-Process -FilePath $exe -PassThru
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        if (Test-NetConnection -ComputerName 127.0.0.1 -Port 9222 -InformationLevel Quiet -WarningAction SilentlyContinue) { return $p }
        if ($p.HasExited) { Show-Diagnostics; throw "The app exited at start (code $($p.ExitCode))." }
        Start-Sleep -Seconds 1
    }
    Show-Diagnostics
    throw 'The app did not open its WebView2 debugging port within 90 s.'
}

function Storage($action, $value) {
    Push-Location (Join-Path $repo 'frontend')
    try {
        $out = & node e2e/webview-storage.mjs $action $value 2>&1
        if ($LASTEXITCODE -ne 0) { throw "webview-storage.mjs $action failed: $out" }
        return ($out | Select-Object -Last 1).ToString().Trim()
    } finally { Pop-Location }
}

function Close-App($p) {
    # The window's close button: the app saves, stops its backend and exits.
    $null = $p.CloseMainWindow()
    Check ($p.WaitForExit(45000)) 'the app closed through its own close sequence'
    Stop-Leftovers
}

function Kill-App($p) {
    Stop-Process -Id $p.Id -Force
    $p.WaitForExit(15000) | Out-Null
    Stop-Leftovers
}

try {
    Install-App

    $app = Start-App
    Storage set 'closed-normally' | Write-Host
    Close-App $app
    $app = Start-App
    Check ((Storage get) -eq 'closed-normally') 'kept after the app is closed and reopened'

    Storage set 'before-a-crash' | Write-Host
    Start-Sleep -Seconds 10
    Kill-App $app
    $app = Start-App
    Check ((Storage get) -eq 'before-a-crash') 'kept after the app is killed 10 s after the write (a crash or a power cut)'

    # How soon a write is safe from a crash: reported, not required (the backend copy covers the gap).
    Storage set 'one-second-before-a-crash' | Write-Host
    Start-Sleep -Seconds 1
    Kill-App $app
    $app = Start-App
    $quick = Storage get
    Write-Host "info - a write 1 s before a kill is $(if ($quick -eq 'one-second-before-a-crash') { 'kept' } else { "lost (read back '$quick')" })"

    Storage set 'before-an-upgrade' | Write-Host
    Close-App $app
    Install-App
    $app = Start-App
    Check ((Storage get) -eq 'before-an-upgrade') 'kept after the installer runs again over the install (an upgrade)'
    Close-App $app
} finally {
    Stop-Leftovers
    Remove-Item -Path $policy -Recurse -Force -ErrorAction SilentlyContinue
}
