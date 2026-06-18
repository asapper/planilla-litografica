# Manual Overtime Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to manually edit "Horas extras simples" and "Horas extras dobles" on the ReviewScreen before submitting.

**Architecture:** Overrides are stored in the Zustand store (`overtimeOverrides` keyed by `codigoEmpleado`), persist across navigation and recomputes, and are sent alongside the `uploadToken` at submit time. The backend replaces computed values with overrides on the `EmployeeRow` list before passing to the stored procedure. No new endpoints — only the existing submit endpoint is modified.

**Tech Stack:** React 18 + TypeScript, Zustand, Vitest + React Testing Library, Spring Boot + MockMvc

## Global Constraints

- All code identifiers in English; UI text in Spanish.
- Zustand selectors: always individual `useStore(s => s.field)` calls — never inline object selectors.
- Backend `horasExtrasSimples` / `horasExtrasDobles` are `int` — override values must be non-negative integers.
- Maintain ~100% frontend test coverage, ~99% backend instruction coverage.

---

### Task 1: Add `overtimeOverrides` to Zustand store

**Files:**
- Modify: `frontend/src/tasStore.ts`
- Test: `frontend/src/tasStore.test.ts` (create if needed)

**Interfaces:**
- Produces:
  - `overtimeOverrides: Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>`
  - `setOvertimeOverride: (codigoEmpleado: string, field: 'horasExtrasSimples' | 'horasExtrasDobles', value: number) => void`
  - `clearOvertimeOverrides: () => void`
  - `resetTas()` also clears `overtimeOverrides`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/tasStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useTasStore } from './tasStore';

beforeEach(() => {
  useTasStore.getState().resetTas();
});

