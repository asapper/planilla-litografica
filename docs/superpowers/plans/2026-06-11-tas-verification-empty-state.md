# TAS Verification Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the selected period on the TAS Verification screen has nothing left to resolve, replace the (currently empty/confusing) filter chips and session list with a reassuring empty-state message, instead of showing a near-blank screen.

**Architecture:** Frontend-only change to `VerificationScreen.tsx`. The screen already computes `totalToResolve` (count of sessions needing resolution in the selected period) and `pendingCount`. When `totalToResolve === 0`, render an empty-state panel instead of the filter chip row and session card list. The period dropdown, inline note, and bottom "Enviar" bar are unchanged. Because filtering is reactive on `selectedPeriod`, switching periods automatically toggles between the empty state and the normal chips/list UI.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, Zustand.

---

## Spec reference

`docs/superpowers/specs/2026-06-11-tas-verification-empty-state-design.md`

## File map

- Modify: `frontend/src/components/tas/VerificationScreen.tsx`
- Modify: `frontend/src/components/tas/VerificationScreen.test.tsx`

---

## Task 1: Empty-state panel when nothing needs resolution in the selected period

**Files:**
- Modify: `frontend/src/components/tas/VerificationScreen.tsx`
- Test: `frontend/src/components/tas/VerificationScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add `TasResolveResult` is already imported in the test file (used for `mockResult`). Add a new `describe` block at the end of `frontend/src/components/tas/VerificationScreen.test.tsx`:

```ts
describe('VerificationScreen empty state for selected period', () => {
  const periods: TasPeriod[] = [
    { anio: 2026, mes: 3, numeroDequincena: 1 },
    { anio: 2026, mes: 3, numeroDequincena: 2 },
  ];

  it('shows an empty-state message and hides chips/sessions when the selected period has nothing to resolve', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeName: 'Ana', date: '2026-03-20' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[0]);

    render(<VerificationScreen />);

    expect(screen.getByText(/Este periodo no presenta inconsistencias/i)).toBeInTheDocument();
    expect(screen.queryByText('Todos')).not.toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled();
  });

  it('hides the empty-state message and shows chips/sessions when the selected period has sessions to resolve', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeName: 'Ana', date: '2026-03-05' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[0]);

    render(<VerificationScreen />);

    expect(screen.queryByText(/Este periodo no presenta inconsistencias/i)).not.toBeInTheDocument();
    expect(screen.getByText('Todos')).toBeInTheDocument();
    expect(screen.getByText('Ana López')).toBeInTheDocument();
  });

  it('toggles between empty state and session list when switching periods', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeName: 'Ana', date: '2026-03-05' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[0]);

    render(<VerificationScreen />);

    expect(screen.queryByText(/Este periodo no presenta inconsistencias/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/periodo/i), { target: { value: '2026-3-2' } });

    expect(screen.getByText(/Este periodo no presenta inconsistencias/i)).toBeInTheDocument();
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  });
});
```

Note: the existing `makeSession()` default uses `employeeName: 'Ana López'` and `date: '2026-03-15'` (period `{anio: 2026, mes: 3, numeroDequincena: 1}`), which is why the first two tests override `employeeName`/`date`/`sessionId` to keep assertions unambiguous between "Ana" (first test, period 2 selected, session in period 1 → nothing to resolve in period 2) and "Ana López" (second test, period 1 selected, session in period 1 → matches).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx`
Expected: FAIL — the new `describe('VerificationScreen empty state for selected period', ...)` tests fail because no empty-state message exists yet (chips/list always render).

- [ ] **Step 3: Update `VerificationScreen.tsx`**

In `frontend/src/components/tas/VerificationScreen.tsx`, find this block (the filter chip row immediately followed by the session card list):

```tsx
        <div className="flex gap-2 flex-wrap mb-6">
          {chips.map(chip => (
            chipCounts[chip.key] > 0 || chip.key === 'all' ? (
              <button
                key={chip.key}
                onClick={() => setActiveFilter(chip.key)}
                className={`px-3 py-1 rounded-full text-label-md font-medium border transition-colors cursor-pointer ${
                  activeFilter === chip.key
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-on-surface-variant border-outline-variant hover:bg-surface-container-low'
                }`}
              >
                {chip.label} {chipCounts[chip.key] > 0 ? `(${chipCounts[chip.key]})` : ''}
              </button>
            ) : null
          ))}
        </div>

        {filtered.map(session => (
          <SessionCard
            key={session.sessionId}
            session={session}
            confirmed={!!resolvedSessions[session.sessionId]}
            onConfirm={(resolvedStart, resolvedEnd, mismatchChoice) =>
              setResolvedSession(session.sessionId, {
                resolvedStart,
                resolvedEnd,
                updateShift: mismatchChoice === 'update' ? true : mismatchChoice === 'keep' ? false : undefined,
              })
            }
          />
        ))}
```

Replace it with:

```tsx
        {totalToResolve === 0 ? (
          <div className="rounded-shape-md border border-outline-variant bg-white px-4 py-6 text-center">
            <p className="text-body-md text-on-surface">
              ✓ Este periodo no presenta inconsistencias — los datos están completos y no requieren revisión manual. Puede continuar y enviar.
            </p>
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap mb-6">
              {chips.map(chip => (
                chipCounts[chip.key] > 0 || chip.key === 'all' ? (
                  <button
                    key={chip.key}
                    onClick={() => setActiveFilter(chip.key)}
                    className={`px-3 py-1 rounded-full text-label-md font-medium border transition-colors cursor-pointer ${
                      activeFilter === chip.key
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-on-surface-variant border-outline-variant hover:bg-surface-container-low'
                    }`}
                  >
                    {chip.label} {chipCounts[chip.key] > 0 ? `(${chipCounts[chip.key]})` : ''}
                  </button>
                ) : null
              ))}
            </div>

            {filtered.map(session => (
              <SessionCard
                key={session.sessionId}
                session={session}
                confirmed={!!resolvedSessions[session.sessionId]}
                onConfirm={(resolvedStart, resolvedEnd, mismatchChoice) =>
                  setResolvedSession(session.sessionId, {
                    resolvedStart,
                    resolvedEnd,
                    updateShift: mismatchChoice === 'update' ? true : mismatchChoice === 'keep' ? false : undefined,
                  })
                }
              />
            ))}
          </>
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx`
Expected: PASS (all existing tests + 3 new ones)

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS (no regressions)

- [ ] **Step 6: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/tas/VerificationScreen.tsx frontend/src/components/tas/VerificationScreen.test.tsx
git commit -m "Show empty-state message on Verification when selected period needs no resolution"
```

---

## Task 2: Manual smoke test

- [ ] **Step 1: Start backend and frontend dev servers**

- [ ] **Step 2: Upload a TAS file spanning two quincenas where only one quincena has flagged sessions**

Confirm:
- The period with flagged sessions shows the normal filter chips and session list.
- Switching the dropdown to the period with nothing to resolve shows the empty-state message ("✓ Este periodo no presenta inconsistencias...") instead of chips/list.
- "Enviar" is enabled for the empty-state period.
- Switching back to the period with flagged sessions restores the chips/list.
- The "Solo se enviará el periodo seleccionado..." note and period dropdown remain visible in both cases.
