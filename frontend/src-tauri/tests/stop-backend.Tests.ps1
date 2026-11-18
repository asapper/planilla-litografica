# Runs stop-backend.ps1 against real processes on Windows. A fake JVM (a console exe
# that sleeps) is copied to two installs' jre\bin\java.exe; each case starts them and
# checks that only the install named by PLANILLA_INSTDIR loses its process, however
# that path is spelled. Throws on the first failure.

$ErrorActionPreference = 'Stop'
$script = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\stop-backend.ps1')).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ("planilla-stop-" + [guid]::NewGuid())
$own = Join-Path $root "O'Brien [x] año\Cargador"
$other = Join-Path $root 'other\Cargador'
$empty = Join-Path $root 'empty'
$started = New-Object System.Collections.ArrayList
$drive = $null

function Check($ok, $what) {
    if (-not $ok) { throw "FAIL: $what" }
    Write-Host "ok - $what"
}

function Start-Fake($exe) {
    $p = [Diagnostics.Process]::Start($exe)
    [void]$started.Add($p)
    Start-Sleep -Milliseconds 300
    Check (-not $p.HasExited) "fake JVM started from $exe"
    $p
}

$script:lastOutput = ''
function Stop-Backend($instdir, [switch]$Encoded) {
    $env:PLANILLA_INSTDIR = $instdir
    # Stderr from the child is captured as data, not raised.
    $ErrorActionPreference = 'Continue'
    try {
        if ($Encoded) {
            $code = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([IO.File]::ReadAllText($script)))
            $script:lastOutput = (& powershell -NoProfile -NonInteractive -EncodedCommand $code 2>&1) -join "`n"
        } else {
            $script:lastOutput = (& powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script 2>&1) -join "`n"
        }
        if ($script:lastOutput) { Write-Host $script:lastOutput }
        $LASTEXITCODE
    } finally {
        Remove-Item Env:PLANILLA_INSTDIR -ErrorAction SilentlyContinue
    }
}

function Gone($p) { $p.WaitForExit(3000) | Out-Null; $p.HasExited }

try {
    $fakeExe = Join-Path ([IO.Path]::GetTempPath()) ("fake-jvm-" + [guid]::NewGuid() + '.exe')
    Add-Type -OutputType ConsoleApplication -OutputAssembly $fakeExe -TypeDefinition @'
public static class FakeJvm { public static void Main() { System.Threading.Thread.Sleep(600000); } }
'@
    foreach ($dir in @($own, $other)) {
        [void][IO.Directory]::CreateDirectory((Join-Path $dir 'jre\bin'))
        [IO.File]::Copy($fakeExe, (Join-Path $dir 'jre\bin\java.exe'))
    }
    [void][IO.Directory]::CreateDirectory($empty)
    $ownJava = Join-Path $own 'jre\bin\java.exe'
    $otherJava = Join-Path $other 'jre\bin\java.exe'

    Check ((Stop-Backend '') -eq 2) 'no install path: exit 2'

    $theirs = Start-Fake $otherJava

    $p = Start-Fake $ownJava
    Check ((Stop-Backend $empty) -eq 0) 'an install with no java.exe: exit 0'
    Check (-not $p.HasExited) '... and our backend is left running'

    Check ((Stop-Backend $own) -eq 0) "path with ' [ ] and non-ASCII: exit 0"
    Check (Gone $p) '... and our backend is stopped'
    Check (-not $theirs.HasExited) "... and the other install's backend is not"

    $p = Start-Fake $ownJava
    Check ((Stop-Backend ($own.ToUpperInvariant() + '\')) -eq 0) 'different case and a trailing backslash: exit 0'
    Check (Gone $p) '... and our backend is stopped'

    $link = Join-Path $root 'link'
    cmd /c mklink /J "$link" "$own" | Out-Null
    Check (Test-Path -LiteralPath (Join-Path $link 'jre\bin\java.exe')) 'junction created'
    $p = Start-Fake (Join-Path $link 'jre\bin\java.exe')
    Check ((Stop-Backend $own) -eq 0) 'backend started through a junction: exit 0'
    Check (Gone $p) '... and it is stopped'
    $p = Start-Fake $ownJava
    Check ((Stop-Backend $link) -eq 0) 'install path given as the junction: exit 0'
    Check (Gone $p) '... and our backend is stopped'

    $drive = ('QRSTUVWXYZ'.ToCharArray() | Where-Object { -not (Test-Path "$($_):\") } | Select-Object -First 1)
    subst "$($drive):" "$own"
    Check (Test-Path "$($drive):\jre\bin\java.exe") "subst drive $($drive): created"
    $p = Start-Fake $ownJava
    Check ((Stop-Backend "$($drive):\") -eq 0) 'install at a (subst) drive root: exit 0'
    Check (Gone $p) '... and our backend is stopped'
    Check (-not $theirs.HasExited) "... and the other install's backend is not"

    $short = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($own).ShortPath
    if ($short -ne $own) {
        $p = Start-Fake $ownJava
        Check ((Stop-Backend $short) -eq 0) "install path as an 8.3 short name ($short): exit 0"
        Check (Gone $p) '... and our backend is stopped'
    } else {
        Write-Host 'skip - 8.3 names are disabled on this volume'
    }

    $savedTemp = $env:TEMP, $env:TMP
    $env:TEMP = $env:TMP = Join-Path $root 'no-such-temp'
    try {
        $p = Start-Fake $ownJava
        Check ((Stop-Backend $own) -eq 0) 'Add-Type blocked (no temp folder): exit 0'
        Check ($script:lastOutput -match 'matching by path') '... reported as the path fallback'
        Check (Gone $p) '... and our backend is stopped by path'
        Check (-not $theirs.HasExited) "... and the other install's backend is not"
        Check ((Stop-Backend $empty) -eq 0) '... and an install with no java.exe still exits 0'
    } finally {
        $env:TEMP, $env:TMP = $savedTemp
    }

    $p = Start-Fake $ownJava
    Check ((Stop-Backend $own -Encoded) -eq 0) 'run as -EncodedCommand, the way the app runs it: exit 0'
    Check ($script:lastOutput -notmatch 'CLIXML|matching by path') '... with no progress records or fallback in its output'
    Check (Gone $p) '... and our backend is stopped'
    Check (-not $theirs.HasExited) "the other install's backend survived every case"
} finally {
    foreach ($p in $started) { if (-not $p.HasExited) { $p.Kill() } }
    if ($drive) { subst "$($drive):" /D }
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    if ($fakeExe) { Remove-Item -LiteralPath $fakeExe -Force -ErrorAction SilentlyContinue }
}
