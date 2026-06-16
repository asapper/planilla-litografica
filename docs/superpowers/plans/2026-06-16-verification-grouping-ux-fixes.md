# Verification Grouping UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three UX problems in the TAS Verification screen: resolved groups not auto-collapsing, weak visual nesting of session cards under employee headers, and no positive "all done" signal when everything is resolved.

**Architecture:** Three independent fixes to two files — `EmployeeGroup.tsx` (visual container restructure) and `VerificationScreen.tsx` (collapse rule + completion state). No changes to grouping logic, card internals, or backend API. Each task produces a working, tested commit.

**Tech Stack:** React, TypeScript, Tailwind CSS (M3 tokens), Vitest, @testing-library/react

---

### Task 1: Fix #3 — Restore correct default-expansion rule

Fix: remove the `|| group.items.some(item => item.type !== 'session')` deviation from PR #27, restoring `defaultExpanded = group.pendingCount > 0`. Groups with only shift-mismatch or same-day-double items (always `pendingCount === 0`) will now default to collapsed.

**Files:**
- Modify: `frontend/src/components/tas/VerificationScreen.test.tsx` (line 657–673)
- Modify: `frontend/src/components/tas/VerificationScreen.tsx` (line 473)

- [ ] **Step 1: Update the existing test to expect the corrected behavior**

In `VerificationScreen.test.tsx`, find the test named `'expands a group by default when it contains only a shift-mismatch session'` (line 657) and replace it with:

```tsx
it('collapses a group by default when it contains only a shift-mismatch session', () => {
  useTasStore.getState().setFlaggedSessions([
    makeSession({
      sessionId: 1, employeeId: 'E1', employeeName: 'Ana López', date: '2026-03-10',
      flags: ['SHIFT_MISMATCH'],
      effectiveStart: '2026-03-10T07:03:00', lastScan: '2026-03-10T15:05:00',
      matchedShiftId: 'tarde', matchedShiftName: 'Tarde',
      assignedShiftId: 'manana', assignedShiftName: 'Manana',
    }),
  ]);
  useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
  render(<VerificationScreen />);
  const header = screen.getByRole('button', { name: /Ana López/ });
  expect(header).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('✓ Resuelto')).toBeInTheDocument();
  expect(screen.queryByText(/Turno asignado: Manana/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test — expect it to fail**

```bash
cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx --reporter=verbose 2>&1 | grep -A5 "shift-mismatch session"
```

Expected: FAIL — `aria-expanded` is `'true'` but test expects `'false'`.

- [ ] **Step 3: Fix the defaultExpanded expression in VerificationScreen.tsx**

In `VerificationScreen.tsx`, find line 473 and change:

```ts
// Before
const defaultExpanded = group.pendingCount > 0 || group.items.some(item => item.type !== 'session');
```

to:

```ts
const defaultExpanded = group.pendingCount > 0;
```

- [ ] **Step 4: Run all verification screen tests — expect all to pass**

```bash
cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 5: Run the full test suite — expect no regressions**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass (same count as before).

- [ ] **Step 6: Commit**

```bash
git checkout -b fix/verification-grouping-ux
git add frontend/src/components/tas/VerificationScreen.tsx \
        frontend/src/components/tas/VerificationScreen.test.tsx
git commit -m "Fix shift-mismatch-only groups defaulting to expanded despite pendingCount 0"
```

---

### Task 2: Fix #1 — Restructure EmployeeGroup to full bordered container (Option C)

Replace the loose header + 8 px indent with a single outer border that wraps header + children as one accordion panel. The header gets a bottom divider when expanded. Children sit on a `bg-surface-container` tray with uniform padding. A chevron (▾/▸) is added to the header to reinforce expand/collapse affordance.

**Files:**
- Modify: `frontend/src/components/tas/EmployeeGroup.tsx`
- Modify: `frontend/src/components/tas/EmployeeGroup.test.tsx`

- [ ] **Step 1: Write a new test for the chevron indicator**

At the end of the `describe('EmployeeGroup', ...)` block in `EmployeeGroup.test.tsx`, add:

