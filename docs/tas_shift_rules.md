# TAS Shift & Worked Hours Rules

This file records all business rules for processing the TAS biometric event format.
Rules marked **[CONFIRMED]** have been verified with the client.
Rules marked **[OPEN]** are still pending confirmation.

---

## File Encoding **[CONFIRMED]**

TAS files are **UTF-8 with BOM** (`EF BB BF` prefix). The old format was ISO-8859-1 — the parser must be updated accordingly.

---

## Input Format **[CONFIRMED]**

The TAS file is a flat CSV with 5 columns:

| Column | Name | Example |
|---|---|---|
| 0 | No. | `"1"` |
| 1 | Fecha y hora | `"2026/03/31 19:46"` |
| 2 | Evento | `"1:N Autenticación exitosa (Rostro)"` |
| 3 | Nombre de usuario | `"Morales Cifuentes Roberto Daniel"` |
| 4 | ID de usuario | `"134"` |

- Every event type is identical (`1:N Autenticación exitosa (Rostro)`). There is no in/out distinction.
- A person may scan multiple times in rapid succession — consecutive scans within **5 minutes** are noise and are deduplicated into a single event (see Duplicate Scan Deduplication).
- Data is stored in reverse chronological order in the file; must be sorted ascending per employee before processing.

---

## Shift Configuration **[CONFIRMED]**

Shifts are configurable in the app. Each shift defines:

- **`name`**: display name shown in the UI (e.g., "Mañana")
- **`startTime`**: anchor/start time (e.g., 07:00)
- **`endTime`**: expected end time (e.g., 15:00)

If `endTime < startTime`, the shift is **cross-midnight** (e.g., Noche: 19:00–07:00).

Default shifts (pre-loaded, editable):

| `name` | `startTime` | `endTime` | Cross-midnight |
|---|---|---|---|
| Mañana | 07:00 | 15:00 | No |
| Tarde | 15:00 | 23:00 | No |
| Noche | 19:00 | 07:00 | Sí |

**Detection window** (derived, not stored): `startTime − 60 min` to `startTime + 10 min`.

---

## Grace Period **[CONFIRMED]**

- Each shift has a **10-minute grace period** after `startTime`.
- First scan ≤ `startTime + 10 min` → on time.
- First scan > `startTime + 10 min` → tardy.

Constant in code — not user-configurable:
```java
static final int GRACE_PERIOD_MINUTES = 10;
```

---

## Employee Schedule **[CONFIRMED]**

Each employee has a default shift assignment:

- Default shift for all employees: **Mañana**.
- Employee records are **auto-populated on first upload** using the employee ID and name from the TAS file.
- Employee names are updated on each subsequent upload (latest name wins). Matching is always by **employee ID**. Names are stored as-is from the file.
- Users manage assignments on the **Config page** in the app (ID + name shown).

**Mid-quincena shift changes** (outlier case):
- Handled at upload time in the verification screen, not in the config page.
- If scans consistently match a different shift across the entire quincena → user is prompted to update the saved config.
- If scans match a different shift only on specific days → per-day exception for that upload only; saved config unchanged.

---

## Session Grouping **[CONFIRMED]**

Sessions are **time-window-based**, not scan-count-based. This is intentional — missing scans are common and the even/odd count model is not reliable.

**Base rule**: a session opens when a scan falls within any configured shift's detection window. All subsequent scans until the next session opener belong to this session. The first scan is the entry; the last scan is the exit; all intermediate scans are door accesses.

**Cross-midnight stitching**: for employees assigned a cross-midnight shift (e.g., Noche: 19:00–07:00), scans on day D+1 that fall within the *next* shift's detection window (e.g., Mañana: 06:00–07:10) are treated as **exit scans** for the D session — not as new session openers. A new session for a cross-midnight employee only opens when a scan falls in their own shift's detection window.

Example — Noche (19:00–07:00):
```
Monday   19:03  → session opens (Noche detection window)
Monday   22:30  → door access
Tuesday  02:15  → door access
Tuesday  07:00  → exit scan (Mañana window, but employee is Noche → closes D session)
Tuesday  19:05  → new session opens (Noche detection window)
```

**Same-day double session**: if two detection-window hits from **different** shifts occur on the same calendar day → flag for manual confirmation.

---

## Shift Mismatch Detection **[CONFIRMED]**

If the first scan of a session falls outside the employee's assigned shift's detection window:

1. Check all other configured shifts' detection windows for a match.
2. If a match is found:
   - **Consistent across the entire quincena** — defined as: every session in the quincena that hits any detection window hits the same alternate shift's window → surface suggestion: "Las marcaciones de [nombre] corresponden al turno [X] en toda la quincena. ¿Desea actualizar su turno asignado?" Accepting updates the saved config.
   - **Only on specific days** — one or more sessions fall in a different window than the rest → surface per-day exception in the verification screen; saved config unchanged.
3. If no shift matches → flag as ambiguous; client provides start and end manually.

---

## Tardiness **[CONFIRMED]**

```
effectiveStart = startTime   (on time — first scan within grace period)
effectiveStart = firstScan   (late — first scan beyond grace period)
```

Employees make up exactly the time they were late by leaving later. No chunk rounding, no penalty multiplier — hours simply reflect actual time worked.

Examples (startTime = 07:00, grace ends at 07:10):
- First scan 07:05 → on time → effectiveStart = 07:00
- First scan 07:25 → late → effectiveStart = 07:25 → employee leaves at 15:25 → full 8h
- First scan 08:00 → late → effectiveStart = 08:00 → employee leaves at 16:00 → full 8h

---

## Missing Scan Detection **[CONFIRMED — requires thorough testing]**

Missing scans are detected by **timing anomalies**, not scan count. Session grouping still proceeds; the session is flagged for verification before the report is finalized.

**Flag conditions:**

| Condition | Inference |
|---|---|
| Last scan is more than **60 minutes** before `endTime` | Likely missing **exit scan** ("Falta marcación de salida") |
| First scan is more than **60 minutes** after `startTime + grace` | Likely missing **entry scan** ("Falta marcación de entrada") |
| Session on the **first day** of the report period and employee is on a cross-midnight shift | Likely **start cutoff** (session began before the report period) |
| Session on the **last day** of the report period | Likely **end cutoff** (session continues beyond the report) |

**Start cutoff** (cross-midnight only): the employee's first scans in the file belong to a session that started before the report period (e.g., Noche session began at 22:00 on the 31st, report starts on the 1st). In this case `effectiveStart = 00:00` of the first day of the report period; worked hours are counted from midnight of that day to the session's last scan.

**End cutoff**: session started within the period but the file ends before a closing scan. Hours count toward the start date's quincena.

Both cutoff cases are flagged for manual verification.

**Known limitation**: if an employee forgets their exit scan and re-enters later the same day, the timing-based detection may not catch the missing exit if the re-entry scan is in the same shift window. This is a known false negative.

---

## Worked Hours per Session **[CONFIRMED]**

```
// Scans alternate entry/exit starting with entry: scan[0]=entry, scan[1]=exit, scan[2]=entry, ...
// Odd-indexed gaps (gap[1], gap[3], ...) are time outside (breaks); even-indexed gaps are time inside
totalBreakGap    = gap[1] + gap[3] + gap[5] + ...  where gap[i] = scan[i+1] − scan[i]
deductibleBreak  = max(0, totalBreakGap − legalBreakAllowance)
workedMinutes    = (lastScan − effectiveStart) − deductibleBreak  (exact, in minutes)
workedHours      = floor(workedMinutes / 30) / 2.0  (double, always X.0 or X.5)
```

`legalBreakAllowance` is a configurable value on the Config page (default **45 minutes** = 15-min snack + 30-min lunch, as mandated by law). Only break time beyond this allowance is deducted. Changes to `legalBreakAllowance` apply to future uploads only.

Examples (45-min allowance, 07:00 entry):
- Scans: 07:00, 12:00, 12:40, 15:00 → break = 40 min → deductible = max(0, 40−45) = 0 → workedMinutes = 480 → **8.0h**
- Scans: 07:00, 12:00, 13:30, 15:00 → break = 90 min → deductible = 45 min → workedMinutes = 435 → **7.5h**
- Scans: 07:00, 10:00, 10:20, 12:00, 12:40, 15:30 → break = 20+40 = 60 min → deductible = 15 min → workedMinutes = 495 → **8.0h** (compensated by staying later)

Sessions with `needsResolution = true` get `workedMinutes = 0` and `workedHours = 0.0` until resolved.

---

## Public Holidays **[CONFIRMED]**

Hours worked on a public holiday are always **dobles**, regardless of day of week or cumulative weekly total. Public holiday absences are **excluded** from `nonWorkedDays`.