describe('overtimeOverrides', () => {
  it('starts empty', () => {
    expect(useTasStore.getState().overtimeOverrides).toEqual({});
  });

  it('setOvertimeOverride upserts a single field', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 5 },
    });
  });

  it('setOvertimeOverride preserves other fields for same employee', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasDobles', 3);
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 5, horasExtrasDobles: 3 },
    });
  });

  it('setOvertimeOverride keeps other employees untouched', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    useTasStore.getState().setOvertimeOverride('E2', 'horasExtrasDobles', 2);
    expect(useTasStore.getState().overtimeOverrides.E1).toEqual({ horasExtrasSimples: 5 });
    expect(useTasStore.getState().overtimeOverrides.E2).toEqual({ horasExtrasDobles: 2 });
  });

  it('clearOvertimeOverrides resets to empty', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    useTasStore.getState().clearOvertimeOverrides();
    expect(useTasStore.getState().overtimeOverrides).toEqual({});
  });

  it('resetTas clears overtimeOverrides', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    useTasStore.getState().resetTas();
    expect(useTasStore.getState().overtimeOverrides).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tasStore.test.ts`
Expected: FAIL — `overtimeOverrides` property does not exist.

- [ ] **Step 3: Implement store changes**

In `frontend/src/tasStore.ts`:

Add to the `TasStore` interface (after `sessionSummaries` line ~29):
```typescript
overtimeOverrides: Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>;
setOvertimeOverride: (codigoEmpleado: string, field: 'horasExtrasSimples' | 'horasExtrasDobles', value: number) => void;
clearOvertimeOverrides: () => void;
```

Add to `initialState` (after `sessionSummaries` line ~78):
```typescript
overtimeOverrides: {} as Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>,
```

Add to the `create<TasStore>` body (after `setSessionSummaries` line ~123):
```typescript
setOvertimeOverride: (codigoEmpleado, field, value) => set(s => ({
  overtimeOverrides: {
    ...s.overtimeOverrides,
    [codigoEmpleado]: { ...s.overtimeOverrides[codigoEmpleado], [field]: value },
  },
})),
clearOvertimeOverrides: () => set({ overtimeOverrides: {} }),
```

`resetTas` already spreads `initialState` which includes `overtimeOverrides: {}`, so no change needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tasStore.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tasStore.ts frontend/src/tasStore.test.ts
git commit -m "Add overtimeOverrides state to Zustand store"
```

---

### Task 2: Make overtime columns editable in ReviewScreen

**Files:**
- Modify: `frontend/src/components/tas/ReviewScreen.tsx`
- Modify: `frontend/src/components/tas/ReviewScreen.test.tsx`

**Interfaces:**
- Consumes: `overtimeOverrides`, `setOvertimeOverride` from `tasStore`
- Produces: Editable `<input type="number">` cells for both overtime columns, with blue text when overridden

- [ ] **Step 1: Write failing tests**

Add to `frontend/src/components/tas/ReviewScreen.test.tsx`:

```typescript
describe('ReviewScreen overtime override', () => {
  beforeEach(() => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
  });

  it('renders number inputs for overtime columns', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(4); // 2 employees × 2 fields
  });

  it('displays computed values by default', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(2);  // E1 simples
    expect(inputs[1]).toHaveValue(0);  // E1 dobles
    expect(inputs[2]).toHaveValue(0);  // E2 simples
    expect(inputs[3]).toHaveValue(1);  // E2 dobles
  });

  it('updates store when user types a new value', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '7' } });
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 7 },
    });
  });

  it('displays override value instead of computed value', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(10);
  });

  it('applies visual indicator class when value is overridden', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveClass('text-blue-600');
    expect(inputs[1]).not.toHaveClass('text-blue-600');
  });

  it('overrides persist after accruesOvertime recompute', async () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    const newRows: ResolvedRow[] = [
      { ...rows[0], accruesOvertime: false, horasExtrasSimples: 0, horasExtrasDobles: 0 },
      rows[1],
    ];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: newRows });

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().resolvedRows).toEqual(newRows));
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 10 },
    });
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(10);
  });

  it('rejects negative values by clamping to 0', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '-3' } });
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 0 },
    });
  });

  it('treats empty input as 0', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '' } });
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 0 },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tas/ReviewScreen.test.tsx`
Expected: FAIL — no spinbutton roles found (currently static `<td>` text).

- [ ] **Step 3: Implement editable cells**

In `frontend/src/components/tas/ReviewScreen.tsx`:

Add store selectors at the top of the `ReviewScreen` component (after existing selectors ~line 73):
```typescript
const overtimeOverrides = useTasStore(s => s.overtimeOverrides);
const setOvertimeOverride = useTasStore(s => s.setOvertimeOverride);
```

Add a handler function (after `handleAccruesOvertimeToggle`, ~line 126):
```typescript
const handleOvertimeChange = (codigoEmpleado: string, field: 'horasExtrasSimples' | 'horasExtrasDobles', raw: string) => {
  const parsed = parseInt(raw, 10);
  const value = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  setOvertimeOverride(codigoEmpleado, field, value);
};
```

Replace the two static `<td>` elements for overtime (lines 184-185):

Replace line 184 (`horasExtrasSimples` cell):
```tsx
<td className="py-3 px-4 text-right">
  <input
    type="number"
    min="0"
    step="1"
    value={overtimeOverrides[row.codigoEmpleado]?.horasExtrasSimples ?? row.horasExtrasSimples}
    onChange={e => handleOvertimeChange(row.codigoEmpleado, 'horasExtrasSimples', e.target.value)}
    className={`w-16 text-right text-body-md bg-transparent border-b border-outline-variant focus:border-primary focus:outline-none transition-colors ${
      overtimeOverrides[row.codigoEmpleado]?.horasExtrasSimples !== undefined ? 'text-blue-600 font-medium' : 'text-on-surface-variant'
    }`}
  />
</td>
```

Replace line 185 (`horasExtrasDobles` cell):
```tsx
<td className="py-3 px-4 text-right">
  <input
    type="number"
    min="0"
    step="1"
    value={overtimeOverrides[row.codigoEmpleado]?.horasExtrasDobles ?? row.horasExtrasDobles}
    onChange={e => handleOvertimeChange(row.codigoEmpleado, 'horasExtrasDobles', e.target.value)}
    className={`w-16 text-right text-body-md bg-transparent border-b border-outline-variant focus:border-primary focus:outline-none transition-colors ${
      overtimeOverrides[row.codigoEmpleado]?.horasExtrasDobles !== undefined ? 'text-blue-600 font-medium' : 'text-on-surface-variant'
    }`}
  />
</td>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tas/ReviewScreen.test.tsx`
Expected: All tests PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/tas/ReviewScreen.tsx frontend/src/components/tas/ReviewScreen.test.tsx
git commit -m "Make overtime columns editable with visual override indicator"
```

---

### Task 3: Send overrides in submit payload

**Files:**
- Modify: `frontend/src/tasApi.ts`
- Modify: `frontend/src/components/tas/ReviewScreen.tsx` (update `handleSubmit`)
- Modify: `frontend/src/components/tas/ReviewScreen.test.tsx` (update submit tests)

**Interfaces:**
- Consumes: `overtimeOverrides` from store, `submitTas` from `tasApi`
- Produces: `submitTas(token, overtimeOverrides)` sends `{ uploadToken, overtimeOverrides }` to backend

- [ ] **Step 1: Write failing tests**

Update the existing submit test in `ReviewScreen.test.tsx` — the `'calls submitTas and advances to result'` test:

```typescript
it('calls submitTas and advances to result', async () => {
  useTasStore.getState().setUploadToken('tok-1');
  useTasStore.getState().setResolvedRows(rows);
  mockSubmitTas.mockResolvedValue({ jobId: 'job-final' });

  render(<ReviewScreen />);
  fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

  await waitFor(() => expect(useTasStore.getState().tasView).toBe('result'));
  expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {});
  expect(useTasStore.getState().jobId).toBe('job-final');
});
```

Add a new test in the `'ReviewScreen overtime override'` describe block:

```typescript
it('sends overrides in submit payload', async () => {
  useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
  mockSubmitTas.mockResolvedValue({ jobId: 'job-override' });

  render(<ReviewScreen />);
  fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

  await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
    E1: { horasExtrasSimples: 10 },
  }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tas/ReviewScreen.test.tsx`
Expected: FAIL — `submitTas` called with 1 arg, test expects 2.

- [ ] **Step 3: Update `tasApi.ts` signature**

In `frontend/src/tasApi.ts`, replace the `submitTas` function (line 41-42):

```typescript
export const submitTas = (
  token: string,
  overtimeOverrides: Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>,
): Promise<{ jobId: string }> =>
  client.post<{ jobId: string }>('/tas/submit', { uploadToken: token, overtimeOverrides }).then(r => r.data);
```

- [ ] **Step 4: Update `handleSubmit` in ReviewScreen**

In `frontend/src/components/tas/ReviewScreen.tsx`, update `handleSubmit` (~line 87-101):

Add selector at the top of the component (it may already be there from Task 2):
```typescript
const overtimeOverrides = useTasStore(s => s.overtimeOverrides);
```

Replace the `submitTas(uploadToken)` call inside `handleSubmit`:
```typescript
const { jobId } = await submitTas(uploadToken, overtimeOverrides);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tas/ReviewScreen.test.tsx`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/tasApi.ts frontend/src/components/tas/ReviewScreen.tsx frontend/src/components/tas/ReviewScreen.test.tsx
git commit -m "Send overtime overrides in submit payload"
```

---

### Task 4: Backend — apply overrides before stored procedure call

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/controller/TasController.java` (submit method)
- Modify: `backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java`

**Interfaces:**
- Consumes: `{ uploadToken, overtimeOverrides }` from frontend
- Produces: `EmployeeRow` list with overrides applied, passed to `jobService.createJob(rows)`

- [ ] **Step 1: Write failing tests**

Add to `TasControllerTest.java` (after the existing submit tests, ~line 607):

```java
@Test
void submit_withOvertimeOverrides_appliesOverridesToRows() throws Exception {
    EmployeeRow row = new EmployeeRow();
    row.setCodigoEmpleado("100");
    row.setNombreEmpleado("Test");
    row.setDiasNoLaborados(0);
    row.setHorasExtrasSimples(8);
    row.setHorasExtrasDobles(2);
    row.setMes(3);
    row.setAnio(2026);
    row.setNumeroDequincena(1);

    TasUploadResult result = emptyResult();
    result.setResolvedRows(List.of(row));
    when(parserService.parse(any())).thenReturn(emptyParseResult());
    when(uploadService.processScans(any(), any(), any())).thenReturn(result);

    MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

    String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
       .andExpect(status().isOk())
       .andReturn().getResponse().getContentAsString();

    String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

    when(jobService.createJob(any())).thenReturn("job-override");
    when(jobService.processJob("job-override")).thenReturn(new JobService.JobResult(1, 0, 0, null));

    Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", 15, "horasExtrasDobles", 4));
    Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", overrides);

    mvc.perform(post("/api/tas/submit")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(body)))
       .andExpect(status().isOk())
       .andExpect(jsonPath("$.jobId").value("job-override"));

    var captor = org.mockito.ArgumentCaptor.forClass(List.class);
    verify(jobService).createJob(captor.capture());
    List<EmployeeRow> submitted = captor.getValue();
    assertThat(submitted).hasSize(1);
    assertThat(submitted.get(0).getHorasExtrasSimples()).isEqualTo(15);
    assertThat(submitted.get(0).getHorasExtrasDobles()).isEqualTo(4);
}

