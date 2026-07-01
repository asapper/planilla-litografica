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

!macro KillBundledBackend
  DetailPrint "Stopping any running backend (bundled JRE)..."
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'java.exe' -and $$_.ExecutablePath -like '$INSTDIR\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillBundledBackend
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillBundledBackend
!macroend
