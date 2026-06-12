# TAS Verification Pill Scan Info Implementation Plan (TASK-17)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the TAS verification screen, flag pills for missing entry/exit also show the scan time that IS present, so users see at a glance what data exists and what's missing.

**Architecture:** Replace the static `FLAG_LABELS[f]` lookup in `SessionCard` with a `flagLabel(flag, session)` function that appends scan info for `MISSING_ENTRY`/`MISSING_EXIT` when the corresponding session field is non-null. All other flags unchanged.

**Tech Stack:** React + TypeScript, Vitest + React Testing Library.

---

### Task 1: Add `flagLabel` helper and wire it into the pill rendering

**Files:**
- Modify: `frontend/src/components/tas/VerificationScreen.tsx:9-25` (FLAG_LABELS area) and `:118-122` (pill rendering)
- Test: `frontend/src/components/tas/VerificationScreen.test.tsx`

- [ ] **Step 1: Write failing tests for the new label behavior**

Add these tests inside the existing `describe('VerificationScreen rendering', ...)` block, after the existing "renders flag badge" test (around line 84):

```tsx
  it('shows the existing exit time when entry is missing', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_ENTRY'], effectiveStart: null, lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta entrada · Salida 17:00')).toBeInTheDocument();
  });

  it('shows the existing entry time when exit is missing', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_EXIT'], effectiveStart: '08:00:00', lastScan: null })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta salida · Entrada 08:00')).toBeInTheDocument();
  });

  it('shows plain missing-entry label when neither scan is present', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_ENTRY'], effectiveStart: null, lastScan: null })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta entrada')).toBeInTheDocument();
  });

  it('renders unrelated flag labels unchanged', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['SHIFT_MISMATCH'], effectiveStart: '08:00:00', lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Cambio de turno')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx`
Expected: the two new "shows the existing ... time" tests FAIL (text not found), the other two pass already (they describe current behavior).

- [ ] **Step 3: Implement `flagLabel` and use it in the pill rendering**

In `frontend/src/components/tas/VerificationScreen.tsx`, after the `FLAG_LABELS` and `FLAG_COLORS` declarations (after line 25), add:

```tsx
function flagLabel(flag: TasFlag, session: TasSession): string {
  if (flag === 'MISSING_ENTRY' && session.lastScan) {
    return `${FLAG_LABELS[flag]} · Salida ${toHHMM(session.lastScan)}`;
  }
  if (flag === 'MISSING_EXIT' && session.effectiveStart) {
    return `${FLAG_LABELS[flag]} · Entrada ${toHHMM(session.effectiveStart)}`;
  }
  return FLAG_LABELS[flag];
}
```

Note: `flagLabel` is defined after `toHHMM` (line 33-36) in source order, but since both are top-level function declarations, hoisting makes this fine. Place `flagLabel` immediately after `FLAG_COLORS` (line 25) as written above — function declarations are hoisted so the reference to `toHHMM` below it resolves correctly.

Then update the pill rendering (current lines 118-122):

```tsx
          {session.flags.map(f => (
            <span key={f} className={`text-label-sm px-2 py-0.5 rounded-full ${FLAG_COLORS[f]}`}>
              {flagLabel(f, session)}
            </span>
          ))}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx`
Expected: all tests PASS, including the 4 new ones.

- [ ] **Step 5: Run the full frontend test suite and lint**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: no failures, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/tas/VerificationScreen.tsx frontend/src/components/tas/VerificationScreen.test.tsx
git commit -m "Show present scan time in TAS verification flag pills"
```

---

## Plan Self-Review Notes

- Spec coverage: covers MISSING_ENTRY/MISSING_EXIT enrichment, no-info fallback, and unrelated-flag unchanged behavior — matches the design doc.
- No backend/type changes needed; `TasSession.effectiveStart`/`lastScan` already exist.
- Out of scope: other review screens, per design doc.
