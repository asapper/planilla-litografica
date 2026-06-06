# TAS Biometric Format — Design Spec

**Date:** 2026-05-26
**Last updated:** 2026-06-06
**Status:** Approved for implementation
**Author:** Atlas (Claude Code)

> **Source of truth for all business rules:** `docs/tas_shift_rules.md`.
> This spec describes *how* to implement — not *what* the rules are. When a formula or threshold is needed, look it up in the rules doc. Do not duplicate rule definitions here.

---

## Overview

Replace the old multi-block CSV parser with a new TAS biometric event log parser. The TAS format is a flat CSV of door-access scan events. The system must derive shift start/end times, calculate worked hours, apply simples/dobles rules, and surface a mandatory verification screen when scan data is incomplete or ambiguous.

The old `CsvParserService` is deleted. All other existing flows (validate, submit, job polling) are unchanged.

---

## 1. Input Format

| Column | Name | Example |
|---|---|---|
| 0 | No. | `"1"` |
| 1 | Fecha y hora | `"2026/03/31 19:46"` (YYYY/MM/DD HH:mm) |
| 2 | Evento | `"1:N Autenticación exitosa (Rostro)"` |
| 3 | Nombre de usuario | `"Morales Cifuentes Roberto Daniel"` |
| 4 | ID de usuario | `"134"` |

- Encoding: **UTF-8 with BOM** (`EF BB BF`)
- All events are identical type — no in/out distinction
- Data arrives in reverse chronological order
- A person may scan multiple times within seconds (noise)

---

## 2. Architecture

### What changes
- **Deleted:** `CsvParserService.java`, `CsvParserServiceTest.java`
- **New — parsing:** `TasParserService.java`, `TasDraftStore.java`, `TasSession.java`, `MissingTimeItem.java`, `ResolveRequest.java`
- **New — employee registry:** `Employee.java`, `EmployeeRepository.java`, `EmployeeService.java`
- **New — config:** `Shift.java`, `ShiftRepository.java`, `ShiftService.java`, `HolidayService.java`
- **Updated:** `UploadController.java`, `UploadResponse` model
- **New endpoint:** `POST /resolve`
- **Frontend new:** `MissingTimesScreen.tsx`, `MissingTimesScreen.test.tsx`, `ReappearanceScreen.tsx`, `NotPresentReview.tsx`, `ConfigPage.tsx`
- **Frontend updated:** `types.ts`, `store.ts`, `store.test.ts`, `api.ts`, `api.test.ts`, `App.tsx`, `App.test.tsx`

### App state flow
```
empty
  → upload (reappearing employees)  → reappearance → [decisions made] → upload continues below
  → upload (no missing times)       → loaded
  → upload (missing times)          → verifying → resolve → loaded
loaded → notPresentReview → result  (if notPresentEmployees non-empty)
loaded → result                     (if notPresentEmployees empty)
loaded → submitting → polling → result
```

---

## 3. Data Models

### Backend — TasSession (internal)
```java
String employeeId
String employeeName
LocalDate date              // shift date (start date of session)
List<LocalDateTime> allScans // full sorted scan list; required for break deduction on re-run
LocalDateTime firstScan     // allScans.get(0)
LocalDateTime lastScan      // allScans.get(allScans.size() - 1)
LocalTime shiftAnchor       // startTime of matched shift, or null if ambiguous
LocalDateTime effectiveStart // null until resolved
int workedMinutes           // 0 until resolved
double workedHours          // 0.0 until resolved; always X.0 or X.5
boolean needsResolution
boolean missingStart
boolean missingEnd
```

### Backend — Employee (DB entity)
```java
String employeeId           // PK, from TAS file
String name                 // latest name seen in any upload
Long shiftId                // FK to Shift; null if assigned shift was deleted
boolean active              // true by default; false = inactive
```

### Backend — Shift (DB entity)
```java
Long id
String name                 // display name, e.g. "Mañana"
LocalTime startTime
LocalTime endTime
// crossMidnight derived: endTime < startTime
```

### Backend — MissingTimeItem (sent to client)
```java
String employeeId
String employeeName
String date                 // "YYYY-MM-DD"
String knownTime            // "HH:mm" — the one scan we have, null if both missing
boolean confirmedStart      // true if knownTime falls within a detection window
boolean missingStart        // true if entry scan is absent or ambiguous
boolean missingEnd          // true if exit scan is absent
String detectedAnchor       // "HH:mm" or null
```

