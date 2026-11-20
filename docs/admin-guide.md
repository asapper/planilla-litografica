# Admin Guide — Cargador de Planilla

Technical reference for deploying and maintaining the application.

---

## 1. Installation

### Windows

1. Download the `.msi` installer from the latest GitHub Release:
   `https://github.com/asapper/planilla-litografica/releases/latest`
2. Double-click the installer and follow the wizard — no options required.
3. Launch **Cargador de Planilla** from the Start menu or desktop shortcut.

No additional software is required. The installer bundles a JRE and the backend JAR.

### macOS

The macOS build is distributed as a `.dmg`. Open it and drag the app to `/Applications`. See `docs/release-guide.md` for the full macOS release process.

### Network requirement

The machine running the app must have network access to the PostgreSQL server at `192.168.0.20:5432`. A VPN or physical LAN connection to the company network is required.

---

## 2. Backend Configuration

The backend is a Spring Boot JAR bundled inside the app. Its configuration lives in `application.properties`, which is embedded in the JAR at build time and baked into each release.

To change any value you must rebuild and redeploy the application. There is no external config file to edit at runtime.

**Key settings:**

| Key | Value | Purpose |
|-----|-------|---------|
| `server.port` | `41301` | HTTP port the backend listens on |
| `server.address` | `127.0.0.1` | Backend only accepts connections from this machine |
| `postgres.datasource.url` | `jdbc:postgresql://192.168.0.20:5432/sunhive` | Remote PostgreSQL connection |
| `postgres.datasource.username` | set via GitHub Secret at build time | PostgreSQL credentials |
| `postgres.datasource.password` | set via GitHub Secret at build time | PostgreSQL credentials |
| `postgres.datasource.hikari.connection-timeout` | `10000` ms | Time to wait for a pool connection |
| `connectTimeout` (JDBC) | `3` s | TCP connect timeout to PostgreSQL |
| `socketTimeout` (JDBC) | `30` s | Per-socket read timeout |
| `h2.datasource.url` | `jdbc:h2:file:${user.home}/.planilla/data/planilla-log` | Local H2 database path |
| `holiday.api.url` | `https://date.nager.at/api/v3/PublicHolidays/{year}/GT` | Public holiday API |
| `holiday.api.timeout-seconds` | `5` | Timeout for holiday API requests |
| Log file | `~/.planilla/logs/planilla-lito.log` | Backend log file location |

**Credentials** are injected at build time from GitHub repository secrets (`POSTGRES_DB_USERNAME`, `POSTGRES_DB_PASSWORD`). To rotate credentials: update the secrets in GitHub → Actions → Secrets, then trigger a new release build.

---

## 3. PostgreSQL Setup

The app calls a single stored procedure on the remote database:

```sql
SELECT public.carga_datos_empleados(
    codigo_empleado  ::varchar,
    dias_no_laborados::integer,
    horas_extras_simples::numeric,
    horas_extras_dobles ::numeric,
    numero_de_quincena  ::integer,
    mes                 ::integer,
    anio                ::integer
)
```

**Requirements:**

- The procedure must exist in the `public` schema of the `sunhive` database.
- The database user configured in the app must have `EXECUTE` permission on it.
- The server must be reachable at `192.168.0.20:5432` from the client machine.
- Port `5432` must be open on the network path between client and server.

**Testing connectivity** from the client machine:

```
psql -h 192.168.0.20 -p 5432 -U <username> -d sunhive -c "SELECT 1;"
```

If this fails, check network/firewall before debugging the app.

---

## 4. H2 Local Database

The app maintains a local H2 file database used exclusively for duplicate-submission detection.

**Location:** `%USERPROFILE%\.planilla\data\planilla-log.mv.db`  
(e.g., `C:\Users\jsmith\.planilla\data\planilla-log.mv.db`)

**Schema:**

```sql
CREATE TABLE carga_log (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    codigo_empleado  VARCHAR(50)  NOT NULL,
    numero_quincena  INTEGER      NOT NULL,
    mes              INTEGER      NOT NULL,
    anio             INTEGER      NOT NULL,
    fecha_carga      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_carga UNIQUE (codigo_empleado, numero_quincena, mes, anio)
);
```

