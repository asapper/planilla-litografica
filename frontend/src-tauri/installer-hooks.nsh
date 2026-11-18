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

; Captured here, while this file is being read: inside the macro body ${__FILEDIR__}
; would expand where the macro is inserted, in Tauri's generated installer.nsi.
!define PLANILLA_HOOK_DIR "${__FILEDIR__}"

; stop-backend.ps1 (shared with the app's startup check in lib.rs) stops the JVM whose
; executable is this install's jre\bin\java.exe, matched by file identity so short names,
; junctions and subst drives can't hide it. It exits 0 once none is running, 1 if one is
; still running after ~10 s, 2 if it was not given the install path and 3 if the check
; failed. nsExec gives "error" or "timeout" when PowerShell itself did not run.
; The install path reaches it through an environment variable, never as script text.
!macro KillBundledBackend
  DetailPrint "Stopping any running backend (bundled JRE)..."
  InitPluginsDir
  File "/oname=$PLUGINSDIR\stop-backend.ps1" "${PLANILLA_HOOK_DIR}\stop-backend.ps1"
  System::Call 'kernel32::SetEnvironmentVariable(t "PLANILLA_INSTDIR", t "$INSTDIR")i'
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-backend.ps1"'
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
