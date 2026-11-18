# Stops the backend JVM bundled with one install: $env:PLANILLA_INSTDIR\jre\bin\java.exe.
# Used by the installer hook (installer-hooks.nsh) and by the app at startup (lib.rs).
#
# A process is ours when its executable is the same file as that java.exe, compared by
# volume serial and file index, not by path text: an 8.3 short name (PROGRA~1), a
# junction, a subst drive or a different case all name the same file, while another
# install's java.exe is a different file even under an identical-looking path.
#
# Comparing file identities needs Add-Type (the C# compiler and a writable temp folder).
# Where that is blocked, it falls back to comparing the full path text, as before.
#
# Exit codes: 0 no bundled backend is running (any was stopped), 1 one is still running
# after ~10 s, 2 PLANILLA_INSTDIR is not set, 3 the process list could not be read.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:PLANILLA_INSTDIR) { exit 2 }
$java = $env:PLANILLA_INSTDIR.TrimEnd('\') + '\jre\bin\java.exe'
try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class PlanillaFileId {
    [StructLayout(LayoutKind.Sequential)]
    struct Info {
        public uint Attributes;
        public uint C1, C2, A1, A2, W1, W2;
        public uint VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);

    // Null when the file does not exist or cannot be opened.
    public static string Of(string path) {
        const uint FILE_READ_ATTRIBUTES = 0x80, SHARE_ALL = 7, OPEN_EXISTING = 3, BACKUP_SEMANTICS = 0x02000000;
        using (SafeFileHandle h = CreateFileW(path, FILE_READ_ATTRIBUTES, SHARE_ALL, IntPtr.Zero,
                OPEN_EXISTING, BACKUP_SEMANTICS, IntPtr.Zero)) {
            Info i;
            if (h.IsInvalid || !GetFileInformationByHandle(h, out i)) return null;
            return i.VolumeSerial + ":" + i.IndexHigh + ":" + i.IndexLow;
        }
    }
}
'@
    $target = [PlanillaFileId]::Of($java)
    if (-not $target) { exit 0 }
    $isOurs = { param($path) [PlanillaFileId]::Of($path) -eq $target }
} catch {
    Write-Output 'File identity unavailable; matching by path.'
    if (-not (Test-Path -LiteralPath $java)) { exit 0 }
    $isOurs = { param($path) [string]::Equals($path, $java, [System.StringComparison]::OrdinalIgnoreCase) }
}
try {
    $ours = {
        @(Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" |
            Where-Object { $_.ExecutablePath -and (& $isOurs $_.ExecutablePath) })
    }
    & $ours | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 20; $i++) {
        if ((& $ours).Count -eq 0) { exit 0 }
        Start-Sleep -Milliseconds 500
    }
    exit 1
} catch {
    exit 3
}
