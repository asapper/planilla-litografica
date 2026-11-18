; Tauri NSIS installer hooks for CargadorDePlanilla.
;
; The app launches a bundled JRE (`$INSTDIR\jre\bin\java.exe`) to run the
; backend. While that JVM is alive, Windows keeps its native DLLs
; (extnet.dll, jvm.dll, net.dll, ...) locked. Tauri's installer only stops the
; main app process, and the app deliberately leaves a running backend alive to
; reuse across launches, so a backend from a previous version stays running and
; blocks the updater from overwriting the JRE. The install then aborts with:
;   error opening file "...\CargadorDePlanilla\jre\bin\extnet.dll"
;
; Terminate any backend JVM launched from this install directory before we
; extract or delete files, then wait for Windows to release the file handles.

!include LogicLib.nsh

; The PowerShell script kills the JVM, then polls (up to ~10 s) until it is gone. It exits
; 0 once no bundled java.exe remains, 1 if one is still running, 2 if it was not given the
; install path and 3 if the process list could not be read. nsExec gives "error" or "timeout"
; when PowerShell itself did not run.
; The install path reaches it through an environment variable, and only the bundled
; jre\bin\java.exe is matched, by its full path: pasted into the script, a ' in the path
; (C:\Users\O'Brien) broke the quoting and [ or ] were read as -like wildcards, so the
; backend was never stopped.
!macro KillBundledBackend
  DetailPrint "Stopping any running backend (bundled JRE)..."
  System::Call 'kernel32::SetEnvironmentVariable(t "PLANILLA_INSTDIR", t "$INSTDIR")i'
  nsExec::ExecToLog `powershell -NoProfile -NonInteractive -Command "if (-not $$env:PLANILLA_INSTDIR) { exit 2 }; $$java = $$env:PLANILLA_INSTDIR.TrimEnd('\') + '\jre\bin\java.exe'; $$f = { Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $$_.Name -eq 'java.exe' -and [string]::Equals($$_.ExecutablePath, $$java, [System.StringComparison]::OrdinalIgnoreCase) } }; try { & $$f | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; for ($$i = 0; $$i -lt 20; $$i++) { if (-not (& $$f)) { exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1 } catch { exit 3 }"`
  Pop $0
  ${If} $0 == "0"
    DetailPrint "Backend stopped."
  ${ElseIf} $0 == "2"
    DetailPrint "WARNING: could not check for a running backend (the install path was not passed on). If the install fails on a locked file, close java.exe in Task Manager and run the installer again."
  ${ElseIf} $0 == "3"
    DetailPrint "WARNING: could not check for a running backend (the process list could not be read). If the install fails on a locked file, close java.exe in Task Manager and run the installer again."
  ${ElseIf} $0 == "1"
    DetailPrint "WARNING: a bundled backend (java.exe) is still running (result: $0). If the install fails on a locked file, close it in Task Manager and run the installer again."
  ${Else}
    DetailPrint "WARNING: could not check for a running backend (PowerShell did not run: $0). If the install fails on a locked file, close java.exe in Task Manager and run the installer again."
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "PLANILLA_INSTDIR", p 0)i'
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillBundledBackend
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillBundledBackend
!macroend
