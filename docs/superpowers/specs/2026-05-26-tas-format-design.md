# TAS Biometric Format — Design Spec

**Date:** 2026-05-26
**Status:** Approved for implementation
**Author:** Atlas (Claude Code)

---

## Overview

Replace the old multi-block CSV parser with a new TAS biometric event log parser. The TAS format is a flat CSV of door-access scan events. The system must derive shift start/end times, calculate worked hours, apply simples/dobles rules, and surface a mandatory verification screen when scan data is incomplete or ambiguous.

The old `CsvParserService` is deleted. All other existing flows (validate, submit, job polling) are unchanged.

Business rules are maintained separately in `docs/tas_shift_rules.md`.

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
- **New:** `TasParserService.java`, `TasDraftStore.java`, `TasSession.java`, `MissingTimeItem.java`, `ResolveRequest.java`
- **Updated:** `UploadController.java`, `UploadResponse` model, `CsvParserServiceTest` → `TasParserServiceTest`
- **New endpoint:** `POST /resolve`
- **Frontend new:** `MissingTimesScreen.tsx`, `MissingTimesScreen.test.tsx`
- **Frontend updated:** `types.ts`, `store.ts`, `store.test.ts`, `api.ts`, `api.test.ts`, `App.tsx`, `App.test.tsx`

### App state flow
```
empty
  → upload (no missing times) → loaded
  → upload (missing times)    → verifying → resolve → loaded
loaded → submitting → polling → result
```

---

## 3. Data Models

### Backend — TasSession (internal)
```java
String employeeId
String employeeName
LocalDate date              // shift date (start date of session)
LocalDateTime firstScan
LocalDateTime lastScan
LocalTime shiftAnchor       // 07:00, 15:00, 19:00, or null if ambiguous
LocalDateTime effectiveStart // null until resolved
int workedHours             // 0 until resolved
boolean needsResolution
boolean missingStart
boolean missingEnd
```

### Backend — MissingTimeItem (sent to client)
```java
String employeeId
String employeeName
String date                 // "YYYY-MM-DD"
String knownTime            // "HH:mm" — the one scan we have, null if both missing
boolean confirmedStart      // true if knownTime falls within a detection window (pre-fill start)
String detectedAnchor       // "07:00" / "15:00" / "19:00" / null
```

- `confirmedStart = true`: knownTime is pre-filled into the start input (editable). Only end is required from the client.
- `confirmedStart = false`: knownTime shown as reference text only. Both start and end inputs are empty and required.

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
Two new optional fields added to existing model:
```java
String draftId              // null if no resolution needed
List<MissingTimeItem> missingTimes  // empty if no resolution needed
```
All existing fields (`rows`, `monthOptions`, `multiMonth`, `parseWarnings`) unchanged.

### Frontend — types.ts additions
```ts
export interface MissingTimeItem {
  employeeId: string;
  employeeName: string;
  date: string;
  knownTime: string | null;
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

// UploadResponse gains:
draftId?: string;
missingTimes?: MissingTimeItem[];

// AppState gains 'verifying'
export type AppState = 'empty' | 'verifying' | 'loaded' | 'submitting' | 'polling' | 'result';
```

---

## 4. TasParserService Algorithm

Six sequential phases:

### Phase 1 — Parse & Deduplicate
- Read file as UTF-8, strip BOM if present
- Skip header row
- Group events by `employeeId`
- Sort each employee's events chronologically
- Collapse consecutive events within **5 minutes** into one (keep earliest)

### Phase 2 — Session Grouping
- Walk sorted events per employee
- Start a new session when gap from previous event is **≥ 12 hours**
- Each session: all events, first timestamp, last timestamp

### Phase 3 — Shift Assignment & Tardiness
Detection windows:

| Anchor | Window |
|---|---|
| 07:00 (morning) | 06:00–07:10 |
| 15:00 (afternoon) | 14:00–15:10 |
| 19:00 (night) | 18:00–19:10 |

- First scan in a window → assign anchor
- First scan outside all windows → `needsResolution = true`

Single-scan sessions:
- Scan falls **within** a detection window → `confirmedStart = true`, `knownTime = scan time`, `needsResolution = true` (missing end). Start is pre-filled but editable in the UI.
- Scan falls **outside** all detection windows → `confirmedStart = false`, `knownTime = scan time` (shown as reference only), `needsResolution = true` (both start and end required from client).

Tardiness (only when anchor is assigned and first scan > anchor + 10 min):
```
effectiveStart = anchor + ceil((firstScan − anchor) / 30min) × 30min
```

On time (first scan ≤ anchor + 10 min):
```
effectiveStart = anchor
```

### Phase 4 — Hour Calculation
```
workedHours = floor((lastScan − effectiveStart).totalMinutes / 60)
```
Sessions with `needsResolution = true` get `workedHours = 0` and are held in the draft.

### Phase 5 — Quincena Split & Simples/Dobles Accumulation
Group resolved sessions by `(employeeId, month, quincena)`:
- Q1 = days 1–15; Q2 = days 16–end

