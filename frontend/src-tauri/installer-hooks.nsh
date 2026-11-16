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

; The PowerShell script kills the JVM, then polls (up to ~10 s) until it is gone,
; exiting 0 once no bundled java.exe remains and 1 if one is still running.
!macro KillBundledBackend
  DetailPrint "Stopping any running backend (bundled JRE)..."
  nsExec::ExecToLog `powershell -NoProfile -NonInteractive -Command "$$f = { Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'java.exe' -and $$_.ExecutablePath -like '$INSTDIR\*' } }; & $$f | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; for ($$i = 0; $$i -lt 20; $$i++) { if (-not (& $$f)) { exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1"`
  Pop $0
  ${If} $0 == "0"
    DetailPrint "Backend stopped."
  ${Else}
    DetailPrint "WARNING: a bundled backend (java.exe) is still running (result: $0). If the install fails on a locked file, close it in Task Manager and run the installer again."
  ${EndIf}
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillBundledBackend
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillBundledBackend
!macroend