- `confirmedStart = true`: knownTime pre-filled into start input (editable). Only end required.
- `confirmedStart = false`: knownTime shown as reference text only. Both inputs empty and required.

### Backend — ResolveRequest (received from client)
```java
String draftId
List<Resolution> resolutions

class Resolution {
    String employeeId
    String date             // "YYYY-MM-DD"
    String providedStart    // "HH:mm"
    String providedEnd      // "HH:mm"
}
```

### Backend — UploadResponse (updated)
Four new optional fields added to existing model:
```java
String draftId                              // null if no resolution needed
List<MissingTimeItem> missingTimes          // empty if no resolution needed
List<EmployeeSummary> reappearingEmployees  // empty if no inactive employees in file
List<EmployeeSummary> notPresentEmployees   // active employees absent from this file; computed at parse time, shown post-submit
```
All existing fields (`rows`, `monthOptions`, `multiMonth`, `parseWarnings`) unchanged.

`notPresentEmployees` is computed at parse time (active registry employees not found in the file) and returned in the upload response. The frontend stores it in state and surfaces it only after the SP submission completes — no changes to `/submit` or polling are needed.

### Backend — EmployeeSummary (new DTO, sent to client)
```java
String employeeId
String name
```
Used for both `reappearingEmployees` and the not-present review list. Intentionally minimal — the frontend only needs to identify and display the employee.

### Frontend — types.ts additions
```ts
export interface Employee {
  employeeId: string;
  name: string;
}

export interface MissingTimeItem {
  employeeId: string;
  employeeName: string;
  date: string;
  knownTime: string | null;
  confirmedStart: boolean;
  missingStart: boolean;
  missingEnd: boolean;
  detectedAnchor: string | null;
}

export interface Resolution {
  employeeId: string;
  date: string;
  providedStart: string;
  providedEnd: string;
}

export interface ResolveRequest {
  draftId: string;
  resolutions: Resolution[];
}

export interface ReappearanceDecision {
  employeeId: string;
  action: 'reactivate' | 'ignore';
}

// UploadResponse gains:
draftId?: string;
missingTimes?: MissingTimeItem[];
reappearingEmployees?: Employee[];
notPresentEmployees?: Employee[];  // stored in state, shown after SP submit completes

// AppState gains 'verifying', 'reappearance', and 'notPresentReview'
export type AppState = 'empty' | 'reappearance' | 'verifying' | 'loaded' | 'submitting' | 'polling' | 'notPresentReview' | 'result';
```

---

## 4. TasParserService Algorithm

Seven sequential phases:

### Phase 1 — Parse & Deduplicate
- Read file as UTF-8, strip BOM if present
- Skip header row
- Group events by `employeeId`
- Sort each employee's events chronologically
- Collapse consecutive events within **5 minutes** into one (keep earliest timestamp); applies to adjacent pairs after sorting

### Phase 2 — Session Grouping
Per `docs/tas_shift_rules.md` → Session Grouping.

- Walk sorted events per employee.
- A session opens when a scan falls within any configured shift's detection window (`startTime − 60 min` to `startTime + 10 min`).
- All subsequent scans belong to the open session until the next detection-window hit opens a new one.
- **Cross-midnight employees:** scans on day D+1 that fall within another shift's detection window are treated as exits for the D session, not new session openers. A new session for these employees only opens on a hit in their own shift's detection window.
- **Same-day double session:** two detection-window hits from different shifts on the same calendar day → flag for manual confirmation (`needsResolution = true`).
- Scan outside all detection windows with no open session → `needsResolution = true`, `confirmedStart = false`.

### Phase 3 — Shift Assignment, Mismatch Detection & Tardiness
Per `docs/tas_shift_rules.md` → Grace Period, Tardiness, and Shift Mismatch Detection.

- Match session's first scan to a shift's detection window → record `shiftAnchor = shift.startTime`.
- No window match → `needsResolution = true`.
- **Shift mismatch:** if the matched window belongs to a *different* shift than the employee's assigned shift, apply the mismatch rules from `docs/tas_shift_rules.md` → Shift Mismatch Detection:
  - Consistent across the entire quincena → surface suggestion to update saved config
  - Only on specific days → surface per-day exception in verification screen; saved config unchanged
- First scan ≤ `shiftAnchor + GRACE_PERIOD_MINUTES` → on time → `effectiveStart = shiftAnchor`.
- First scan > `shiftAnchor + GRACE_PERIOD_MINUTES` → late → `effectiveStart = firstScan`.