```tsx
it('shows a collapse chevron (▾) when expanded and an expand chevron (▸) when collapsed', () => {
  const { rerender } = render(
    <EmployeeGroup employeeName="Ana López" pendingCount={1} expanded={true} onToggle={() => {}}>
      <div>child</div>
    </EmployeeGroup>,
  );
  expect(screen.getByRole('button', { name: /Ana López/ })).toHaveTextContent('▾');

  rerender(
    <EmployeeGroup employeeName="Ana López" pendingCount={1} expanded={false} onToggle={() => {}}>
      <div>child</div>
    </EmployeeGroup>,
  );
  expect(screen.getByRole('button', { name: /Ana López/ })).toHaveTextContent('▸');
});
```

- [ ] **Step 2: Run the test — expect it to fail**

```bash
cd frontend && npx vitest run src/components/tas/EmployeeGroup.test.tsx --reporter=verbose 2>&1 | grep -A5 "chevron"
```

Expected: FAIL — no chevron text found.

- [ ] **Step 3: Rewrite EmployeeGroup.tsx with the bordered container structure**

The children container uses `flex flex-col gap-3` for spacing between cards, so remove the `mb-3` from any card that is a direct child of this container. `SessionCard`, `ShiftMismatchCard`, and `SameDayDoubleGroupCard` each have `mb-3` on their outermost `<div>` — **remove those `mb-3` classes** from those three card components in `VerificationScreen.tsx` so `gap-3` governs spacing instead.

Replace the entire contents of `frontend/src/components/tas/EmployeeGroup.tsx` with:

```tsx
import type { ReactNode } from 'react';

interface EmployeeGroupProps {
  employeeName: string;
  pendingCount: number;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export default function EmployeeGroup({ employeeName, pendingCount, expanded, onToggle, children }: EmployeeGroupProps) {
  const resolved = pendingCount === 0;

  return (
    <div className="border border-outline-variant rounded-shape-md mb-3 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`w-full flex items-center justify-between gap-3 bg-white px-4 py-3 text-left cursor-pointer ${
          expanded ? 'rounded-t-shape-md border-b border-outline-variant' : 'rounded-shape-md'
        }`}
      >
        <span className="font-medium text-on-surface">{employeeName}</span>
        <div className="flex items-center gap-2">
          {resolved ? (
            <span className="text-label-md font-medium text-green-600">✓ Resuelto</span>
          ) : (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-error text-white text-label-md font-medium">
              {pendingCount} por resolver
            </span>
          )}
          <span className="text-on-surface-variant text-body-sm" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="bg-surface-container rounded-b-shape-md px-3 py-3 flex flex-col gap-3">
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run EmployeeGroup tests — expect all to pass**

```bash
cd frontend && npx vitest run src/components/tas/EmployeeGroup.test.tsx --reporter=verbose
```

Expected: all 6 tests pass (5 existing + 1 new chevron test).

- [ ] **Step 5: Run the full test suite — expect no regressions**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/tas/EmployeeGroup.tsx \
        frontend/src/components/tas/EmployeeGroup.test.tsx
git commit -m "Restructure EmployeeGroup to bordered accordion panel with chevron indicator"
```

---

### Task 3: Fix #2 — Add completion state indicator

When `allConfirmed && totalToResolve > 0`, show a green banner above the groups and turn the Enviar button green with "✓ Enviar" label. The empty-state path (`totalToResolve === 0`) is unchanged.

Also update one existing test that clicks Enviar by exact name (breaks because label changes to "✓ Enviar" after confirm).

**Files:**
- Modify: `frontend/src/components/tas/VerificationScreen.test.tsx`
- Modify: `frontend/src/components/tas/VerificationScreen.tsx`

- [ ] **Step 1: Add new tests for the completion state, and fix the broken Enviar button name**

In `VerificationScreen.test.tsx`, find the test `'passes the selected period to resolveVerification on submit'` (line ~332) and change the click selector from exact name to regex:

```tsx
// Before
fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

// After
fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
```

Then add a new `describe` block at the end of the file:

