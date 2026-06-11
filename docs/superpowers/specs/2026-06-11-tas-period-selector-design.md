# TAS Period Selector (Verification Screen) — Design

## Context

TASK-34: When a TAS upload contains scans spanning multiple quincenas (and/or months), `TasReportBuilder` produces one `ResolvedRow`/`EmployeeRow` per employee per period present in the data, and the review screen shows all of them together — for an employee with scans across two quincenas, this means two rows for the same employee, which is confusing (the user expects one row per employee for "the period" they're submitting).

Per `docs/tas_shift_rules.md`, multi-quincena/multi-month files are technically supported, but in practice the system processes **one quincena per submission** (`carga_datos_empleados` is called once per employee per quincena, and a single "Enviar" produces a single job/result).

## Decision: scope the period at verification, not at review

The user picks **one quincena/month to work on** at the verification step — only that period's flagged sessions need resolving for "Enviar" to enable. `resolveVerification`/`resolve` then computes `resolvedRows` for that period only, so the review screen naturally shows one row per employee with no need for its own selector.

Switching the period selector at verification time is **non-destructive**: resolutions already entered are kept in frontend state (`resolvedSessions`, keyed by `sessionId`) regardless of which period is currently displayed. The user can go back and forth freely before submitting.

Submitting clears the whole upload token/state (existing behavior, unchanged) — any other period's data is discarded. To process another period from the same file, the user re-uploads it, which re-flags all sessions (including the already-submitted period's) for re-verification. This re-verification cost is accepted as an edge case (most uploads are pre-split by quincena).

## Out of scope

- Confirmation dialogs before submit.
- A period selector on the review screen (no longer needed — `resolvedRows` will only ever contain one period).
- Avoiding the re-verification cost when processing a second period from the same file (would require restructuring the upload/verification pipeline; deferred).

## Known bug fixed as part of this work

`TasReportBuilder.build()` currently groups by **quincena number only** (`1` or `2`), not by `(year, month, quincena)`. For a file spanning two different months (e.g. April Q2 and May Q1), sessions from both would be merged into the same "quincena 2" / "quincena 1" buckets respectively, producing incorrect totals. This must be fixed to `(year, month, quincena)` grouping for the period filter (below) to work correctly, and is a correctness fix in its own right.

## Backend changes

### New shared helper: period key

Add a small helper (e.g. `TasPeriod` record or static method) to compute `(anio, mes, numeroDequincena)` from a `LocalDate`:

```java
public record TasPeriod(int anio, int mes, int numeroDequincena) {
    public static TasPeriod of(LocalDate date) {
        return new TasPeriod(date.getYear(), date.getMonthValue(),
                date.getDayOfMonth() <= 15 ? 1 : 2);
    }
}
```