### Phase 4 — Hour Calculation
Per `docs/tas_shift_rules.md` → Worked Hours per Session and Break Deduction.

```
// Scans alternate entry/exit: scan[0]=entry, scan[1]=exit, scan[2]=entry, ...
// Odd-indexed gaps (gap[1], gap[3], ...) are time outside (breaks); even-indexed gaps are time inside
totalBreakGap   = gap[1] + gap[3] + gap[5] + ...  where gap[i] = scan[i+1] − scan[i]
deductibleBreak = max(0, totalBreakGap − legalBreakAllowance)
workedMinutes   = (lastScan − effectiveStart).totalMinutes − deductibleBreak
workedHours     = floor(workedMinutes / 30) / 2.0   // always X.0 or X.5
```

`legalBreakAllowance` is loaded from the Config table at parse time (default 45 min).

Sessions with `needsResolution = true` get `workedMinutes = 0` and `workedHours = 0.0`; held in the draft.

**Post-resolution re-run:** when Phase 4 re-runs after `/resolve` applies `providedEnd`, use `session.lastScan` (overwritten by the resolution) as the span endpoint — not `allScans.last()`. Break gap calculation still uses `allScans` for odd-indexed gaps. `lastScan` is the authoritative field for span; `allScans` is authoritative for break gaps only.

### Phase 5 — Quincena Split & Simples/Dobles
Per `docs/tas_shift_rules.md` → Weekly Hours: Simples vs. Dobles and Quincena Derivation.

Group resolved sessions by `(employeeId, month, quincena)`:
- Q1 = days 1–15; Q2 = days 16–end of month

Per session, classify hours as simples or dobles:
```
shiftDurationHours = duration between shift.startTime and shift.endTime, rounded to 0.5h
                     // cross-midnight: duration = (24h − startTime) + endTime

if session.date is Sunday or public holiday:
    dobles += workedHours
else:
    withinShift = min(workedHours, shiftDurationHours)
    beyondShift = max(0.0, workedHours − shiftDurationHours)
    simples += withinShift
    dobles  += beyondShift
```

Public holidays are fetched/loaded per `docs/tas_shift_rules.md` → Public Holidays.

### Phase 6 — Missing Scan Detection
Per `docs/tas_shift_rules.md` → Missing Scan Detection.

Flag sessions where:
- Last scan is more than **60 minutes** before `shift.endTime` → likely missing exit scan
- First scan is more than **60 minutes** after `shift.startTime + GRACE_PERIOD_MINUTES` → likely missing entry scan
- Session on first day of report period + cross-midnight shift → likely start cutoff
- Session on last day of report period → likely end cutoff

All flagged sessions get `needsResolution = true`.

### Phase 7 — Build Output Rows
For each `(employeeId, month, quincena)` group:
- `simplesHours` = total simples
- `doblesHours` = total dobles
- `nonWorkedDays` = count of Mon–Sat calendar days in the quincena with zero sessions (excluding Sundays and public holidays)
- `mes`, `anio`, `quincenaNumber` derived from group key

Employees with any unresolved sessions are excluded from returned rows (their sessions go into the draft).

---

## 5. Employee Registry

Per `docs/tas_shift_rules.md` → Employee Registry.

`EmployeeService` is responsible for:

1. **Auto-populate on upload:** for each employee in the parsed file, upsert into the `employees` table — insert if new (default `active = true`, default shift = Mañana), update `name` if changed.
2. **Not-present review:** after the main SP submission completes, return the list of `active = true` employees not present in the processed file. Excludes employees whose first-ever appearance is in this upload.
3. **Re-appearance flag:** before processing, check if any `active = false` employee appears in the file. Surface these to the user for Reactivar / Ignorar decision before proceeding.

---

## 6. TasDraftStore

`@Component` — `ConcurrentHashMap<String, TasDraft>`

```java
class TasDraft {
    Map<String, List<TasSession>> sessionsByEmployee
    UploadResponse partialResponse          // rows for fully-resolved employees
    List<EmployeeSummary> notPresentEmployees // preserved from original upload; returned with /resolve response
    Instant createdAt
}
```

- Draft ID: `UUID.randomUUID().toString()`
- TTL: **30 minutes** (checked lazily on `get`)
- `get()` returns `Optional.empty()` if expired or not found
- `remove()` called after successful resolve

---

## 7. POST /upload — Reappearance Decision Flow

