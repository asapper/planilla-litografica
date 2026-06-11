# TAS Verification Screen — Empty State for Periods With Nothing to Resolve — Design

## Context

TASK-36 (follow-up to TASK-34, see `docs/superpowers/specs/2026-06-11-tas-period-selector-design.md`).

After TASK-34, the app routes to the Verification screen whenever `hasNeedsResolution || hasMultiplePeriods`. This means:

- **Single period, nothing to resolve:** already routes straight to Review — no change needed, confirmed out of scope for this task.
- **Multiple periods, and the currently selected period has nothing to resolve** (whether or not other periods do): the user lands on Verification and sees the period dropdown, the "solo se enviará el periodo seleccionado" note, filter chips all showing `(0)`, and an empty session list — with only an enabled "Enviar" button. This looks broken/useless.

## Decision: empty-state panel, scoped to the selected period

When `totalToResolve === 0` for the currently selected period (`needsResolutionSessions.length === 0`), replace the filter chips and session list with a reassuring empty-state message. Everything else on the screen stays as-is.

This is evaluated **per selected period** — if the user switches the dropdown to a period that does have pending sessions, the normal chips/list UI reappears immediately (existing reactive behavior, no extra logic needed).

## UI changes (`VerificationScreen.tsx`)

- Keep: heading, period dropdown (shown when `availablePeriods.length > 1`), the "Solo se enviará el periodo seleccionado..." note, sticky bottom bar with "Enviar".
- When `totalToResolve === 0`:
  - Hide the filter chip row entirely.
  - Hide the session card list entirely.
  - Show an empty-state panel with the message:

    > "✓ Este periodo no presenta inconsistencias — los datos están completos y no requieren revisión manual. Puede continuar y enviar."

  - The "X por resolver" badge in the bottom bar is naturally absent (already conditioned on `pendingCount > 0`).
- When `totalToResolve > 0`: unchanged — chips and session list render as today.

## Out of scope

- Single-period "nothing to resolve" routing — already skips Verification (TASK-34 routing logic, unchanged).
- Any change to `/api/tas/resolve`, `availablePeriods`, or backend period-filtering logic — this is a frontend-only presentational change.
- Confirmation dialogs before submit.

## Testing

- `VerificationScreen.test.tsx`:
  - New test: when the selected period has zero sessions needing resolution, the empty-state message renders, filter chips and session cards are absent, and "Enviar" is enabled.
  - New test: switching the period dropdown from a period with nothing to resolve to one with pending sessions shows the chips/list again (and vice versa).
  - Existing tests for the normal (non-empty) case remain unchanged.
