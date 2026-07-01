# Wipes the local H2 database so the app starts with a clean slate.
#
# Close CargadorDePlanilla first — a running backend locks the DB file. The
# schema and seed data (shifts, default config) are recreated automatically on
# the next app launch. This does NOT touch the remote PostgreSQL where already
# submitted payroll lives.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\reset-db.ps1

$ErrorActionPreference = 'Stop'

$dataDir = Join-Path $env:USERPROFILE '.planilla\data'
$files = @('planilla-log.mv.db', 'planilla-log.trace.db')

# Ensure no backend JVM is holding the DB file open.
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -like '*backend.jar*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500

foreach ($f in $files) {
  $path = Join-Path $dataDir $f
  if (Test-Path $path) {
    Remove-Item $path -Force
    Write-Host "Deleted $path"
  } else {
    Write-Host "Not found (skipped): $path"
  }
}

Write-Host "Done. The database will be recreated on the next app launch."
