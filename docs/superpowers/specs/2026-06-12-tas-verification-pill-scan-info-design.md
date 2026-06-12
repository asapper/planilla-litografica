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

## Scope

Single-component change, no backend/type changes. Out of scope: other review
screens (ReviewScreen, ReactivationReviewScreen, AbsentReviewOverlay) — none of
them match this pill pattern.
