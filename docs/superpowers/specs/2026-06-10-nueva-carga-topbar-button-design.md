# Nueva Carga Top Bar Button — Design

## Context
BACK-4: Add a persistent "Nueva carga" (start new upload) button to the top app bar so users can abandon an in-progress TAS session at any time, not just from the result screen.

## Placement
Add the button to `TopAppBar.tsx`, positioned to the left of the existing "Configuración" button, in the trailing button group. Styled as an outlined/ghost pill button consistent with the bar's existing button treatment.

## Visibility
The button is visible whenever `tasView !== 'idle'` (i.e. `processing`, `inactiveReview`, `verification`, `review`, `submitting`, `result`, `absentReview`). It is hidden when `tasView === 'idle'` (no active session).

`TopAppBar` will receive `tasView` as a new prop from `App.tsx`.

## Confirmation Dialog
Clicking the button opens a confirmation modal, following the existing `DeleteModal` pattern in `HolidaysTab.tsx` (centered card, dark backdrop overlay).

- Title: "Iniciar nueva carga"
- Body: explicit warning that the current session and unsaved changes will be discarded
- Actions: "Cancelar" (closes modal, no action) and "Sí, descartar" (destructive/red, confirms)
- **Dismissal:** clicking the backdrop (outside the card) also closes the modal, same as Cancel.

## On Confirm
- Call `resetTas()` (existing store action — resets `tasStore` to `initialState`, `tasView` becomes `'idle'`)
- Call `setCurrentView('tas')` so the user lands on the upload screen (`EmptyState`) even if they were on the Config page

## Component Changes
- `TopAppBar.tsx`: add `tasView` prop, new "Nueva carga" button, local state for modal open/closed, render confirmation modal (or extract a small reusable `ConfirmModal` component if it reduces duplication with `DeleteModal`)
- `App.tsx`: pass `tasView`, `resetTas`, `setCurrentView` down to `TopAppBar`

## Testing
- Button hidden when `tasView === 'idle'`, visible otherwise (cover all non-idle states)
- Clicking button opens modal
- Clicking "Cancelar" closes modal without resetting state
- Clicking backdrop closes modal without resetting state
- Clicking "Sí, descartar" calls `resetTas()`, navigates to `'tas'` view, and shows `EmptyState`
