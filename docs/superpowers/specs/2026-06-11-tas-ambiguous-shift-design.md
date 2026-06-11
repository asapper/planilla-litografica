# TAS Ambiguous-Shift Session Handling — Design

## Context

TASK-32: When an employee's scans for a day don't fall within any configured shift's detection window (start − 60min to start + 10min), `TasSessionGrouper` currently silently drops those scans — no session is created at all. If this happens for every session of every employee in a file, `resolvedRows` ends up empty and the upload fails with `400 NO_ROWS`.

Reproduced with employee 134 (Roberto Daniel Morales): assigned shift "Mañana" (07:00-15:00, window 06:00-07:10), but actual scans are ~08:51-09:02 entry / ~19:11-21:42 exit — outside the detection windows of all three configured shifts (Mañana, Tarde 14:00-15:10, Noche 18:00-19:10).

`docs/tas_shift_rules.md` § "Shift Mismatch Detection" item 3 currently says: *"If no shift matches → flag as ambiguous; client provides start and end manually."* This is wrong for cases like employee 134 — the scans themselves are valid and form a coherent ~10h session; the problem is the shift configuration, not the scans. The fix should use the real scans as-is rather than asking the user to type in times that already exist in the data.

## Scope

In scope:
- New `TasFlag.AMBIGUOUS_SHIFT` and session-formation fallback in `TasSessionGrouper`.
- `TasHoursCalculator` change so this flag doesn't block hours computation.
- `detectSameDayDouble` fix for the rare two-ambiguous-sessions-same-day case.
- `TasReportBuilder` / `EmployeeRow` / `ResolvedRow` addition to surface a per-employee count.
- `ReviewScreen` badge to surface the count to the user.
- `docs/tas_shift_rules.md` updates.

Out of scope (deferred to TASK-33):
- Redefinition of `horas_extras_simples`/`dobles` (week vs. weekend/holiday split) and the "no overtime accrual" config flag. The 8h default used here for the simples/dobles split is the **existing** fallback (`computeShiftDurationMinutes` already returns 480 when no shift matches) — TASK-33 will revisit this.

## TasFlag

Add:

```java
public enum TasFlag {
    MISSING_ENTRY,
    MISSING_EXIT,
    SHIFT_MISMATCH,
    SAME_DAY_DOUBLE,
    START_CUTOFF,
    END_CUTOFF,
    AMBIGUOUS_SHIFT
}
```

