# Resetting the local database (clean slate)

The app stores all local data in a single H2 database file. Deleting it wipes
every employee, shift override, cached holiday and local submission log, and the
app rebuilds an empty schema (with the default shifts and config re-seeded) on
the next launch.

This only affects the **local** H2 database. Payroll rows already submitted to
the remote PostgreSQL are **not** removed.

## Location

```
Windows:  %USERPROFILE%\.planilla\data\planilla-log.mv.db
macOS:    ~/.planilla/data/planilla-log.mv.db
```

There may also be a `planilla-log.trace.db` next to it.

## Steps

1. **Close CargadorDePlanilla completely.** A running backend keeps the file
   locked, so it can't be deleted while the app is open. (If the tray/backend
   lingers, end the `java.exe` / "OpenJDK Platform binary" process.)
2. Delete `planilla-log.mv.db` (and `planilla-log.trace.db` if present).
3. Launch the app — it recreates an empty database with the default shifts.

## Helper scripts

Instead of deleting by hand, run the bundled script (it also stops a lingering
backend first):

```
Windows:  powershell -ExecutionPolicy Bypass -File scripts\reset-db.ps1
macOS:    ./scripts/reset-db.sh
```