**Holiday data source**: [Nager.Date](https://date.nager.at) free public API, no authentication required:
```
GET https://date.nager.at/api/v3/PublicHolidays/{year}/GT
```

**Fetch timing**: triggered at CSV upload. The app extracts the full date range from the file and fetches holidays for each calendar year covered (typically one, occasionally two for files spanning a year boundary).

**Retry strategy**: 2 automatic retries with exponential backoff (1 s, then 3 s). Silent — no UI feedback during retries.

**Failure handling** (two-layer):
1. **Bundled static list** — a `holidays-GT.json` file is shipped with the app covering several years of Guatemala public holidays. If all API retries fail, the bundled list is used silently. GT holidays are set by law and change infrequently; the main risk is extraordinary government-declared holidays.
2. **Config page escape hatch** — the holiday list (whether from the API or the bundle) is user-editable in the Config page. Payroll staff can add, remove, or correct entries before running the report.

**User notification**: if the API failed and the bundled list was used, a non-blocking banner appears on the upload results screen:
> *"No se pudo verificar el calendario de feriados en línea. Se usó la lista incluida en la aplicación. Revise la configuración si falta algún feriado."*

No blocking dialog, no required action. The Config page link is embedded in the banner.

**Caching**: the fetched (or bundled) holiday list is cached in app state for the session. No re-fetch per quincena.

---

## Weekly Hours: Simples vs. Dobles **[CONFIRMED]**

**SP field naming note**: `horas_extras_simples` and `horas_extras_dobles` are misleadingly named — there is no separate field for regular hours. `horas_extras_simples` receives all regular worked hours; `horas_extras_dobles` receives only the overtime portion.

- **`horas_extras_simples`**: hours worked **within** the employee's assigned shift duration on Mon–Sat (non-holiday).
- **`horas_extras_dobles`**: hours worked **beyond** the shift duration on any day, plus **all hours worked on Sundays**, plus **all hours worked on public holidays** (always dobles regardless of daily total).

The 44h/week cumulative threshold does **not** apply — overtime is determined per-day based on the shift's expected duration, not weekly accumulation.

---

## Non-Worked Days **[CONFIRMED]**

Count of **Monday–Saturday** calendar days within the reporting period where the employee has **zero sessions**.

- Sundays are excluded from this count.
- Public holidays are excluded from this count (absence on a holiday ≠ no-show).
- A day with at least one scan = worked, regardless of how few hours.
- Employees who do not appear in the TAS file at all are **not included** in the report — the file is the source of record. Fully absent known employees are surfaced via the Employee Registry (see below).

---

## Employee Registry **[CONFIRMED]**

The app maintains a cumulative registry of all employees ever seen across uploaded TAS files. There is no manual roster upload — the registry builds itself automatically.

**Registry population:**
- Every employee that appears in a TAS file is added to the registry on first encounter (ID + name).
- Name updates follow the same rule as Employee Schedule: latest name wins, matching always by employee ID.

**Employee status:**
- `active: boolean` — all employees start as `true`.
- Users set `active = false` when an employee no longer works there (see Not-Present Review below).

**Not-Present Review (post-submit step):**
- After the main submission to the stored procedure completes, the app surfaces a review list of all `active` registry employees who had **zero scans** in the processed file.
- Label: *"Sin marcaciones en este período"* — the app cannot determine whether the absence was intentional or a missed scan.
- The user acknowledges each entry; no action is required (they may simply be on leave).
- From this list the user can set any employee to `active = false`. Inactive employees are excluded from all future not-present reviews.
- Brand-new employees (first appearance ever) are never shown in this list — they have no prior history to compare against.

**Re-appearance of inactive employees:**
- If an `active = false` employee's scans appear in a future TAS file, the app flags them before the main submission with two options:
  - **Reactivar y enviar** — sets `active = true`, includes their hours in the submission.
  - **Ignorar** — the employee's scans are excluded from this upload's report and SP submission; employee remains `active = false` and will be flagged again if they appear in a subsequent file.
- There is no "ignore forever" option — re-appearances are always surfaced to avoid silently masking rehires or data issues.

---

## Quincena Derivation **[CONFIRMED]**

Derived from the date range in the file — not entered manually.

- **Quincena 1** = calendar days 1–15 (inclusive)
- **Quincena 2** = calendar days 16–end of month (inclusive)

The system generates **one output row per employee per quincena**. TAS files are ideally pre-split by quincena, but multi-quincena and multi-month files are fully supported — all quincenas present in the file are processed in a single upload.

**Quincena boundaries for simples/dobles classification:**
- Q1: sessions capped at the 15th — any session that starts on or before the 15th belongs to Q1.
- Q2: starts on the 16th. Since overtime is per-day (not weekly), no weekly reset counter is needed within a quincena.

---

## Break Deduction **[CONFIRMED]**

Employees are expected to scan on every exit and entry, including breaks. Break time is detected from inter-scan gaps within a session.

- Guatemalan law mandates a **15-minute snack break** and a **30-minute lunch break** — these are not deducted.
- `legalBreakAllowance` (Config page, default **45 min**) is the total daily break time that is never deducted.
- Any total break time **beyond** the allowance is deducted from `workedMinutes`.
- Scans alternate entry/exit starting with the first scan as entry. Break time is the sum of odd-indexed inter-scan gaps (exit→entry intervals).
- If an employee forgets to scan during a break, the gap is invisible and no deduction occurs — accepted limitation.

See **Worked Hours per Session** for the full formula.

---

## Config Page **[CONFIRMED]**

The Config page is organized into four tabs. All tabs use **explicit save** — changes are not applied until the user saves. Unsaved changes trigger a confirmation modal before navigating away ("Tienes cambios sin guardar. ¿Deseas descartarlos?"). A success toast appears on save; errors are shown inline.

---

### Tab 1 — Turnos

Manages the configured shifts used for session detection and worked hours calculation.

- Table columns: `name`, `startTime`, `endTime`, cross-midnight indicator.
- Inline add, edit, and delete.
- Pre-loaded defaults (Mañana, Tarde, Noche) — deletable.
- **Deleting a shift with active employees:** blocked. Alert shown listing the affected employees; user must reassign them before deletion is allowed.
- **Deleting a shift with only inactive employees:** allowed. Their shift assignment is cleared (`null`).
- **Reactivating an employee with no shift assigned:** auto-assigns default shift (Mañana) and surfaces an indicator: *"Turno restablecido al turno por defecto. Verifique si corresponde."*

---

### Tab 2 — Empleados

Manages employee records and their default shift assignments.

- Table columns: employee ID, name, assigned shift (dropdown), `active` toggle.
- Search by name or ID.
- Filter by: active/inactive status, assigned shift.
- Bulk action: select multiple employees → assign shift.
- No manual "add employee" — employees are auto-populated from TAS file uploads. A note in the UI makes this clear.
- `active` toggle handles enable/disable inline (same state as the post-submit not-present review flow).

---

### Tab 3 — Feriados

Manages the public holiday calendar used to classify hours as dobles.

- Table columns: date, holiday name, source (API / manual).
- Year selector — shows holidays for the selected year; typically one year at a time.
- Add and delete entries manually. Confirmation required before deletion.
- **"Actualizar desde internet" button:** fetches the holiday list from the Nager.Date API for the selected year and replaces all non-manually-added entries. Description shown below the button: *"Descarga el calendario oficial de feriados de Guatemala desde internet. Los feriados agregados manualmente no serán reemplazados."*

---

### Tab 4 — General

Global payroll constants.

| Field | Default | Description |
|---|---|---|
| `legalBreakAllowance` | 45 min | Tiempo de descanso diario no deducible (mandato legal: 15 min refacción + 30 min almuerzo) |

---

## Ambiguous / Missing Scan Verification **[CONFIRMED]**

The mandatory verification screen appears before the final report when any of the following are detected:

1. **Missing scan (timing anomaly)** — last scan well before `endTime`, or first scan well after `startTime + grace`.
2. **Shift mismatch** — first scan falls outside the employee's assigned shift's detection window.
3. **Same-day double session** — two detection-window hits from different shifts on the same calendar day.
4. **Report cutoff** — session at the start or end of the report period with incomplete scan data.

For each flagged item the screen shows the employee name, date, and known scan times (read-only), with inputs for the missing or incorrect times. No employee row may be finalized without a resolved start and end time.

---

## Duplicate Scan Deduplication **[CONFIRMED]**

Consecutive scans from the same employee within **5 minutes** of each other are collapsed into a single event, keeping the earliest timestamp. Scans more than 5 minutes apart are treated as separate real events.

---

## Output Flow **[CONFIRMED]**

Same as the existing planilla flow: the user reviews and resolves all flagged items on the verification screen, then validates and clicks submit. Submit calls the stored procedure `carga_datos_empleados` once per employee per quincena with the computed values.
