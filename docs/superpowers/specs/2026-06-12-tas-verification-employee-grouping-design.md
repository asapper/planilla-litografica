# TAS Verification Screen: Group Flagged Sessions by Employee (TASK-3)

## Problem

`VerificationScreen` (`frontend/src/components/tas/VerificationScreen.tsx`) renders every
flagged session needing resolution as a vertically stacked card. With 10-50 flagged
sessions in a period — especially when several belong to the same employee — the page
grows unbounded and becomes hard to scan for non-technical payroll staff.

## Goals

- Page height stays roughly proportional to the number of *employees* with issues, not
  the number of *flagged sessions*.
- Users can edit/confirm flagged values inline without navigating away (unchanged —
  existing card components already do this).
- Non-technical users get a clear at-a-glance view of who still needs attention vs. who
  is done.

## Non-goals

- No AG Grid / spreadsheet-style rewrite. Volumes are 10-50 records per period, which
  doesn't justify rebuilding the three distinct inline-editing interactions
  (`SessionCard`, `ShiftMismatchCard`, `SameDayDoubleGroupCard`) as grid cell editors.
- Filter chips (`all`, `missing_entry`, `missing_exit`, `shift_mismatch`, `cutoff`) are
  removed from this screen. Employee grouping already gives an overview; chips can be
  reintroduced later as a follow-up if needed.
- No changes to the resolution submission logic (`handleSubmit`), the shape of
  `TasResolution`, or the backend API.

## Design

### Component structure

A new `EmployeeGroup` component renders a collapsible section per employee. It wraps
the existing card components — `SessionCard`, `ShiftMismatchCard`,
`SameDayDoubleGroupCard` — unchanged. `VerificationScreen` builds the groups and renders
one `EmployeeGroup` per employee instead of three flat lists.

```tsx
interface EmployeeGroupProps {
  employeeId: string;
  employeeName: string;
  items: GroupItem[];          // sorted chronologically, see below
  pendingCount: number;        // 0 if fully resolved
  expanded: boolean;
  onToggle: () => void;
  // ...props needed to render each item type (availableShifts, shiftAcceptances,
  // sameDayDoubleResolutions, resolvedSessions, callbacks) passed through
}
```

`GroupItem` is a discriminated union representing what to render at each chronological
slot:

```ts
type GroupItem =
  | { type: 'session'; session: TasSession }                 // regular SessionCard
  | { type: 'shift_mismatch'; session: TasSession }          // ShiftMismatchCard
  | { type: 'same_day_double'; groupKey: string; sessions: TasSession[] }; // SameDayDoubleGroupCard
```

### Building groups

In `VerificationScreen`, replace the current `regular` / `shiftMismatchOnly` /
`sameDayDoubleGroups` flat splits with a single pass over `needsResolutionSessions`
(unfiltered — filter chips removed):

1. Compute the same three categorizations as today (same-day-double sessions,
   shift-mismatch-only sessions, regular sessions, and the
   `employeeId|date`-keyed `sameDayDoubleGroups` map) — this logic is unchanged.
2. Bucket every session/group by `employeeId`, building a
   `Map<employeeId, { employeeName, items: GroupItem[] }>`.
   - Each same-day-double group (`employeeId|date`) contributes one
     `{ type: 'same_day_double', ... }` item, keyed by its date.
   - Each shift-mismatch-only session contributes one `{ type: 'shift_mismatch', ... }`
     item, keyed by its date.
   - Each remaining regular session contributes one `{ type: 'session', ... }` item,
     keyed by its date.
3. Sort `items` within each employee group chronologically by date (string comparison
   on `YYYY-MM-DD` is sufficient).

### Pending vs. resolved, and group ordering

For each employee group, `pendingCount` = number of that employee's `regular` sessions
not yet present in `resolvedSessions`. (Shift-mismatch-only and same-day-double items
are always auto-resolved by default — consistent with current `confirmedCount` logic —
so they never contribute to `pendingCount`.)

- `pendingCount > 0` → group is **pending**.
- `pendingCount === 0` → group is **resolved**.

Render order: all pending groups first (alphabetical by `employeeName`), then all
resolved groups (alphabetical by `employeeName`).

The overall sticky-footer `pendingCount` / `allConfirmed` calculation is unchanged —
it's still the sum across all sessions, just no longer driving a flat list.

### Collapse/expand state

Local component state in `VerificationScreen`:

```ts
const [manuallyToggled, setManuallyToggled] = useState<Set<string>>(new Set());
```

For each employee group, default expansion is derived each render:

- Default `expanded = pendingCount > 0` (pending groups start open, resolved groups
  start collapsed).
- If `employeeId` is in `manuallyToggled`, flip the default.

Clicking the group header toggles membership of `employeeId` in `manuallyToggled` (add
if absent, remove if present — so a manual toggle that happens to match the computed
default doesn't permanently "stick" the wrong way after the underlying data changes).

This means: as the user confirms an employee's last pending session, that group's
computed default flips to collapsed and it auto-collapses (unless they'd manually
forced it open, in which case it stays open until they toggle again).

### Group header rendering

- **Pending**: `{employeeName} — {pendingCount} por resolver`, styled with the same red
  badge (`bg-error text-white`) currently used in the sticky footer.
- **Resolved**: `{employeeName} — ✓ Resuelto`, styled green like the existing
  `Confirmado` state in `SessionCard`.

Per-item flag chips (`FLAG_LABELS`/`FLAG_COLORS`) remain on the individual cards as
today — no chips are duplicated at the group-header level.

### Removed: filter chips

The `FilterChip` type, `chips` array, `chipCounts`, `activeFilter` state, and
`sessionMatchesFilter` are all removed. `needsResolutionSessions` is used directly
(unfiltered) as the input to group-building.

### Empty state

The existing "no inconsistencies" empty state (`totalToResolve === 0`) is unchanged.

## Testing

Update `frontend/src/components/tas/VerificationScreen.test.tsx`:

- Grouping: sessions for the same employee across different categories (regular,
  shift-mismatch-only, same-day-double) are combined into one group, sorted
  chronologically by date.
- Group ordering: pending groups appear before resolved groups; alphabetical within
  each bucket.
- Default expansion: a group with `pendingCount > 0` renders expanded; a group with
  `pendingCount === 0` renders collapsed.
- Manual toggle: clicking a group header toggles its expansion regardless of computed
  default, and toggling again restores the computed default.
- Auto-collapse: confirming an employee's last pending session causes their group's
  computed default to flip to collapsed (and it visually collapses, absent a manual
  override).
- Header content: pending groups show `{name} — N por resolver` with red styling;
  resolved groups show `{name} — ✓ Resuelto` with green styling.
- `handleSubmit` / resolution payload construction is unaffected by grouping — covered
  by existing tests using the same underlying session lists.
- Filter chip removal: chips and `activeFilter` no longer render; remove/replace any
  existing tests asserting on chip behavior.

## Files affected

- `frontend/src/components/tas/VerificationScreen.tsx` — main changes described above;
  new `EmployeeGroup` component (can live in the same file or a new
  `EmployeeGroup.tsx` alongside it — implementation's call).
- `frontend/src/components/tas/VerificationScreen.test.tsx` — updated/new tests per
  above.