When the initial upload detects `active = false` employees in the file, the response is returned immediately with `reappearingEmployees` populated and no rows computed yet. The frontend shows `ReappearanceScreen`; the user resolves each employee. The frontend then re-calls `POST /upload` with the same file plus a `decisions` field:

```java
// Added to the multipart upload request as an optional JSON part:
List<ReappearanceDecision> decisions  // one entry per reappearing employee

class ReappearanceDecision {
    String employeeId
    String action  // "reactivate" | "ignore"
}
```

On re-upload with decisions:
1. Set `active = true` for all `employeeId` where `action = "reactivate"`
2. Exclude scans for all `employeeId` where `action = "ignore"` before processing
3. Proceed with normal parse pipeline

`api.ts` adds: `uploadFile(file: File, decisions?: ReappearanceDecision[]): Promise<UploadResponse>`

---

## 8. POST /resolve Endpoint

**Request:** `ResolveRequest`
**Response:** `UploadResponse` (same shape as upload)

Steps:
1. Fetch draft — return 404 if missing or expired
2. Validate all resolutions are present — return 400 with remaining unresolved items if any are missing
3. For each resolution, find matching session by `(employeeId, date)`, apply `providedStart`/`providedEnd` as `effectiveStart`/`lastScan`, clear `needsResolution`
4. Re-run Phases 4–7 for affected employees only
5. Merge newly computed rows into `partialResponse`
6. Remove draft from store
7. Return merged `UploadResponse` with empty `draftId` and `missingTimes`; **carry `notPresentEmployees` from `partialResponse`** so the frontend not-present review is not lost on the verifying path

---

## 9. Config Page API Endpoints

All endpoints return JSON. All mutating endpoints return the updated resource or 204 No Content.

### Shifts
| Method | Path | Description |
|---|---|---|
| `GET` | `/shifts` | List all shifts |
| `POST` | `/shifts` | Create shift (`name`, `startTime`, `endTime`) |
| `PUT` | `/shifts/{id}` | Update shift |
| `DELETE` | `/shifts/{id}` | Delete shift — returns 409 if any active employee is assigned |

### Employees
| Method | Path | Description |
|---|---|---|
| `GET` | `/employees` | List all employees (supports `?active=true\|false&shiftId=` filters) |
| `PUT` | `/employees/{id}` | Update employee (`shiftId`, `active`) — used by Config page and NotPresentReview |
| `PUT` | `/employees/bulk-shift` | Bulk shift assignment (`{employeeIds: [], shiftId}`) |

### Holidays
| Method | Path | Description |
|---|---|---|
| `GET` | `/holidays/{year}` | List holidays for year |
| `POST` | `/holidays` | Add manual holiday (`date`, `name`) |
| `DELETE` | `/holidays/{date}` | Remove holiday |
| `POST` | `/holidays/reload/{year}` | Fetch holidays from Nager.Date API for year; replaces non-manual entries |

### Config
| Method | Path | Description |
|---|---|---|
| `GET` | `/config` | Get global config (`legalBreakAllowance`) |
| `PUT` | `/config` | Update global config |

The `NotPresentReview` mark-inactive action calls `PUT /employees/{id}` with `{active: false}`. The store action `deactivateEmployee(employeeId)` calls this endpoint, updates `notPresentEmployees` in state, and removes the deactivated employee from the list.

---

## 10. Frontend — ReappearanceScreen

Shown when `appState === 'reappearance'`. Appears before processing begins, immediately after upload, when one or more `active = false` employees have scans in the file.

Per `docs/tas_shift_rules.md` → Employee Registry → Re-appearance.

Layout: one row per reappearing employee showing name and ID, with two actions per row:
- **Reactivar y enviar** — sets `active = true` for that employee; their scans are included in the upload
- **Ignorar** — their scans are excluded from this upload; employee remains `active = false`

All rows must be resolved before processing continues. Once all decisions are made, the user confirms and the upload proceeds (with the reactivated employees' scans included, ignored employees' scans excluded).

---

## 11. Frontend — MissingTimesScreen

Shown when `appState === 'verifying'`.

Layout: one row per `MissingTimeItem` in a table/form:
- Employee name + date (read-only)
- **Inicio** input: pre-filled with `knownTime` if `confirmedStart = true` (editable); empty if `confirmedStart = false`
- **Fin** input: always empty, always required
- If `confirmedStart = false`: `knownTime` shown as small reference text below the row ("Escaneo registrado: HH:mm")
- If `detectedAnchor` not null: shown as hint ("Turno detectado: HH:mm")