Within each quincena group, process sessions chronologically with a `weeklyTotal` counter:

Reset `weeklyTotal = 0` on:
- Each Monday within the quincena
- The 16th of the month (Q2 start), regardless of day of week

Per session:
```
if session.date is Sunday:
    dobles += workedHours
else if weeklyTotal + workedHours ≤ 44:
    simples += workedHours
    weeklyTotal += workedHours
else:
    simplesPart = max(0, 44 − weeklyTotal)
    dobles += (workedHours − simplesPart)
    simples += simplesPart
    weeklyTotal = 44  // capped
```

### Phase 6 — Build Output Rows
For each `(employeeId, month, quincena)` group:
- `horasExtrasSimples` = total simples
- `horasExtrasDobles` = total dobles
- `diasNoLaborados` = count of Mon–Sat calendar days in the quincena with zero sessions
- `mes`, `anio`, `numeroDequincena` derived from group key

Employees with any unresolved sessions are excluded from the returned rows (their sessions go into the draft).

---

## 5. TasDraftStore

`@Component` — `ConcurrentHashMap<String, TasDraft>`

```java
class TasDraft {
    Map<String, List<TasSession>> sessionsByEmployee
    UploadResponse partialResponse   // rows for fully-resolved employees
    Instant createdAt
}
```

- Draft ID: `UUID.randomUUID().toString()`
- TTL: **30 minutes** (checked lazily on `get`)
- `get()` returns `Optional.empty()` if expired or not found
- `remove()` called after successful resolve

---

## 6. POST /resolve Endpoint

**Request:** `ResolveRequest`
**Response:** `UploadResponse` (same shape as upload)

Steps:
1. Fetch draft — return 404 if missing or expired
2. Validate all resolutions are present — return 400 with remaining unresolved items if any are missing
3. For each resolution, find matching session by `(employeeId, date)`, apply `providedStart`/`providedEnd` as `effectiveStart`/`lastScan`, clear `needsResolution`
4. Re-run Phases 4–6 for affected employees only
5. Merge newly computed rows into `partialResponse`
6. Remove draft from store
7. Return merged `UploadResponse` with empty `draftId` and `missingTimes`

---

## 7. Frontend — MissingTimesScreen

Shown when `appState === 'verifying'`.

Layout: one row per `MissingTimeItem` in a table/form:
- Employee name + date (read-only)
- **Inicio** input: pre-filled with `knownTime` if `confirmedStart = true` (editable); empty if `confirmedStart = false`
- **Fin** input: always empty, always required
- If `confirmedStart = false`: `knownTime` shown as small reference text below the row ("Escaneo registrado: HH:mm")
- If `detectedAnchor` not null: shown as hint ("Turno detectado: HH:mm")

Both Inicio and Fin are always editable `HH:mm` inputs. Submit button disabled until all Inicio and Fin fields across all rows have a value. On submit:
1. Call `resolveMissingTimes(draftId, resolutions)`
2. On success → `setLoaded(response)` → transitions to `loaded`
3. On 400 → show inline error listing still-unresolved items
4. On other error → show generic error message

---

## 8. Store Changes

New state slices:
```ts
draftId: string | null        // set during 'verifying', cleared after resolve
missingTimes: MissingTimeItem[] // set during 'verifying', cleared after resolve
```

New actions:
```ts
setVerifying(draftId: string, missingTimes: MissingTimeItem[]): void
// sets appState = 'verifying', stores draftId + missingTimes
```

Updated `uploadFile` action:
- If response has non-empty `missingTimes` → call `setVerifying`
- Else → call existing `setLoaded`

Zustand selector pattern (per project convention): all new fields use individual `useStore(s => s.field)` selectors — no inline object selectors.

---

## 9. Test Coverage

### Backend
- `TasParserServiceTest`: unit tests covering all six phases — deduplication, session splits, each detection window, tardiness chunk calculation, floor rounding, simples/dobles weekly accumulation, Q1/Q2 boundary, partial weeks, Sunday dobles, missing/ambiguous detection
- `TasDraftStoreTest`: TTL expiry, concurrent access, remove-on-resolve
- `UploadControllerTest`: updated for TAS file input; test with and without missing times
- New `ResolveControllerTest`: valid resolve, 404 on bad draftId, 400 on incomplete resolutions, TTL expiry during resolve

### Frontend
- `MissingTimesScreen.test.tsx`: renders all items, disables submit until complete, calls resolve on submit, shows error on 400
- `store.test.ts`: new `verifying` state transitions
- `api.test.ts`: `resolveMissingTimes` call shape
- `App.test.tsx`: renders `MissingTimesScreen` when `appState === 'verifying'`

---

## 10. Out of Scope

- No changes to `/validate`, `/submit`, job polling, or `ResultScreen`
- No changes to `DataGrid`, `QuincenaBanner`, or `ActionBar`
- No database schema changes
- No authentication changes
- The old multi-block CSV format is fully removed with no backwards compatibility
