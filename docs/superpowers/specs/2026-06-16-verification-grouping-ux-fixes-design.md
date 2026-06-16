# TAS Verification Screen: Employee Grouping UX Fixes (TASK-38)

## Problem

Follow-up to TASK-3 (PR #27). Three UX problems surfaced after using the grouped
Verification screen on a real upload:

1. **Unclear visual nesting** — 8 px indent is too subtle; session cards don't visually
   "belong" to their employee group header.
2. **Unclear overall completion state** — when all groups are resolved the screen gives
   no positive signal; users had to inspect each group individually to confirm nothing
   was pending.
3. **Resolved groups not collapsing** — groups whose `pendingCount === 0` still default
   to expanded, defeating the purpose of grouping.

## Goals

- Resolved employee groups collapse by default so page height is proportional to
  remaining work.
- Strong visual containment makes it immediately clear which cards belong to which
  employee.
- A clear positive signal tells the user they can proceed when all groups are resolved.

## Non-Goals

- No changes to resolution logic, `TasResolution` shape, or backend API.
- No changes to `verificationGrouping.ts` or `buildEmployeeGroups`.
- No changes to `SessionCard`, `ShiftMismatchCard`, or `SameDayDoubleGroupCard`
  internals.

## Design

### Fix #3 — Default expansion rule

In `VerificationScreen.tsx`, change:

```ts
// before (PR #27 deviation)
const defaultExpanded = group.pendingCount > 0 || group.items.some(item => item.type !== 'session');

// after
const defaultExpanded = group.pendingCount > 0;
```

Groups with `pendingCount === 0` — including those containing only
`shift_mismatch` or `same_day_double` items — default to collapsed. Users can
expand any resolved group to review auto-applied choices. This restores the
original spec intent noted as a deviation in Alex's PR #27 review.

### Fix #1 — Visual nesting (Option C: full bordered container)

`EmployeeGroup.tsx` restructures from a loose header + indented children into a single
bordered accordion panel:

```
┌─────────────────────────────────────────────────────┐  ← outer border + border-radius
│  Nombre Empleado          [badge]          [chevron] │  ← header row, bottom-border divider
├─────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐ │
│  │  SessionCard / ShiftMismatchCard / ...         │ │  ← children on bg-surface-container tray
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**`EmployeeGroup` props** — unchanged (`employeeName`, `pendingCount`, `expanded`,
`onToggle`, `children`).

**Markup changes:**

- Outer `<div>`: `border border-outline-variant rounded-shape-md mb-3 shadow-sm`
- Header `<button>`: `w-full flex items-center justify-between gap-3 bg-white
  rounded-t-shape-md px-4 py-3 text-left` (no border/shadow of its own — inherited from
  outer). When collapsed (no children rendered) the button gets `rounded-shape-md`
  (full radius, no bottom divider).
- Bottom divider: `border-b border-outline-variant` on the header button only when
  `expanded`.
- Children container: `bg-surface-container rounded-b-shape-md px-3 py-3 flex flex-col
  gap-3` (replaces `pl-2 pt-2`). Individual cards inside no longer need their own
  `mb-3` — the container `gap-3` handles spacing.

A chevron icon (▾ / ▸) is added to the right of the badge to reinforce
expand/collapse affordance.

### Fix #2 — Completion state indicator

When `allConfirmed && totalToResolve > 0` (items exist but all resolved — distinct from
the zero-inconsistencies empty state):

**Green banner** rendered above the employee groups in the scrollable content area:

```tsx
<div className="flex items-center gap-2 rounded-shape-md border border-green-300 bg-green-50 px-4 py-3 mb-4 text-body-sm font-medium text-green-700">
  ✓ Todos los grupos están resueltos — puede continuar y enviar.
</div>
```

**Green Enviar button** — when `allConfirmed`, the Enviar button changes class from
`m3-btn-filled` to `m3-btn-filled bg-green-700 hover:bg-green-800` and its label
becomes `✓ Enviar`. When `!allConfirmed` it remains `m3-btn-filled` (blue, disabled).

The existing zero-inconsistencies empty state (`totalToResolve === 0`) is unchanged.

## Files Affected

- `frontend/src/components/tas/EmployeeGroup.tsx` — visual container restructure (Fix
  #1).
- `frontend/src/components/tas/VerificationScreen.tsx` — default expansion rule (Fix
  #3) and completion state indicator (Fix #2).
- `frontend/src/components/tas/EmployeeGroup.test.tsx` — update tests asserting on
  old markup/class names; add chevron-visible test.
- `frontend/src/components/tas/VerificationScreen.test.tsx` — add tests for green
  banner and green Enviar button when `allConfirmed`; update default-expansion test to
  confirm shift-mismatch-only groups start collapsed.

## Testing

- **Fix #3:** A group whose items are all `shift_mismatch` or `same_day_double` (so
  `pendingCount === 0`) defaults to collapsed. Existing auto-collapse test
  ("confirming last pending session collapses the group") continues to pass.
- **Fix #1:** `EmployeeGroup` renders the outer container, header, bottom divider when
  expanded, and children tray with correct classes; bottom divider absent when
  collapsed; chevron present.
- **Fix #2:** When `allConfirmed && totalToResolve > 0`, the green banner is in the
  DOM and the Enviar button has the green class and "✓ Enviar" label. When
  `pendingCount > 0`, banner is absent and button is disabled. When `totalToResolve
  === 0`, neither banner nor green button appears (existing empty-state path).