One row is written per employee per successful submission. On the next upload attempt for the same employee/period, the app checks this table and blocks re-submission.

**Resetting the log** (e.g., after a test run or botched submission):

1. Close the app.
2. Delete `planilla-log.mv.db` (and `planilla-log.trace.db` if present) from `%USERPROFILE%\.planilla\data\`.
3. Restart the app — H2 recreates the file automatically on first use.

The H2 database also holds all Config page data (shifts, employees, holidays, general settings) in separate tables (`shift_config`, `employee_registry`, `holiday_cache`, `app_config`). Deleting the database file resets all configuration — only do this intentionally.

### Saved TAS session (`tas_draft`)

The same H2 file also keeps the user's latest **unfinished TAS session** so it can be resumed after the app closes, crashes or the backend restarts (the "Sesión sin terminar" card on the start screen).

```sql
CREATE TABLE tas_draft (
    id              INT PRIMARY KEY,          -- always 1: only the latest session is kept
    upload_token    VARCHAR(64)  NOT NULL,
    schema_version  INT          NOT NULL,    -- TasDraftService.SCHEMA_VERSION when saved
    file_name       VARCHAR(255),
    tas_view        VARCHAR(32)  NOT NULL,    -- inactiveReview | verification | review
    state_revision  BIGINT       NOT NULL,
    partial_submit  BOOLEAN      NOT NULL DEFAULT FALSE,
    period_label    VARCHAR(64),
    saved_at        TIMESTAMP    NOT NULL,
    backend_state   CLOB         NOT NULL,    -- the parsed scans, sessions and resolved rows (JSON)
    ui_state        CLOB         NOT NULL     -- the user's decisions and overrides (JSON, with uiVersion)
);
```

- It contains payroll data (employee names, scans, hours) and never leaves the machine — it lives in `%USERPROFILE%\.planilla\data` next to `carga_log`.
- The row is replaced by every autosave, deleted when a new file is uploaded, when the user discards the session, or when a submission finishes with every row sent. A submission that ends with failed rows keeps the row and sets `partial_submit`.
- Deleting `~/.planilla/data` (or resetting the database, see [reset-database.md](reset-database.md)) also deletes the saved session.
- **Versions.** Each half of the draft carries a format version: `schema_version` for the backend half (`TasDraftService.SCHEMA_VERSION`) and `uiVersion` inside `ui_state` for the frontend half (`DRAFT_UI_VERSION` in `tasDraft.ts`). A row whose `schema_version` doesn't match, or that can't be read, is logged once as a `WARN` by the backend. A `uiVersion` mismatch is detected by the frontend only, so it logs nothing. Either way the row is kept, and the start screen shows it with *"Esta sesión se guardó con otra versión de la aplicación y no se puede continuar."* and offers only **Descartar**; `POST /api/tas/draft/resume` answers `409 DRAFT_OUTDATED`, and the frontend checks `uiVersion` again on the resumed payload. It never blocks startup, and a new upload replaces it.
- **Changing the saved shape.** `TasDraftShapeTest` (backend) and `draftShape.test.ts` (frontend) fingerprint the saved types against `backend/src/test/resources/tas-draft/backend-shape-v<N>.txt` and `frontend/draft-shape/ui-shape-v<N>.txt`. Adding, removing, renaming or retyping a saved field (including making it optional or nullable) fails the test until the version is bumped and a new shape file is added next to the old ones. Without the bump, a draft saved before an update would resume with the new fields at their defaults. Literal sets are recorded too and may only grow. Adding a value to a frontend literal union (a new view, flag or decision) fails the test with "A literal set grew": refresh the same shape file, no bump, because old drafts still fit. Removing or renaming one, or narrowing a plain field to literals (`string` to `'a' | 'b'`, `boolean` to `true`), fails it as a shape change and needs a bump: the frontend doesn't check literals at runtime, so an old draft would resume holding a value the new code doesn't know. Widening a literal union back to its plain type also asks for a bump, which errs on the safe side. On the backend, enum constants are not fingerprinted: a draft holding a removed constant fails to read and shows as not resumable on its own. A bump discards every draft saved by the previous version when the user updates, so ship it in a release where no session is likely to be in progress.
- Closing the window saves first: the shell hides the window, asks the frontend to send any pending draft change and waits for it (up to 2 s), then asks the backend to shut down. The frontend stops waiting for that save after 1.5 s (`CLOSE_SAVE_TIMEOUT_MS`), so a save that failed or didn't answer in time refuses the first close with "No se pudo confirmar que el avance se guardó…"; a second close within 30 s goes ahead. The copy on the PC is written before the save is sent, so a slow save that is refused still completes in the background. While a payroll submission is running the close is refused (the frontend and the backend both check, the backend answering 409 `JOB_IN_PROGRESS`): the window comes back with "Hay un envío en curso. Espere a que termine para cerrar la aplicación." A Windows logoff (or Cmd+Q on macOS) skips this sequence and can't be refused: the draft relies on its autosave, the window hides, and the shell keeps asking the backend to stop for up to 35 s (the backend's own wait for a running batch) before killing it. During a submission Windows shows that the app is preventing sign-out and may end the session sooner. Once the backend has accepted a shutdown, no new submission can start. The shutdown request is `POST /api/system/shutdown` with a per-launch secret in `X-Shutdown-Token`, passed to the backend as `PLANILLA_SHUTDOWN_TOKEN`; without the variable the endpoint returns 404. The backend closes H2 cleanly and exits; if it hasn't exited within 5 s the shell kills it. `backend-stderr.log` shows `Graceful shutdown complete` on a clean close, and the shell log says when it had to kill. Every draft write and delete still runs an H2 `CHECKPOINT`, so a crash or a forced kill loses at most an edit from the last half second (the frontend saves 0.5 s after the last change, at least every 3 s while editing, and when the page is hidden).

**In-memory session expiry.** Upload sessions held in the backend's memory now expire after **30 idle minutes** (no request touching them), not 30 minutes after the upload. The session that matches the saved draft is never evicted, and if it is missing (for example after a backend restart) it is reloaded from `tas_draft` on the next request.

---

## 5. Config Page

The Config page (gear icon in the app) has four tabs. All data is persisted to the local H2 database.

### Shifts (Turnos)

Defines the work shifts used for TAS scan matching.

| Field | Purpose |
|-------|---------|
| Name | Identifier shown in the app (e.g., "Mañana", "Tarde", "Noche") |
| Start / End time | Scheduled hours of the shift |
| Cross midnight | Enable for shifts that span midnight (e.g., 22:00–06:00) |
| Detection window (before/after) | Minutes around the shift start/end during which an entry/exit scan is accepted as belonging to this shift |

### Employees (Empleados)

Registry of known employees. Populated automatically the first time a scan CSV is uploaded — new employee IDs are added with a default "Mañana" shift assignment.

| Field | Purpose |
|-------|---------|
| Employee ID | Matches the ID column in the scan CSV |
| Name | Display name |
| Assigned shift | The shift this employee normally works (used as baseline for mismatch detection) |
| Active | Inactive employees are excluded from TAS processing |
| Accrues overtime | When unchecked, overtime hours are calculated but zeroed out in the final report |

### Holidays (Feriados)

Stores public holidays for Guatemala. Holidays are fetched automatically from `date.nager.at` once per year and cached locally. They can also be added or removed manually in this tab.

Work sessions on holiday dates are flagged as `HOLIDAY` and all worked hours are counted as double overtime (`horasExtrasDobles`).

### General (General)

| Setting | Default | Purpose |
|---------|---------|---------|
| Tiempo de descanso no deducible | 45 min | Legal break allowance not deducted from worked hours (15 min snack + 30 min lunch) |
| Duración máxima de jornada | 14 h (code default; saved to DB only after first save) | Maximum time between entry and exit scans considered a single session. Gaps exceeding this create two separate sessions. |

Changes on this tab take effect starting with the next CSV upload.

---

## 6. Validation Rules

`config/validation-rules.json` defines the field-level rules applied to each row before it is submitted to the stored procedure.

**Location in the source repo:** `config/validation-rules.json`  
**Bundled into the JAR** — not editable at runtime without a rebuild.

Current rules:

| Field | Type | Constraints |
|-------|------|-------------|
| `codigo_empleado` | string | required |
| `dias_no_laborados` | integer | required, min 0 |
| `horas_extras_simples` | number (numeric) | required, min 0, 0.5 precision |
| `horas_extras_dobles` | number (numeric) | required, min 0, 0.5 precision |
| `numero_de_quincena` | integer | required, 1 or 2 |
| `mes` | integer | required, 1–12 |
| `anio` | integer | required, 2000–2100 |

To change a rule (e.g., extend the valid year range), edit `config/validation-rules.json` in the source repo and release a new build.

---

## 7. Troubleshooting

### App window opens but data never loads / spinner keeps spinning

If the shell detects the cause, the app stops waiting and shows it directly:

- *"es posible que otro programa esté usando el puerto 41301"*: the backend exited and the port wasn't bindable just before it started. Usually another program holds it (see **Port conflict** below), but it can also follow a just-terminated old backend, so check the log too.
- *"El servicio se detuvo inesperadamente al iniciar (código N)"*: the backend JVM exited during startup; check the log files below.

Otherwise it shows *"No se pudo conectar con el servicio."* after about 20 seconds.

The backend failed to start. Check:

1. **Port conflict.** Port `41301` is in use by another process (log shows `Port 41301 was already in use`).
   - Find the owner (PowerShell): `Get-NetTCPConnection -LocalPort 41301 | Select LocalAddress,RemoteAddress,State,OwningProcess`
   - A `Bound`/`Established` row owned by another program means its outbound connection was given 41301 as its source port; restarting that program frees it.
   - Confirm 41301 is outside the machine's ephemeral range and any reserved blocks (check both IPv4 and IPv6, since Java binds dual-stack):
     ```powershell
     netsh int ipv4 show dynamicport tcp
     netsh int ipv6 show dynamicport tcp
     netsh int ipv4 show excludedportrange protocol=tcp
     netsh int ipv6 show excludedportrange protocol=tcp
     ```
     Some Hyper-V/Docker setups lower the dynamic range start; if it covers 41301, the port must be changed in a new build.
   - Up to v1.2.1 the port was `49301`, inside the Windows ephemeral range (49152–65535), which caused these collisions.

2. **JRE not found.** The bundled JRE is missing or was moved.
   - Reinstall the app from the installer.

3. **Log file.** The backend writes to `~/.planilla/logs/planilla-lito.log`. Check there for Java startup errors.

### "No se pudo conectar a la base de datos" (DB unreachable)

The app cannot reach PostgreSQL at `192.168.0.20:5432`.

1. Confirm the machine is on the company network (or VPN).
2. Test: `ping 192.168.0.20` and then the `psql` command from §3.
3. Check that the PostgreSQL service is running on the server.
4. Check firewall rules — port 5432 must be open.

### "Error al enviar datos" on submission

The stored procedure call failed.

1. Confirm the procedure `public.carga_datos_empleados` exists in `sunhive`.
2. Confirm the DB user has `EXECUTE` permission on it.
3. Check `~/.planilla/logs/planilla-lito.log` for the full SQL error.

### Duplicate detection blocking a legitimate re-submission

The app found a matching record in `carga_log` for that employee/period combination.

- If the original submission failed partway through (some rows submitted, some did not), you may need to manually delete the partial rows from `carga_log` in the H2 database, or delete the database file entirely and reprocess (see §4).

### Holiday API unavailable

If `date.nager.at` is unreachable when the app tries to fetch holidays for a new year, the fetch silently fails and holidays for that year are not cached. Manually add the holidays through the Config → Feriados tab.

---

## 8. Updating the App

### Windows

1. Download the new `.msi` from `https://github.com/asapper/planilla-litografica/releases/latest`.
2. Run the installer — it replaces the previous version automatically. No uninstall step needed.
3. Verify the version in the app's title bar or About screen.

**Data is preserved.** The H2 database lives in `%USERPROFILE%\.planilla\data\` and is not touched by the installer.

### macOS

1. Build and distribute a new `.dmg` (see `docs/release-guide.md`).
2. The user opens the `.dmg`, drags the new `.app` to `/Applications`, and confirms the replacement.

### Releasing a new build

For the full release process (version bump → tag → GitHub Actions → MSI), see `docs/release-guide.md`.
