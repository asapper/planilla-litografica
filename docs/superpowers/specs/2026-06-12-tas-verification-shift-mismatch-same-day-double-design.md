# TAS Verification Screen — Shift Mismatch & Same-Day Double Redesign

## Background

[TASK-17](../plans/2026-06-12-tas-verification-pill-scan-info.md) added pill enrichment and a
backend fix (`setRawScanBounds`) that populates `effectiveStart`/`lastScan` for every
session shown on the verification screen — including sessions whose blocking flag is
`SHIFT_MISMATCH` or `SAME_DAY_DOUBLE`, not just `MISSING_ENTRY`/`MISSING_EXIT`.

That fix exposed two problems:

1. **A pre-existing frontend bug**: `toHHMM()` assumes `effectiveStart`/`lastScan` are
   `"HH:MM:SS"` strings, but the backend serializes `LocalDateTime` as full ISO
   `"yyyy-MM-ddTHH:mm:ss"`. Now that these fields are populated for blocked sessions,
   `toHHMM` mangles them, producing `"Horas calculadas: NaNh"`.

2. **A UX gap**: for `SHIFT_MISMATCH` and `SAME_DAY_DOUBLE` sessions, the entry/exit time
   fields and "Horas calculadas" are meaningless — these sessions have complete scan
   data; nothing about the *times* needs fixing. What the user actually needs to resolve
   is a **shift assignment** question (mismatch) or a **which-session-counts** question
   (same-day double).

## Scope

1. Fix `toHHMM` to correctly parse ISO datetime strings.
2. Redesign the `SHIFT_MISMATCH`-only session card: remove time fields, show a
   confirmation of which shift will be applied, with an inline override dropdown.
3. Redesign the `SAME_DAY_DOUBLE` session group: remove time fields, let the user choose
   "keep all" or "keep only this session" per employee/date.
4. Extend the `/api/tas/resolve` endpoint and `TasSession`/upload-result models to
   support both new resolution types.

Out of scope: `START_CUTOFF`/`END_CUTOFF` handling (unchanged), `MISSING_ENTRY`/
`MISSING_EXIT` flows (unchanged, already working from TASK-17).

## Design

### 1. `toHHMM` fix

```ts
function toHHMM(timeStr: string | null): string {
  if (!timeStr) return '';
  const timePart = timeStr.includes('T') ? timeStr.split('T')[1] : timeStr;
  return timePart.slice(0, 5);
}
```
Handles both `"2026-03-10T07:00:00"` (real backend data) and `"07:00:00"` (existing test
fixtures) identically.

### 2. SHIFT_MISMATCH redesign

**Backend — `TasSession` additions:**
- `assignedShiftId: String`, `assignedShiftName: String` — the employee's normally
  assigned shift (looked up via the existing `employeeShiftAssignments` map in
  `TasUploadService`).
- `matchedShiftName: String` — human-readable name for the already-present
  `matchedShiftId` (the shift detected from the actual scan times).

**Backend — upload/resolve response additions:**
- `availableShifts: [{ id, name, startTime, endTime }]` — full shift list, included once
  at the top level of `TasUploadResult`/`TasResolveResult`, for populating the override
  dropdown.

**Frontend — `SessionCard`:**
When a session's flags are *only* `SHIFT_MISMATCH` (no `MISSING_ENTRY`/`MISSING_EXIT`/
`SAME_DAY_DOUBLE`), hide the Entrada/Salida inputs and "Horas calculadas" entirely.
Instead show:

> Turno asignado: **{assignedShiftName}** → se aplicará **{matchedShiftName}
> ({matchedShift.startTime}–{matchedShift.endTime})** según las marcaciones.
> [Elegir otro turno]

Clicking "Elegir otro turno" reveals (inline, replacing the link) a `<select>` populated
from `availableShifts`, pre-selected to `matchedShiftId`, with "Aplicar"/"Cancelar"
buttons. "Aplicar" sets local state to the chosen shift id and re-collapses to the
confirmation message (now reflecting the chosen shift's name/times). "Cancelar" collapses
without changing the selection.

`canConfirm` for this card is always `true` (nothing required from the user beyond
acknowledging via "Confirmar").

### 3. SAME_DAY_DOUBLE redesign

**Frontend — grouping:** Before rendering, group `needsResolutionSessions` that carry
`SAME_DAY_DOUBLE` by `(employeeId, date)`. Render one group card per group instead of one
card per session.

**Group card contents:** employee name + date header, then for each session in the
group a radio option showing its matched shift name and its scan times (read-only,
informational — e.g. "Mañana (07:00–15:00) — marcaciones: 07:02, 15:05"), plus one
additional radio: "Mantener todas". Default selection: "Mantener todas". Single
"Confirmar" button for the whole group (`canConfirm` always `true`).

### 4. Resolve endpoint extensions

`/api/tas/resolve` `resolutions` entries gain two new optional shapes, alongside the
existing `{ sessionId, resolvedStart, resolvedEnd }`:

- **Shift mismatch acceptance:** `{ sessionId, acceptedShiftId }`. Backend sets
  `session.setMatchedShiftId(acceptedShiftId)`, removes `SHIFT_MISMATCH` from
  `session.getFlags()`. If no blocking flags remain, calls `computeWorkedHours` (using
  the new `matchedShiftId` for grace-period calc) + `classifyHours`, sets
  `needsResolution(false)`.

- **Same-day double resolution:** `{ employeeId, date, keepSessionId }` where
  `keepSessionId` is either a session id (number) or the literal `"all"`.
  - For the kept session(s) (all of them if `"all"`, otherwise just `keepSessionId`):
    remove `SAME_DAY_DOUBLE` from flags; if no blocking flags remain, run
    `computeWorkedHours` + `classifyHours`, `needsResolution(false)`.
  - For discarded sessions (only when `keepSessionId` is a specific id): remove
    `SAME_DAY_DOUBLE` from flags, set `workedMinutes=0`, `workedHours=0.0`,
    `simplesMinutes=0`, `doblesMinutes=0`, `needsResolution(false)`. These contribute
    nothing to `TasReportBuilder`'s totals (it already skips accumulation based on
    minutes being zero / `needsResolution`).

## Testing

- `toHHMM`: unit tests for both `"2026-03-10T07:00:00"` and `"07:00:00"` inputs, and
  `null`.
- `SessionCard` (SHIFT_MISMATCH-only): renders confirmation message with
  assigned/matched shift names; no time inputs; override dropdown flow (select different
  shift → Aplicar → message updates → Confirmar sends `acceptedShiftId`).
- `SessionCard` group (SAME_DAY_DOUBLE): renders one card per `(employeeId, date)` group
  with N+1 radio options; default "Mantener todas"; Confirmar sends correct
  `keepSessionId`.
- `TasHoursCalculator`/`TasController` resolve: both new resolution shapes — shift
  acceptance recomputes hours with new shift; same-day-double "all" recomputes all
  sessions; same-day-double with specific id zeroes out the discarded sessions and
  recomputes the kept one.
- `TasUploadService`: `assignedShiftId`/`assignedShiftName`/`matchedShiftName` populated
  on `TasSession`; `availableShifts` present in upload result.