@Test
void submit_withNegativeOverride_returns400() throws Exception {
    EmployeeRow row = new EmployeeRow();
    row.setCodigoEmpleado("100");
    row.setNombreEmpleado("Test");
    row.setHorasExtrasSimples(0);
    row.setHorasExtrasDobles(0);
    row.setMes(3);
    row.setAnio(2026);
    row.setNumeroDequincena(1);

    TasUploadResult result = emptyResult();
    result.setResolvedRows(List.of(row));
    when(parserService.parse(any())).thenReturn(emptyParseResult());
    when(uploadService.processScans(any(), any(), any())).thenReturn(result);

    MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

    String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
       .andExpect(status().isOk())
       .andReturn().getResponse().getContentAsString();

    String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

    Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", -5));
    Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", overrides);

    mvc.perform(post("/api/tas/submit")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(body)))
       .andExpect(status().isBadRequest())
       .andExpect(jsonPath("$.code").value("INVALID_OVERRIDE"));
}

@Test
void submit_withEmptyOverrides_passesRowsUnchanged() throws Exception {
    EmployeeRow row = new EmployeeRow();
    row.setCodigoEmpleado("100");
    row.setNombreEmpleado("Test");
    row.setDiasNoLaborados(0);
    row.setHorasExtrasSimples(8);
    row.setHorasExtrasDobles(2);
    row.setMes(3);
    row.setAnio(2026);
    row.setNumeroDequincena(1);

    TasUploadResult result = emptyResult();
    result.setResolvedRows(List.of(row));
    when(parserService.parse(any())).thenReturn(emptyParseResult());
    when(uploadService.processScans(any(), any(), any())).thenReturn(result);

    MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

    String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
       .andExpect(status().isOk())
       .andReturn().getResponse().getContentAsString();

    String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

    when(jobService.createJob(any())).thenReturn("job-nochange");
    when(jobService.processJob("job-nochange")).thenReturn(new JobService.JobResult(1, 0, 0, null));

    Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", Map.of());

    mvc.perform(post("/api/tas/submit")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(body)))
       .andExpect(status().isOk());

    var captor = org.mockito.ArgumentCaptor.forClass(List.class);
    verify(jobService).createJob(captor.capture());
    List<EmployeeRow> submitted = captor.getValue();
    assertThat(submitted.get(0).getHorasExtrasSimples()).isEqualTo(8);
    assertThat(submitted.get(0).getHorasExtrasDobles()).isEqualTo(2);
}

