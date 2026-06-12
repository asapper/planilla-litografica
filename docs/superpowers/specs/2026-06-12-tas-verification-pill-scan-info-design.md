# TAS Verification Screen — Show Present Scan Info in Pills (TASK-17)

## Problem

In `VerificationScreen.tsx`'s `SessionCard`, when a session has `MISSING_ENTRY` or
`MISSING_EXIT`, the flag pill only says "Falta entrada" or "Falta salida". It gives
no indication of what scan time *is* present (the other side of the pair), making
it harder to see at a glance what data exists and what needs fixing.

## Design

Replace the static `FLAG_LABELS[f]` lookup (lines ~118-122) with a `flagLabel(flag, session)`
function:

- `MISSING_ENTRY`: `"Falta entrada"`, plus `" · Salida {toHHMM(session.lastScan)}"` if
  `session.lastScan` is non-null.
- `MISSING_EXIT`: `"Falta salida"`, plus `" · Entrada {toHHMM(session.effectiveStart)}"` if
  `session.effectiveStart` is non-null.
- All other flags (`SHIFT_MISMATCH`, `SAME_DAY_DOUBLE`, `START_CUTOFF`, `END_CUTOFF`,
  `AMBIGUOUS_SHIFT`): unchanged, return `FLAG_LABELS[f]` as before.

`FLAG_COLORS` and pill styling are unchanged. No type or API changes needed —
`effectiveStart` and `lastScan` are already present on `TasSession`.

## Testing

Add/update cases in `VerificationScreen.test.tsx`:
- Session with `MISSING_ENTRY` and a non-null `lastScan` → pill shows "Falta entrada · Salida HH:MM".
- Session with `MISSING_EXIT` and a non-null `effectiveStart` → pill shows "Falta salida · Entrada HH:MM".
- Session with `MISSING_ENTRY` and `lastScan === null` → pill shows plain "Falta entrada" (no regression).
- Other flag types render unchanged labels.

## Addendum: Backend fix required (discovered during testing)

The frontend change above is correct but inert: `TasHoursCalculator.calculate()`
(backend/src/main/java/com/planilla/backend/service/tas/TasHoursCalculator.java:42-54)
only calls `computeWorkedHours()` — the sole place that sets `effectiveStart` and
`lastScan` — when the session has **no** blocking flags. `MISSING_ENTRY` and
`MISSING_EXIT` are blocking flags, so for every session this feature targets,
`effectiveStart` and `lastScan` are always `null` in the API response.

### Fix

Add a private method `setRawScanBounds(TasSession session)` in `TasHoursCalculator`,
called from the `hasBlockingFlags` branch (replacing/alongside the existing
zero-out of worked hours):

```java
private void setRawScanBounds(TasSession session) {
    List<LocalDateTime> scans = session.getScans();
    if (scans == null || scans.isEmpty()) return;

    LocalDateTime first = scans.get(0);
    LocalDateTime last  = scans.get(scans.size() - 1);
    boolean missingEntry = session.getFlags() != null && session.getFlags().contains(TasFlag.MISSING_ENTRY);
    boolean missingExit  = session.getFlags() != null && session.getFlags().contains(TasFlag.MISSING_EXIT);

    if (scans.size() == 1) {
        if (missingEntry && !missingExit) {
            session.setLastScan(first);
        } else if (missingExit && !missingEntry) {
            session.setEffectiveStart(first);
        } else {
            session.setEffectiveStart(first);
            session.setLastScan(first);
        }
        return;
    }

    session.setEffectiveStart(first);
    session.setLastScan(last);
}
```

Rationale for the `scans.size() == 1` branching: a single scan is ambiguous — it could
be the entry or the exit. The flags disambiguate it: if only `MISSING_ENTRY` is set,
the lone scan is the exit (`lastScan`); if only `MISSING_EXIT` is set, it's the entry
(`effectiveStart`). If neither/both (e.g. a session blocked only by `SHIFT_MISMATCH`
with one scan), set both to the same value as a reasonable default.

For `scans.size() >= 2`, always use the raw first/last scan — no grace-period
adjustment (that logic is `computeWorkedHours`'s job for non-blocked sessions).

### Testing

Add cases to `TasHoursCalculatorTest`:
- `MISSING_EXIT` with 2 scans (entry present, exit too early) → `effectiveStart` ==
  first scan, `lastScan` == second scan.
- `MISSING_ENTRY` with 1 scan only → `lastScan` == that scan, `effectiveStart` is `null`.
- `MISSING_EXIT` with 1 scan only → `effectiveStart` == that scan, `lastScan` is `null`.
- Existing tests (`calculate_missingExitFlag_setsNeedsResolution`,
  `calculate_missingEntryFlag_setsNeedsResolution`) must keep passing — `workedMinutes`/
  `workedHours` stay `0`.

## Scope

Frontend change (pill enrichment) + backend fix (populate `effectiveStart`/`lastScan`
for flagged sessions) in `TasHoursCalculator`. Out of scope: other review screens
(ReviewScreen, ReactivationReviewScreen, AbsentReviewOverlay) — none of them match
this pill pattern.
