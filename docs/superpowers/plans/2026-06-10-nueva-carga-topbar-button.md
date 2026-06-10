# Nueva Carga Top Bar Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent "Nueva carga" button to the top app bar that lets the user discard the current TAS session and return to the upload screen at any point during an active session.

**Architecture:** `TopAppBar.tsx` gains a new `tasView` prop (to decide visibility) and `onNewUpload` callback prop (to perform the reset). A new `ConfirmModal` component, extracted from the existing `DeleteModal` pattern in `HolidaysTab.tsx`, is added to `frontend/src/components/ui/` and reused by both `TopAppBar` and `HolidaysTab`. `App.tsx` wires `tasView`, `resetTas`, and `setCurrentView('tas')` into `TopAppBar`.

**Tech Stack:** React + TypeScript, Zustand (`tasStore`), Vitest + React Testing Library, Tailwind CSS.

---

### Task 1: Extract reusable `ConfirmModal` component

**Files:**
- Create: `frontend/src/components/ui/ConfirmModal.tsx`
- Test: `frontend/src/components/ui/ConfirmModal.test.tsx`
- Modify: `frontend/src/components/config/HolidaysTab.tsx:22-54`
- Modify: `frontend/src/components/config/HolidaysTab.test.tsx` (if it references `DeleteModal` directly — check first)

- [ ] **Step 1: Write the failing test for `ConfirmModal`**

```tsx
// frontend/src/components/ui/ConfirmModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmModal from './ConfirmModal';

describe('ConfirmModal', () => {
  const baseProps = {
    title: 'Iniciar nueva carga',
    message: 'Esta acción descartará la sesión actual, incluyendo los cambios sin guardar. ¿Deseas continuar?',
    confirmLabel: 'Sí, descartar',
    cancelLabel: 'Cancelar',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders the title and message', () => {
    render(<ConfirmModal {...baseProps} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Iniciar nueva carga')).toBeInTheDocument();
    expect(screen.getByText(/se perderá|descartará/i)).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal {...baseProps} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('confirm-modal-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not call onCancel when the dialog card itself is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Iniciar nueva carga'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ui/ConfirmModal.test.tsx`
Expected: FAIL with "Failed to resolve import './ConfirmModal'"

- [ ] **Step 3: Implement `ConfirmModal`**