@Test
void submit_withPartialOverride_onlyOverridesSpecifiedField() throws Exception {
    EmployeeRow row = new EmployeeRow();
    row.setCodigoEmpleado("100");
    row.setNombreEmpleado("Test");
    row.setDiasNoLaborados(0);
    row.setHorasExtrasSimples(8);
    row.setHorasExtrasDobles(2);
    row.setMes(3);
    row.setAnio(2026);
    row.setNumeroDequincena(1);

    TasUploadResult result = emptyResult();
    result.setResolvedRows(List.of(row));
    when(parserService.parse(any())).thenReturn(emptyParseResult());
    when(uploadService.processScans(any(), any(), any())).thenReturn(result);

    MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

    String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
       .andExpect(status().isOk())
       .andReturn().getResponse().getContentAsString();

    String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

    when(jobService.createJob(any())).thenReturn("job-partial");
    when(jobService.processJob("job-partial")).thenReturn(new JobService.JobResult(1, 0, 0, null));

    Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", 20));
    Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", overrides);

    mvc.perform(post("/api/tas/submit")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(body)))
       .andExpect(status().isOk());

    var captor = org.mockito.ArgumentCaptor.forClass(List.class);
    verify(jobService).createJob(captor.capture());
    List<EmployeeRow> submitted = captor.getValue();
    assertThat(submitted.get(0).getHorasExtrasSimples()).isEqualTo(20);
    assertThat(submitted.get(0).getHorasExtrasDobles()).isEqualTo(2);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./mvnw test -pl . -Dtest=TasControllerTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: FAIL — submit doesn't read `overtimeOverrides` from body.

