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
| `server.port` | `49301` | HTTP port the backend listens on |
| `postgres.datasource.url` | `jdbc:postgresql://192.168.0.20:5432/sunhive` | Remote PostgreSQL connection |
| `postgres.datasource.username` | set via GitHub Secret at build time | PostgreSQL credentials |
| `postgres.datasource.password` | set via GitHub Secret at build time | PostgreSQL credentials |
| `postgres.datasource.hikari.connection-timeout` | `10000` ms | Time to wait for a pool connection |
| `connectTimeout` (JDBC) | `3` s | TCP connect timeout to PostgreSQL |
| `socketTimeout` (JDBC) | `30` s | Per-socket read timeout |
| `h2.datasource.url` | `jdbc:h2:file:${user.home}/.planilla/data/planilla-log` | Local H2 database path |
| `holiday.api.url` | `https://date.nager.at/api/v3/PublicHolidays/{year}/GT` | Public holiday API |
| `holiday.api.timeout-seconds` | `5` | Timeout for holiday API requests |
| `logging.file.name` | `logs/planilla.log` | Log file location (relative to working dir) |

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

The backend failed to start. Check:

1. **Port conflict.** Port `49301` is in use by another process.
   - On Windows: `netstat -ano | findstr 49301`
   - Kill the conflicting process, then restart the app.

2. **JRE not found.** The bundled JRE is missing or was moved.
   - Reinstall the app from the installer.

3. **Log file.** The backend writes to `logs/planilla.log` (relative to the app's working directory, typically the install folder). Check there for Java startup errors.

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
3. Check `planilla.log` for the full SQL error.

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