```tsx
// frontend/src/components/ui/ConfirmModal.tsx
interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div
      data-testid="confirm-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-lg max-w-sm w-full mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-medium text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm text-white bg-red-600 rounded hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ui/ConfirmModal.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Replace `DeleteModal` in `HolidaysTab.tsx` with `ConfirmModal`**

In `frontend/src/components/config/HolidaysTab.tsx`:

1. Remove the local `DeleteModal` function (lines 22-54) and the now-unused `formatDate`-based usage check (keep `formatDate`, it's still used for the message).
2. Add the import: `import ConfirmModal from '../ui/ConfirmModal';`
3. Replace the render block at the bottom:

```tsx
      {deleteTarget && (
        <ConfirmModal
          title="Eliminar feriado"
          message={`¿Estás seguro de que deseas eliminar ${deleteTarget.name} (${formatDate(deleteTarget.date)})? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
```

- [ ] **Step 6: Run the full HolidaysTab and ConfirmModal test suites**

Run: `cd frontend && npx vitest run src/components/config/HolidaysTab.test.tsx src/components/ui/ConfirmModal.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/ConfirmModal.tsx frontend/src/components/ui/ConfirmModal.test.tsx frontend/src/components/config/HolidaysTab.tsx
git commit -m "Extract reusable ConfirmModal from HolidaysTab DeleteModal"
```

---

### Task 2: Add "Nueva carga" button and confirmation flow to `TopAppBar`

**Files:**
- Modify: `frontend/src/components/TopAppBar.tsx`
- Modify: `frontend/src/components/TopAppBar.test.tsx`

- [ ] **Step 1: Write failing tests for the new button and modal behavior**

Append to `frontend/src/components/TopAppBar.test.tsx` (add `tasView` and `onNewUpload` props to existing render calls — see Step 1b):

```tsx
describe('Nueva carga button', () => {
  it('is not rendered when tasView is idle', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /nueva carga/i })).not.toBeInTheDocument();
  });

  it('is rendered when tasView is not idle', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
  });

  it('opens a confirmation modal when clicked', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    expect(screen.getByText('Iniciar nueva carga')).toBeInTheDocument();
  });

  it('does not call onNewUpload when the modal is cancelled', () => {
    const onNewUpload = vi.fn();
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={onNewUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onNewUpload).not.toHaveBeenCalled();
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
  });

  it('does not call onNewUpload when the modal backdrop is clicked', () => {
    const onNewUpload = vi.fn();
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={onNewUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    fireEvent.click(screen.getByTestId('confirm-modal-backdrop'));
    expect(onNewUpload).not.toHaveBeenCalled();
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
  });

  it('calls onNewUpload when the confirmation is accepted', () => {
    const onNewUpload = vi.fn();
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={onNewUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));
    expect(onNewUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 1b: Update existing render calls in `TopAppBar.test.tsx` to pass the new required props**

Every existing `render(<TopAppBar currentView=... onViewChange={noop} />)` call in the file must become `render(<TopAppBar currentView=... onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/TopAppBar.test.tsx`
Expected: FAIL — `tasView` / `onNewUpload` props don't exist on `TopAppBar`'s prop type, and "Nueva carga" button not found.

- [ ] **Step 3: Implement the button and modal in `TopAppBar.tsx`**

```tsx
import { useState } from 'react';
import { APP_BAR } from '../constants/colors';
import type { AppView } from '../types';
import type { TasView } from '../tasTypes';
import ConfirmModal from './ui/ConfirmModal';

interface Props {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
  tasView: TasView;
  onNewUpload: () => void;
}

export default function TopAppBar({ currentView, onViewChange, tasView, onNewUpload }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <header
      className="fixed left-0 right-0 flex items-center justify-between px-5 bg-primary"
      style={{ top: 0, height: 64, zIndex: 30, boxShadow: `0 2px 8px ${APP_BAR.shadow}` }}
    >
      {/* Leading: app identity */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-shape-md bg-white/20 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </div>
        <div>
          <p className="text-title-md text-white font-medium leading-tight">Cargador de Planilla</p>
        </div>
      </div>

      {/* Center: spacer */}
      <div className="flex-1 mx-6" />

      {/* Trailing: session actions + Configuración */}
      <div className="flex items-center gap-2 shrink-0">
        {tasView !== 'idle' && (
          <button
            onClick={() => setShowConfirm(true)}
            className="inline-flex items-center gap-1.5 px-4 h-8 rounded-shape-full text-label-lg font-medium text-white/80 border border-white/50 hover:bg-white/15 transition-colors duration-150 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Nueva carga
          </button>
        )}
        <button
          onClick={() => onViewChange('config')}
          aria-current={currentView === 'config' ? 'page' : undefined}
          className={`inline-flex items-center gap-1.5 px-4 h-8 rounded-shape-full text-label-lg font-medium transition-colors duration-150 cursor-pointer ${
            currentView === 'config'
              ? 'bg-white text-primary'
              : 'text-white/80 hover:bg-white/15'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Configuración
        </button>
      </div>

      {showConfirm && (
        <ConfirmModal
          title="Iniciar nueva carga"
          message="Esta acción descartará la sesión actual, incluyendo los cambios sin guardar. ¿Deseas continuar?"
          confirmLabel="Sí, descartar"
          cancelLabel="Cancelar"
          onConfirm={() => {
            setShowConfirm(false);
            onNewUpload();
          }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </header>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/TopAppBar.test.tsx`
Expected: PASS (all tests including the 6 new ones)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TopAppBar.tsx frontend/src/components/TopAppBar.test.tsx
git commit -m "Add Nueva carga button with confirmation modal to top bar"
```

---

### Task 3: Wire `App.tsx` to pass `tasView` and the reset handler

**Files:**
- Modify: `frontend/src/App.tsx:122`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write a failing test in `App.test.tsx`**

Find the existing `describe('TAS Nueva carga redirect', ...)` block (around line 120) and add a new test alongside it that exercises the top-bar button:

```tsx
describe('Top bar Nueva carga button', () => {
  it('resets the session and returns to the upload screen when confirmed', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    const file = new File(['col1,col2'], 'planilla.csv', { type: 'text/csv' });
    const input = screen.getByLabelText(/seleccionar archivo/i, { selector: 'input' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });
});
```

Note: check the actual file-input label/test-id used by `EmptyState` in `frontend/src/components/EmptyState.tsx` and `EmptyState.test.tsx` before finalizing this test — match whatever selector the existing upload tests in `App.test.tsx` already use (look at the test right above the `TAS Nueva carga redirect` describe block for the established pattern, e.g. how `handleTasFile` is triggered in other tests in this file).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/App.test.tsx -t "Top bar Nueva carga button"`
Expected: FAIL — "Nueva carga" button not found in the top bar (TopAppBar doesn't yet receive `tasView`/`onNewUpload` from `App`, so it never renders the button — `tasView` defaults to `undefined` which won't equal `'idle'`... actually since `TopAppBar` isn't called with the new props yet, this will be a TypeScript error first; running vitest will surface it as a type/compile error).

- [ ] **Step 3: Update `TopAppBar` usage in `App.tsx`**

In `frontend/src/App.tsx`, replace line 122:

```tsx
      <TopAppBar currentView={currentView} onViewChange={setCurrentView} />
```

with:

```tsx
      <TopAppBar
        currentView={currentView}
        onViewChange={setCurrentView}
        tasView={tasView}
        onNewUpload={() => {
          resetTas();
          setCurrentView('tas');
        }}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/App.test.tsx -t "Top bar Nueva carga button"`
Expected: PASS

- [ ] **Step 5: Run the full frontend test suite and type check**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: All tests PASS, no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "Wire top bar Nueva carga button to reset TAS session"
```

---

### Task 4: Update BACK-4 backlog task

**Files:**
- None (use the `mcp__backlog__task_edit` tool, not file edits)

- [ ] **Step 1: Mark all acceptance criteria complete and set status to Done**

Use `mcp__backlog__task_edit` with `id: "BACK-4"`, `acceptanceCriteriaCheck: [1, 2, 3, 4]`, and `status: "Done"`.

- [ ] **Step 2: Add a final summary**

Use `mcp__backlog__task_edit` with `id: "BACK-4"` and `finalSummary` describing: added a "Nueva carga" button to the top bar (visible whenever `tasView !== 'idle'`), extracted a reusable `ConfirmModal` component (also used by `HolidaysTab`), confirmation dialog supports Cancel, backdrop-click, and confirm (which calls `resetTas()` and navigates to the upload screen).
