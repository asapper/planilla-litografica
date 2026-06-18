# Manual Override of Extra Hours on Review Screen

## Problem

The ReviewScreen displays computed "Horas extras simples" and "Horas extras dobles" values per employee, but the user cannot adjust them. Users need the ability to manually override these values before submitting — as a simple compensation/adjustment — without triggering any recomputation.

## Design

### Overview

- The two overtime columns become **inline-editable number inputs** on the ReviewScreen.
- Overrides are stored in the **Zustand store** so they persist across tab navigation and accruesOvertime recomputes.
- On submit, overrides are sent alongside the `uploadToken`. The backend **replaces** computed values with overrides before passing rows to the stored procedure.

### Frontend

#### Store (`tasStore.ts`)

New state:

```
overtimeOverrides: Record<string, { horasExtrasSimples?: number, horasExtrasDobles?: number }>
setOvertimeOverride: (codigoEmpleado: string, field: 'horasExtrasSimples' | 'horasExtrasDobles', value: number) => void
clearOvertimeOverrides: () => void
```

- `overtimeOverrides` is keyed by `codigoEmpleado`.
- `setOvertimeOverride` upserts a single field for an employee.
- `clearOvertimeOverrides` is called on new upload / reset — **not** on recompute or navigation.

#### ReviewScreen (`ReviewScreen.tsx`)

- Replace the static `<td>` for `horasExtrasSimples` and `horasExtrasDobles` with an inline `<input type="number">`.
- The input's displayed value comes from `overtimeOverrides[codigoEmpleado]?.field ?? row.field` (override wins, computed is fallback).
- `onChange` calls `setOvertimeOverride(codigoEmpleado, field, parsedValue)`.
- Input constraints: `min="0"`, `step="1"` (integers, matching backend `int` type).
- **Visual indicator:** When an override exists and differs from the computed value, the input text renders in a distinct color (e.g. `text-blue-600`) so the user knows which rows were manually adjusted.

#### Submit flow (`tasApi.ts`)

- `submitTas` signature changes to `submitTas(token: string, overtimeOverrides: Record<string, { horasExtrasSimples?: number, horasExtrasDobles?: number }>)`.
- POST body becomes `{ uploadToken: token, overtimeOverrides }`.
- If the overrides map is empty, the field is still sent as `{}` — backend treats it as no overrides.

#### Lifecycle

| Event | Overrides behavior |
|---|---|
| User edits a cell | Stored in `overtimeOverrides` |
| accruesOvertime toggle / recompute | Overrides **persist** (not cleared) |
| Navigate to Config tab and back | Overrides **persist** (in Zustand store) |
| New file upload / reset | Overrides **cleared** |
| Submit | Overrides sent to backend, then flow completes |

### Backend

#### Submit endpoint (`TasController.java` — `POST /tas/submit`)

- Parse `overtimeOverrides` from the request body: `Map<String, Map<String, Integer>>`.
- After retrieving `state.getResolvedRows()`, iterate and for each employee present in `overtimeOverrides`, overwrite `horasExtrasSimples` and/or `horasExtrasDobles` on the `EmployeeRow`.
- Pass the modified rows to `jobService.createJob(rows)` as before.
- No new endpoint needed.

#### Validation

- Override values must be non-negative integers. If invalid, return 400.

### What this does NOT change

- No new backend endpoint (reuses submit).
- No changes to shift detection, session resolution, or recompute logic.
- No changes to the stored procedure interface — it receives the same `EmployeeRow` shape, just with potentially different overtime values.
- `EmployeeRow.java` fields remain `int`.

### Testing

- **Frontend tests:** Editing a value updates the store. Displayed value reflects override. Visual indicator appears when overridden. Submit sends overrides in payload. Overrides persist through recompute. Overrides cleared on new upload.
- **Backend tests:** Submit with overrides replaces computed values. Submit with empty overrides passes rows unchanged. Invalid override values return 400.