```tsx
describe('VerificationScreen completion state', () => {
  it('shows green banner and enables green Enviar button when all sessions are confirmed', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, effectiveStart: '08:00:00', lastScan: '17:00:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);

    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    expect(screen.getByText(/Todos los grupos están resueltos/)).toBeInTheDocument();
    const enviar = screen.getByRole('button', { name: /enviar/i });
    expect(enviar).not.toBeDisabled();
    expect(enviar).toHaveTextContent('✓ Enviar');
  });

  it('does not show green banner when there are still pending sessions', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1 }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);

    expect(screen.queryByText(/Todos los grupos están resueltos/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });

  it('does not show green banner when totalToResolve is 0 (empty state — no inconsistencies)', () => {
    useTasStore.getState().setFlaggedSessions([]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);

    expect(screen.queryByText(/Todos los grupos están resueltos/)).not.toBeInTheDocument();
    const enviar = screen.getByRole('button', { name: /enviar/i });
    expect(enviar).not.toBeDisabled();
    expect(enviar).toHaveTextContent('Enviar');
    expect(enviar).not.toHaveTextContent('✓ Enviar');
  });
});
```

- [ ] **Step 2: Run the tests — expect the new ones to fail**

```bash
cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx --reporter=verbose 2>&1 | grep -E "✓|×|FAIL|PASS" | tail -20
```

Expected: the 3 new `completion state` tests fail; the patched `passes the selected period` test now passes (was failing before due to exact name).

- [ ] **Step 3: Implement the completion state in VerificationScreen.tsx**

In the JSX returned by `VerificationScreen`, make two changes:

**3a — Add the green banner** just before the `{totalToResolve === 0 ? ... : employeeGroups.map(...)}` block:

```tsx
{allConfirmed && totalToResolve > 0 && (
  <div className="flex items-center gap-2 rounded-shape-md border border-green-300 bg-green-50 px-4 py-3 mb-4 text-body-sm font-medium text-green-700">
    ✓ Todos los grupos están resueltos — puede continuar y enviar.
  </div>
)}
```

**3b — Update the Enviar button** in the sticky footer:

```tsx
// Before
<button
  disabled={!allConfirmed}
  onClick={handleSubmit}
  className="m3-btn-filled disabled:opacity-40 disabled:cursor-not-allowed"
>
  Enviar
</button>

// After
<button
  disabled={!allConfirmed}
  onClick={handleSubmit}
  className={
    allConfirmed && totalToResolve > 0
      ? 'm3-btn bg-green-700 text-white'
      : 'm3-btn-filled disabled:opacity-40 disabled:cursor-not-allowed'
  }
>
  {allConfirmed && totalToResolve > 0 ? '✓ Enviar' : 'Enviar'}
</button>
```

- [ ] **Step 4: Run all verification screen tests — expect all to pass**

```bash
cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 5: Run the full test suite — expect all to pass**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass. Note the total count — should be 3 more than before Task 1 started.

- [ ] **Step 6: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/tas/VerificationScreen.tsx \
        frontend/src/components/tas/VerificationScreen.test.tsx
git commit -m "Add green banner and Enviar button state when all groups resolved"
```

---

### Task 4: Open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin fix/verification-grouping-ux
```

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --title "Fix verification grouping UX: collapse, nesting, completion state (TASK-38)" \
  --body "$(cat <<'EOF'
## Summary
- Fix #3: Remove PR #27 deviation — shift-mismatch/same-day-double groups now collapse by default (pendingCount always 0), restoring the original spec intent
- Fix #1: Restructure EmployeeGroup into a full bordered accordion panel (header + children share one outer border), replacing the 8px indent that was too subtle to signal ownership
- Fix #2: Show a green banner + green Enviar button when all groups are resolved and there are items (distinct from the zero-inconsistencies empty state)

## Test plan
- [ ] All existing tests pass
- [ ] New tests: shift-mismatch-only group collapses by default; chevron shows ▾/▸; green banner + green Enviar appear only when allConfirmed && totalToResolve > 0

🤖 Generated with Claude Code
EOF
)"
```