`AMBIGUOUS_SHIFT` means: the first scan of this session does not fall inside the detection window of *any* configured shift (not the assigned shift, and not any alternate — that's `SHIFT_MISMATCH`'s job, which requires a match against a *different* shift's window).

## TasSessionGrouper changes

### Session formation fallback

Today, in `groupEmployeeSessions`, when `currentSession == null` and `findOpenerShift(...)` returns `null`, the scan is `continue`d (dropped). Change this to open an **ambiguous session** instead:

```java
if (currentSession == null) {
    Map<String, Object> openerShift = findOpenerShift(scan.getTimestamp(), shifts, assignedShift, isCrossMidnight);
    currentSession = openerShift != null
        ? openSession(employeeId, scan, openerShift, assignedShift, isCrossMidnight)
        : openAmbiguousSession(employeeId, scan);
}
```

`openAmbiguousSession`:

```java
private TasSession openAmbiguousSession(String employeeId, TasScanRecord firstScan) {
    TasSession session = new TasSession();
    session.setEmployeeId(employeeId);
    session.setEmployeeName(firstScan.getEmployeeName());
    session.setDate(firstScan.getTimestamp().toLocalDate());
    session.setCrossMidnight(false);
    session.setSessionAnchor("D");
    session.setFlags(new ArrayList<>(List.of(TasFlag.AMBIGUOUS_SHIFT)));
    List<LocalDateTime> scans = new ArrayList<>();
    scans.add(firstScan.getTimestamp());
    session.setScans(scans);
    session.setMatchedShiftId(null); // marker: this session matched no shift
    return session;
}
```

`matchedShiftId == null` is the marker for "this is an ambiguous session" — every real configured shift has a non-null `id` (per `seed-shifts.sql`), so this can't collide with a normal session.

### Accumulating scans into an ambiguous session

The existing "ongoing session" branch only re-evaluates whether to close the session when `currentSession.getScans().size() == 1`. For ambiguous sessions we need an explicit, always-checked closing condition: a new scan closes the current ambiguous session if it falls on a **different calendar day**, or if it would make the session span more than **12 hours** from its first scan. Add this check before the existing logic:

```java
} else {
    if (isNextShiftExitScan(scan.getTimestamp(), currentSession, shifts, assignedShift)) {
        currentSession.getScans().add(scan.getTimestamp());
        finalizeSession(currentSession);
        sessions.add(currentSession);
        currentSession = null;
        continue;
    }

    if (currentSession.getMatchedShiftId() == null) {
        LocalDateTime sessionFirstScan = currentSession.getScans().get(0);
        boolean differentDay = !scan.getTimestamp().toLocalDate().equals(currentSession.getDate());
        boolean exceedsSpan  = ChronoUnit.MINUTES.between(sessionFirstScan, scan.getTimestamp()) > AMBIGUOUS_MAX_SPAN_MINUTES;

        if (differentDay || exceedsSpan) {
            finalizeSession(currentSession);
            sessions.add(currentSession);
            Map<String, Object> openerShift = findOpenerShift(scan.getTimestamp(), shifts, assignedShift, isCrossMidnight);
            currentSession = openerShift != null
                ? openSession(employeeId, scan, openerShift, assignedShift, isCrossMidnight)
                : openAmbiguousSession(employeeId, scan);
        } else {
            currentSession.getScans().add(scan.getTimestamp());
        }
        continue;
    }

    // ... existing logic for normal sessions unchanged
}
```

`AMBIGUOUS_MAX_SPAN_MINUTES = 720` (12h), as a new constant alongside `DEDUP_WINDOW_MINUTES` etc.

`isNextShiftExitScan` already returns `false` immediately for non-cross-midnight sessions, so it's a no-op for ambiguous sessions (which are always `crossMidnight = false`).

**Known limitation**: an employee assigned a cross-midnight shift (e.g. Noche) whose scans never fall in any detection window will have their cross-midnight session split into two same-day ambiguous sessions at the midnight boundary, instead of one continuous session. This is an accepted edge case — flag it in `tas_shift_rules.md` as a known limitation, same style as the existing "missing exit + same-day re-entry" limitation.

### `detectSameDayDouble` fix

Today, sessions are grouped by `matchedShiftId` to detect "two different shifts hit on the same day." Two ambiguous sessions on the same day both have `matchedShiftId == null`, so they'd collapse into one set entry and the anomaly wouldn't be detected. Fix: use a unique key per ambiguous session instead of `null`:

```java
for (TasSession s : daySessions) {
    String key = s.getFlags().contains(TasFlag.AMBIGUOUS_SHIFT)
            ? "ambiguous-" + System.identityHashCode(s)
            : s.getMatchedShiftId();
    shiftIds.add(key);
}
```

This means:
- One normal session + one ambiguous session same day → 2 distinct keys → both flagged `SAME_DAY_DOUBLE` (correct, this is anomalous).
- Two ambiguous sessions same day → 2 distinct keys (now) → both flagged `SAME_DAY_DOUBLE` (fixed).
- One ambiguous session alone that day → 1 key → not flagged (correct).

## TasHoursCalculator changes

### The `needsResolution` wrinkle

`calculate()` currently does:

```java
boolean flagged = session.getFlags() != null && !session.getFlags().isEmpty();
session.setNeedsResolution(flagged);
if (!flagged) {
    computeWorkedHours(session, shifts, legalBreakAllowance);
    classifyHours(session, shifts);
} else {
    // zero out workedMinutes/workedHours/simplesMinutes/doblesMinutes
}
```

Any flag at all currently blocks hours computation. `AMBIGUOUS_SHIFT` must NOT block — the session has valid first/last scans and should be computed normally. But if `AMBIGUOUS_SHIFT` co-occurs with another flag (e.g. `SAME_DAY_DOUBLE`), that other flag's existing blocking behavior must be preserved.

Change to:

```java
boolean hasBlockingFlags = session.getFlags() != null
        && session.getFlags().stream().anyMatch(f -> f != TasFlag.AMBIGUOUS_SHIFT);
session.setNeedsResolution(hasBlockingFlags);

if (!hasBlockingFlags) {
    computeWorkedHours(session, shifts, legalBreakAllowance);
    classifyHours(session, shifts);
} else {
    // unchanged zero-out
}
```

### Hours computation for ambiguous sessions (no code change needed beyond the above)

These already fall out correctly from existing code once `matchedShiftId == null`:
- `detectMissingScansFlags`: `findShiftById(shifts, null)` → `null` → returns early, no `MISSING_ENTRY`/`MISSING_EXIT` flags added (correct — there's no "expected" time to compare against for an ambiguous session).
- `computeWorkedHours`: `shift == null` → `effectiveStart = firstScan` (no grace/tardy logic).
- `classifyHours` → `computeShiftDurationMinutes(null)` → returns `480` (8h) — this is the existing fallback and becomes the de-facto "8h default shift duration" for the simples/dobles split discussed for TASK-32. **This value is shared with TASK-33's planned overtime redesign — when TASK-33 changes how shift duration feeds into simples/dobles, this fallback path for ambiguous sessions should be revisited too.**

## TasReportBuilder / EmployeeRow / ResolvedRow

Add a per-employee/quincena count of days flagged `AMBIGUOUS_SHIFT`:

- `EmployeeRow`: new field `int diasTurnoAmbiguo` (count of distinct `session.getDate()` values, for that employee+quincena, where `session.getFlags().contains(TasFlag.AMBIGUOUS_SHIFT)`).
- `TasReportBuilder.build`: accumulate this alongside `workedDaysByEmployee` / `minutesByEmployeeQuincena`, using the same `empId`/`quincena` keys.
- Frontend `ResolvedRow` (`tasTypes.ts`): add `diasTurnoAmbiguo: number`.

## ReviewScreen change

In `ReviewScreen.tsx`, for each row where `row.diasTurnoAmbiguo > 0`, render a small warning badge next to the employee name (style consistent with `FLAG_COLORS`'s amber/`SHIFT_MISMATCH` treatment), e.g.:

```tsx
{row.diasTurnoAmbiguo > 0 && (
  <span
    title={`${row.diasTurnoAmbiguo} día(s) en que las marcaciones no coincidieron con ningún turno configurado. Se calcularon con base en las marcaciones reales (turno de 8h por defecto).`}
    className="ml-2 text-label-sm px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
  >
    {row.diasTurnoAmbiguo} sin turno
  </span>
)}
```

No interaction required — purely informational, doesn't block "Enviar".

## docs/tas_shift_rules.md updates

1. **TasFlag enum reference** (new section or inline where flags are introduced): document `AMBIGUOUS_SHIFT`.
2. **§ Shift Mismatch Detection, item 3**: replace *"If no shift matches → flag as ambiguous; client provides start and end manually"* with: *"If no shift matches → the session is still built from the actual scans (first scan = entry, last scan = exit, same grouping rules as a normal session, capped at 12h same-day span), flagged `AMBIGUOUS_SHIFT`, and computed normally (effectiveStart = first scan, no grace/tardy, 8h default shift duration for the simples/dobles split — see Worked Hours per Session). This is purely informational: shown as a badge on the employee's row in the pre-submit review screen, no manual input required."*
3. **§ Session Grouping**: document the ambiguous-session fallback and the 12h/same-day cap, plus the cross-midnight known limitation.
4. **§ Missing Scan Detection**: note that `MISSING_ENTRY`/`MISSING_EXIT` don't apply to ambiguous sessions (no expected times to compare against).
5. **§ Worked Hours per Session**: note the 8h default duration for ambiguous sessions comes from the existing `computeShiftDurationMinutes` null-shift fallback, and flag it as shared with TASK-33.
6. **§ Same-day double session**: document the unique-key handling for two ambiguous sessions on the same day.
7. **New flag-blocking note**: document that `needsResolution` is `true` if a session has any flag other than `AMBIGUOUS_SHIFT` — i.e. `AMBIGUOUS_SHIFT` alone never blocks hours computation or the verification screen.
8. **§ Config Page / Tab 2 or Output Flow**: mention the new `diasTurnoAmbiguo` badge on the review screen.

## Testing

- `TasSessionGrouperTest`: 
  - employee whose scans never match any shift window → one ambiguous session per day, flagged `AMBIGUOUS_SHIFT`, `matchedShiftId == null`.
  - scans spanning >12h in a day → split into two ambiguous sessions.
  - scans spanning midnight with no shift match → two same-day ambiguous sessions (documents the known limitation).
  - one normal + one ambiguous session same day → both flagged `SAME_DAY_DOUBLE`.
  - two ambiguous sessions same day → both flagged `SAME_DAY_DOUBLE`.
- `TasHoursCalculatorTest`:
  - session flagged only `AMBIGUOUS_SHIFT` → `needsResolution == false`, `workedHours` computed from actual scans, `effectiveStart == firstScan`.
  - session flagged `AMBIGUOUS_SHIFT` + `SAME_DAY_DOUBLE` → `needsResolution == true`, hours zeroed (existing behavior preserved).
  - simples/dobles split for an ambiguous session uses the 8h default.
- `TasReportBuilderTest`: `diasTurnoAmbiguo` count correct per employee/quincena.
- `ReviewScreen.test.tsx`: badge renders when `diasTurnoAmbiguo > 0`, absent otherwise; tooltip text present.
- End-to-end-ish: re-run the employee 134 fixture (`Reporte TAS Daniel Morales.csv`) through the full pipeline and confirm `resolvedRows` is non-empty with correct hours.