Both Inicio and Fin are always editable `HH:mm` inputs. Submit button disabled until all rows have values. On submit:
1. Call `resolveMissingTimes(draftId, resolutions)`
2. On success → `setLoaded(response)` → transitions to `loaded` → then triggers not-present review
3. On 400 → show inline error listing still-unresolved items
4. On other error → show generic error message

---

## 12. Frontend — NotPresentReview

Shown when `appState === 'notPresentReview'`. Appears after the SP submission completes.

Displays the list of active employees with zero scans in the processed file. Each row shows employee name, ID, and an action to mark `active = false`. No action required — user may dismiss any row. Confirming navigates to `result`.

Per `docs/tas_shift_rules.md` → Employee Registry → Not-Present Review.

---

## 13. Store Changes

New state slices:
```ts
draftId: string | null                      // set during 'verifying', cleared after resolve
missingTimes: MissingTimeItem[]             // set during 'verifying', cleared after resolve
reappearingEmployees: Employee[]            // set during 'reappearance', cleared after decisions
notPresentEmployees: Employee[]             // set at upload time, shown after SP submit completes
pendingDecisions: ReappearanceDecision[]    // accumulates user decisions in ReappearanceScreen
```

New actions:
```ts
setReappearance(employees: Employee[]): void
// sets appState = 'reappearance', stores reappearingEmployees

setVerifying(draftId: string, missingTimes: MissingTimeItem[]): void
// sets appState = 'verifying', stores draftId + missingTimes

setNotPresentReview(employees: Employee[]): void
// sets appState = 'notPresentReview', stores notPresentEmployees
```

Updated `uploadFile(file, decisions?)` action:
1. Call `POST /upload` with file (and `decisions` if provided)
2. If response has non-empty `reappearingEmployees` → call `setReappearance`; user resolves decisions → re-call `uploadFile(file, decisions)`
3. Store `notPresentEmployees` from response regardless of path (shown post-submit)
4. If response has non-empty `missingTimes` → call `setVerifying`
5. Else → call existing `setLoaded`

Updated `submitData` action:
- On success → if `notPresentEmployees` non-empty → call `setNotPresentReview`; else → transition to `result`

Zustand selector pattern (per project convention): all new fields use individual `useStore(s => s.field)` selectors — no inline object selectors.

---

## 14. Test Coverage

### Backend
- `TasParserServiceTest`: unit tests covering all seven phases — deduplication, window-based session grouping, cross-midnight stitching, tardiness (exact firstScan, not chunks), break deduction, 0.5h rounding, per-day simples/dobles split, Sunday dobles, public holiday dobles, missing scan detection, Q1/Q2 boundary, shift mismatch detection
- `TasDraftStoreTest`: TTL expiry, concurrent access, remove-on-resolve, notPresentEmployees preserved in draft
- `EmployeeServiceTest`: upsert on upload, not-present list logic, re-appearance detection, deactivate
- `ShiftServiceTest`: CRUD, 409 on delete with active employees, delete allowed with only inactive employees
- `HolidayServiceTest`: reload from API, fallback to bundled list, manual entries not overwritten on reload
- `UploadControllerTest`: updated for TAS file input; with and without missing times; with reappearing employees
- `ResolveControllerTest`: valid resolve, 404 on bad draftId, 400 on incomplete resolutions, TTL expiry, notPresentEmployees carried in response
- `ConfigControllerTest`: get and update legalBreakAllowance

### Frontend
- `ReappearanceScreen.test.tsx`: renders reappearing employees, Reactivar sets active, Ignorar excludes scans, all rows must be resolved before proceeding
- `MissingTimesScreen.test.tsx`: renders all items, disables submit until complete, calls resolve on submit, shows error on 400
- `NotPresentReview.test.tsx`: renders not-present list, handles mark-inactive action, navigates to result on dismiss
- `ConfigPage.test.tsx`: renders all four tabs, shift delete blocked when active employees assigned, bulk shift assignment, holiday reload button, legalBreakAllowance save
- `store.test.ts`: new state transitions including `reappearance`, `verifying`, and `notPresentReview`; deactivateEmployee removes from notPresentEmployees
- `api.test.ts`: `resolveMissingTimes`, Config page CRUD call shapes
- `App.test.tsx`: renders correct screen for each `appState`

---

## 15. Out of Scope

- No changes to `/validate`, `/submit`, job polling, or `ResultScreen`
- No changes to `DataGrid`, `QuincenaBanner`, or `ActionBar`
- The old multi-block CSV format is fully removed with no backwards compatibility