Use this in `TasReportBuilder` (replacing the quincena-only grouping in `minutesByEmployeeQuincena`, `ambiguousDaysByEmpQuincena`, and `detectConsistentMismatches`'s per-quincena maps) and in the controller for filtering.

### `TasReportBuilder.build()`

- Group all per-employee accumulation maps by `TasPeriod` instead of `int quincena`.
- Add a `TasPeriod periodFilter` parameter (nullable). When non-null, only sessions whose `TasPeriod` equals `periodFilter` contribute to the output, and only one row per employee is produced (for that period). When null, behaves as today (all periods) — used internally for computing `availablePeriods` (see below), not for row generation in the new flow.
- `EmployeeRow.mes`/`anio`/`numeroDequincena` are set directly from the `TasPeriod` being built, rather than derived from `reportStart`.

### `availablePeriods` response field

Add to the `/upload` and `/resolve` response bodies:

```json
"availablePeriods": [
  { "anio": 2026, "mes": 4, "numeroDequincena": 1, "pendingCount": 2 },
  { "anio": 2026, "mes": 4, "numeroDequincena": 2, "pendingCount": 0 }
]
```

- Computed from `state.getSessions()` (all sessions, not just flagged), grouped by `TasPeriod`, sorted chronologically (by anio, mes, numeroDequincena).
- `pendingCount` = number of sessions in that period with `needsResolution == true` (recomputed after each `/resolve` call, so it reflects resolutions applied so far).
- Always present, even if there's only one period (frontend decides whether to show the dropdown).

### `/api/tas/resolve` (verification "Enviar")

- Request body gains `mes`, `anio`, `numeroDequincena` — the selected period.
- Apply submitted `resolutions` exactly as today (resolutions for sessions outside the selected period are harmless to apply — they're discarded with the rest of the state on submit, but applying them now avoids re-asking if the user later returns to the same period before submitting).
- Compute `remainingFlagged` as today (all sessions still needing resolution, across all periods) — used for `availablePeriods.pendingCount`.
- Call `TasReportBuilder.build(sessions, reportStart, reportEnd, shifts, TasPeriod.of(selected))` — i.e. **with the period filter** — and set `state.setResolvedRows(...)` to just that period's row(s).
- Response gains `availablePeriods` (see above). `resolvedRows` now contains at most one row per employee (for the selected period).

### `/api/tas/submit`

No change needed beyond what already exists — `resolvedRows` will already be scoped to the one period the user worked on.

## Frontend changes

### `tasTypes.ts`

```ts
export interface TasPeriod { anio: number; mes: number; numeroDequincena: number }
export interface AvailablePeriod extends TasPeriod { pendingCount: number }
```

Add `availablePeriods: AvailablePeriod[]` to `TasUploadResult` and `TasResolveResult`.

### `tasStore.ts`

- Add `availablePeriods: AvailablePeriod[]` and `selectedPeriod: TasPeriod | null` to state, with setters.
- On receiving `availablePeriods` from upload/resolve, if `selectedPeriod` is null (or no longer present in the list), default it to the **earliest** period (first after sorting by anio, mes, numeroDequincena).

### `VerificationScreen.tsx`

- New period dropdown, shown only when `availablePeriods.length > 1`. Label format: `"<Mes capitalizado> <Año> - Quincena <N>"` (e.g. "Abril 2026 - Quincena 1"), using a Spanish month-name array (full names — reuse/extract the one in `HolidaysTab.tsx` rather than the abbreviated one already in this file).
- Filter `needsResolutionSessions` to sessions whose `TasPeriod.of(session.date)` matches `selectedPeriod` (combined with the existing flag-based filter chips — both apply).
- `pendingCount` for the "X por resolver" badge and `allConfirmed` (which gates "Enviar") come from `availablePeriods.find(p => matches selectedPeriod).pendingCount`, not from `needsResolutionSessions.length` globally.
- `handleSubmit` includes `selectedPeriod`'s `mes`/`anio`/`numeroDequincena` in the `resolveVerification` request body.
- After a successful `resolveVerification`, if the *selected period's* `pendingCount` (from the new `availablePeriods`) is `0`, proceed to `review` as today; otherwise stay on verification.
- Inline note (always visible, not just when multiple periods exist — keeps messaging consistent): *"Solo se enviará el periodo seleccionado. Para procesar otros periodos, vuelva a cargar el archivo."*

### `ReviewScreen.tsx`

No changes — `resolvedRows` will contain one row per employee already.

### `tasApi.ts`

- `resolveVerification(token, resolutions, period)` — add the period object to the request body.

## Testing

- Backend: `TasReportBuilderTest` — new cases for `(year, month, quincena)` grouping (multi-month file), and for the `periodFilter` parameter (only the matching period's sessions/rows are produced).
- Backend: `TasControllerTest` (or equivalent) — `/resolve` with a period param scopes `resolvedRows` and the stay-on-verification decision correctly; `availablePeriods`/`pendingCount` shape on `/upload` and `/resolve`.
- Frontend: `VerificationScreen.test.tsx` — dropdown rendering (hidden for single period), filtering by period, "Enviar" gating based on selected period's `pendingCount`, request body includes selected period.
- Frontend: existing `ReviewScreen.test.tsx` should need no changes (single row per employee already assumed by most fixtures).