- [ ] **Step 3: Implement backend override logic**

In `TasController.java`, update the `submit` method (~line 223-267).

Add override parsing and application after retrieving `rows` (after line 247) and before `jobService.createJob(rows)` (line 252):

```java
@SuppressWarnings("unchecked")
Map<String, Map<String, Object>> overtimeOverrides =
    (Map<String, Map<String, Object>>) body.getOrDefault("overtimeOverrides", Collections.emptyMap());

for (Map.Entry<String, Map<String, Object>> entry : overtimeOverrides.entrySet()) {
    String empId = entry.getKey();
    Map<String, Object> fields = entry.getValue();
    for (EmployeeRow r : rows) {
        if (r.getCodigoEmpleado().equals(empId)) {
            if (fields.containsKey("horasExtrasSimples")) {
                int val = ((Number) fields.get("horasExtrasSimples")).intValue();
                if (val < 0) {
                    return ResponseEntity.badRequest().body(Map.of(
                        "code", "INVALID_OVERRIDE",
                        "message", "Los valores de horas extra no pueden ser negativos."));
                }
                r.setHorasExtrasSimples(val);
            }
            if (fields.containsKey("horasExtrasDobles")) {
                int val = ((Number) fields.get("horasExtrasDobles")).intValue();
                if (val < 0) {
                    return ResponseEntity.badRequest().body(Map.of(
                        "code", "INVALID_OVERRIDE",
                        "message", "Los valores de horas extra no pueden ser negativos."));
                }
                r.setHorasExtrasDobles(val);
            }
            break;
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./mvnw test -pl . -Dtest=TasControllerTest -Dsurefire.failIfNoSpecifiedTests=false`
Expected: All tests PASS.

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && ./mvnw test`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/controller/TasController.java backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java
git commit -m "Apply overtime overrides in submit before stored procedure call"
```

---

### Task 5: Clear overrides on new upload

**Files:**
- Modify: `frontend/src/components/tas/TasUploader.tsx` (or wherever the upload flow starts)
- Modify: `frontend/src/components/tas/ReviewScreen.test.tsx`

**Interfaces:**
- Consumes: `clearOvertimeOverrides` from store
- Produces: Overrides are cleared whenever `resetTas()` is called (which already happens on new upload — verify this)

- [ ] **Step 1: Verify resetTas is called on new upload**

Search for `resetTas` usage in the upload flow to confirm overrides are already cleared:

Run: `grep -rn 'resetTas' frontend/src/`

If `resetTas` is called before starting a new upload, overrides are already cleared (since Task 1 added `overtimeOverrides` to `initialState`). If not, add `clearOvertimeOverrides()` call at the appropriate point.

- [ ] **Step 2: Write a test confirming overrides clear on reset**

This was already covered in Task 1's `'resetTas clears overtimeOverrides'` test. Verify it passes:

Run: `cd frontend && npx vitest run src/tasStore.test.ts`
Expected: PASS.

- [ ] **Step 3: Run full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Commit (if any changes were needed)**

```bash
git add -A
git commit -m "Ensure overtime overrides clear on new upload"
```
