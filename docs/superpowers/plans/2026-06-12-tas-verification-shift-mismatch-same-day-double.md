# TAS Verification — Shift Mismatch & Same-Day Double Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `toHHMM` ISO-datetime bug and redesign the verification-screen cards for `SHIFT_MISMATCH` and `SAME_DAY_DOUBLE` sessions so they show a shift-assignment confirmation (with override) and a keep-all/keep-one choice instead of meaningless time fields and "NaNh".

**Architecture:** Backend gains three new `TasSession` fields (`assignedShiftId`, `assignedShiftName`, `matchedShiftName`) populated during session grouping, plus an `availableShifts` list on upload/resolve responses. The `/api/tas/resolve` endpoint gains two new resolution shapes: `{ sessionId, acceptedShiftId }` and `{ employeeId, date, keepSessionId }`. Frontend `VerificationScreen` splits flagged sessions into three render groups (same-day-double groups, shift-mismatch-only cards, and the existing card for everything else) and a new Zustand state slice tracks the two new resolution types alongside the existing one.

**Tech Stack:** Java/Spring Boot (backend), React/TypeScript/Zustand/Vitest (frontend).

Design reference: `docs/superpowers/specs/2026-06-12-tas-verification-shift-mismatch-same-day-double-design.md`

---

### Task 1: Fix `toHHMM` to handle ISO datetime strings

**Files:**
- Modify: `frontend/src/components/tas/VerificationScreen.tsx:43-46`
- Test: `frontend/src/components/tas/VerificationScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block near the top of `VerificationScreen.test.tsx` (after the `makeSession`/`mockResult` setup, before the rendering describe blocks):

```ts
describe('toHHMM via flagLabel rendering', () => {
  it('extracts HH:MM from a full ISO datetime string', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ flags: ['MISSING_ENTRY'], lastScan: '2026-03-10T15:10:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText(/Salida 15:10/)).toBeInTheDocument();
  });

  it('extracts HH:MM from a plain HH:MM:SS string', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ flags: ['MISSING_ENTRY'], lastScan: '15:10:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText(/Salida 15:10/)).toBeInTheDocument();
  });

  it('returns empty string for null', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ flags: ['MISSING_ENTRY'], lastScan: null }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta entrada')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx -t "toHHMM"`
Expected: FAIL on the first test — `screen.getByText(/Salida 15:10/)` not found because `"2026-03-10T15:10:00".slice(0,5)` produces `"2026-"`.

- [ ] **Step 3: Fix `toHHMM`**

Replace `frontend/src/components/tas/VerificationScreen.tsx:43-46`:

```ts
function toHHMM(timeStr: string | null): string {
  if (!timeStr) return '';
  const timePart = timeStr.includes('T') ? timeStr.split('T')[1] : timeStr;
  return timePart.slice(0, 5);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx -t "toHHMM"`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/tas/VerificationScreen.tsx frontend/src/components/tas/VerificationScreen.test.tsx
git commit -m "Fix toHHMM to parse full ISO datetime strings"
```

---

### Task 2: Backend — add assignedShift/matchedShiftName fields to TasSession

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/model/tas/TasSession.java`
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasSessionGrouper.java:205-231` (openSession)
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java`

- [ ] **Step 1: Write the failing test**

Add to `TasSessionGrouperTest.java` (use the existing `shifts`/`assignManana`/`scan` fixtures from `setUp()`):

```java
@Test
void openSession_setsAssignedAndMatchedShiftNames() {
    // Employee assigned to Manana, but scans at 15:00 match Tarde -> SHIFT_MISMATCH
    List<TasScanRecord> scans = List.of(
            scan("E1", LocalDateTime.of(2026, 3, 10, 15, 3)),
            scan("E1", LocalDateTime.of(2026, 3, 10, 23, 5))
    );

    List<TasSession> sessions = grouper.group(scans, shifts, assignManana("E1"));

    assertThat(sessions).hasSize(1);
    TasSession session = sessions.get(0);
    assertThat(session.getFlags()).contains(TasFlag.SHIFT_MISMATCH);
    assertThat(session.getAssignedShiftId()).isEqualTo(MANANA_ID);
    assertThat(session.getAssignedShiftName()).isEqualTo("Manana");
    assertThat(session.getMatchedShiftId()).isEqualTo(TARDE_ID);
    assertThat(session.getMatchedShiftName()).isEqualTo("Tarde");
}

@Test
void openSession_noMismatch_assignedAndMatchedShiftNamesMatch() {
    List<TasScanRecord> scans = List.of(
            scan("E1", LocalDateTime.of(2026, 3, 10, 7, 3)),
            scan("E1", LocalDateTime.of(2026, 3, 10, 15, 5))
    );

    List<TasSession> sessions = grouper.group(scans, shifts, assignManana("E1"));

    assertThat(sessions).hasSize(1);
    TasSession session = sessions.get(0);
    assertThat(session.getFlags()).doesNotContain(TasFlag.SHIFT_MISMATCH);
    assertThat(session.getAssignedShiftId()).isEqualTo(MANANA_ID);
    assertThat(session.getAssignedShiftName()).isEqualTo("Manana");
    assertThat(session.getMatchedShiftId()).isEqualTo(MANANA_ID);
    assertThat(session.getMatchedShiftName()).isEqualTo("Manana");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && mvn -q test -Dtest=TasSessionGrouperTest`
Expected: FAIL with "cannot find symbol: method getAssignedShiftId" (compile error).

- [ ] **Step 3: Add fields/getters/setters to `TasSession`**

In `backend/src/main/java/com/planilla/backend/model/tas/TasSession.java`, add fields after `matchedShiftId`:

```java
    private String matchedShiftId;
    private String matchedShiftName;
    private String assignedShiftId;
    private String assignedShiftName;
```

And getters/setters after the existing `matchedShiftId` getter/setter:

```java
    public String getMatchedShiftName() { return matchedShiftName; }
    public void setMatchedShiftName(String matchedShiftName) { this.matchedShiftName = matchedShiftName; }

    public String getAssignedShiftId() { return assignedShiftId; }
    public void setAssignedShiftId(String assignedShiftId) { this.assignedShiftId = assignedShiftId; }

    public String getAssignedShiftName() { return assignedShiftName; }
    public void setAssignedShiftName(String assignedShiftName) { this.assignedShiftName = assignedShiftName; }
```

- [ ] **Step 4: Populate the new fields in `TasSessionGrouper.openSession`**

In `backend/src/main/java/com/planilla/backend/service/tas/TasSessionGrouper.java`, replace lines 224-230:

```java
        String openerShiftId = getShiftId(openerShift);
        session.setMatchedShiftId(openerShiftId);

        if (!openerShift.equals(assignedShift)) {
            session.getFlags().add(TasFlag.SHIFT_MISMATCH);
        }
```

with:

```java
        String openerShiftId = getShiftId(openerShift);
        session.setMatchedShiftId(openerShiftId);
        session.setMatchedShiftName(openerShift != null ? (String) openerShift.get("name") : null);
        session.setAssignedShiftId(getShiftId(assignedShift));
        session.setAssignedShiftName(assignedShift != null ? (String) assignedShift.get("name") : null);

        if (!openerShift.equals(assignedShift)) {
            session.getFlags().add(TasFlag.SHIFT_MISMATCH);
        }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && mvn -q test -Dtest=TasSessionGrouperTest`
Expected: PASS (all tests including the 2 new ones)

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/model/tas/TasSession.java backend/src/main/java/com/planilla/backend/service/tas/TasSessionGrouper.java backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java
git commit -m "Populate assignedShift and matchedShiftName on TasSession"
```

---

### Task 3: Backend — add `availableShifts` to upload and resolve responses

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/controller/TasController.java`
- Test: `backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java`

- [ ] **Step 1: Write the failing tests**

Add to `TasControllerTest.java`:

```java
@Test
void upload_includesAvailableShiftsField() throws Exception {
    when(parserService.parse(any())).thenReturn(emptyParseResult());
    when(uploadService.processScans(any(), any(), any())).thenReturn(emptyResult());

    Map<String, Object> manana = new LinkedHashMap<>();
    manana.put("id", "manana");
    manana.put("name", "Manana");
    manana.put("start_time", "07:00");
    manana.put("end_time", "15:00");
    when(shiftConfigService.getAllShifts()).thenReturn(List.of(manana));

    MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

    mvc.perform(multipart("/api/tas/upload").file(file))
       .andExpect(status().isOk())
       .andExpect(jsonPath("$.availableShifts[0].id").value("manana"))
       .andExpect(jsonPath("$.availableShifts[0].name").value("Manana"))
       .andExpect(jsonPath("$.availableShifts[0].startTime").value("07:00"))
       .andExpect(jsonPath("$.availableShifts[0].endTime").value("15:00"));
}

@Test
void resolve_includesAvailableShiftsField() throws Exception {
    when(parserService.parse(any())).thenReturn(emptyParseResult());
    when(uploadService.processScans(any(), any(), any())).thenReturn(emptyResult());

    MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
    String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
    String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

    Map<String, Object> manana = new LinkedHashMap<>();
    manana.put("id", "manana");
    manana.put("name", "Manana");
    manana.put("start_time", "07:00");
    manana.put("end_time", "15:00");
    when(shiftConfigService.getAllShifts()).thenReturn(List.of(manana));
    when(reportBuilder.build(any(), any(), any(), any(), any()))
            .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>()));

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("uploadToken", token);
    body.put("resolutions", List.of());

    mvc.perform(post("/api/tas/resolve")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(body)))
       .andExpect(status().isOk())
       .andExpect(jsonPath("$.availableShifts[0].id").value("manana"))
       .andExpect(jsonPath("$.availableShifts[0].name").value("Manana"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && mvn -q test -Dtest=TasControllerTest`
Expected: FAIL — `$.availableShifts[0].id` not found (field doesn't exist in response).

- [ ] **Step 3: Add `mapAvailableShifts` helper and wire it into both responses**

In `backend/src/main/java/com/planilla/backend/controller/TasController.java`, add this private helper near `buildResponseBody` (around line 305):

```java
    private List<Map<String, Object>> mapAvailableShifts(List<Map<String, Object>> shifts) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> shift : shifts) {
            Map<String, Object> dto = new LinkedHashMap<>();
            dto.put("id", shift.get("id"));
            dto.put("name", shift.get("name"));
            dto.put("startTime", shift.get("start_time"));
            dto.put("endTime", shift.get("end_time"));
            result.add(dto);
        }
        return result;
    }
```

In `buildResponseBody` (currently lines 305-325), add a line before the final `return body;`:

```java
        body.put("availableShifts", mapAvailableShifts(shiftConfigService.getAllShifts()));
        return body;
```

In `resolve()`, the response is built around line 192-198. The `shifts` variable (`shiftConfigService.getAllShifts()`) is already in scope. Add a line before `return ResponseEntity.ok(resp);`:

```java
        resp.put("availableShifts", mapAvailableShifts(shifts));
        return ResponseEntity.ok(resp);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && mvn -q test -Dtest=TasControllerTest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/controller/TasController.java backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java
git commit -m "Include availableShifts in upload and resolve responses"
```

---

### Task 4: Backend — `TasHoursCalculator.recompute` public helper

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasHoursCalculator.java`
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasHoursCalculatorTest.java`

- [ ] **Step 1: Write the failing test**

First check the existing `TasHoursCalculatorTest.java` for how `shifts`, `AppConfigService`/`HolidayService` mocks, and a basic session are constructed (look at an existing `computeWorkedHours`-exercising test via `calculate(...)`), then add:

```java
@Test
void recompute_computesWorkedHoursAndClassification() {
    TasSession session = new TasSession();
    session.setEmployeeId("E1");
    session.setDate(LocalDate.of(2026, 3, 10)); // a Tuesday, not special
    session.setMatchedShiftId(MANANA_ID);
    session.setScans(List.of(
            LocalDateTime.of(2026, 3, 10, 7, 3),
            LocalDateTime.of(2026, 3, 10, 15, 5)
    ));
    session.setFlags(new ArrayList<>());

    calculator.recompute(session, shifts);

    assertThat(session.getWorkedMinutes()).isGreaterThan(0);
    assertThat(session.getWorkedHours()).isGreaterThanOrEqualTo(0.0);
    assertThat(session.getEffectiveStart()).isNotNull();
    assertThat(session.getLastScan()).isEqualTo(LocalDateTime.of(2026, 3, 10, 15, 5));
}
```

Adjust `MANANA_ID`/`shifts`/`calculator` to match whatever names the existing test file already uses for its shift fixtures and `TasHoursCalculator` instance — do not invent new fixture names if equivalents exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && mvn -q test -Dtest=TasHoursCalculatorTest`
Expected: FAIL with "cannot find symbol: method recompute" (compile error).

- [ ] **Step 3: Add `recompute` method**

In `backend/src/main/java/com/planilla/backend/service/tas/TasHoursCalculator.java`, add this public method after `calculate` (after line 57):

```java
    public void recompute(TasSession session, List<Map<String, Object>> shifts) {
        int legalBreakAllowance = appConfigService.getLegalBreakAllowanceMinutes();
        computeWorkedHours(session, shifts, legalBreakAllowance);
        classifyHours(session, shifts);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && mvn -q test -Dtest=TasHoursCalculatorTest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/service/tas/TasHoursCalculator.java backend/src/test/java/com/planilla/backend/service/tas/TasHoursCalculatorTest.java
git commit -m "Add TasHoursCalculator.recompute helper for resolve-time recalculation"
```

---

### Task 5: Backend — `/api/tas/resolve` accepts `{ sessionId, acceptedShiftId }`

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/controller/TasController.java`
- Test: `backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java`

- [ ] **Step 1: Write the failing test**

Add to `TasControllerTest.java`, modeled on `resolve_validResolution_returns200WithUpdatedRows`:

```java
@Test
void resolve_acceptedShiftId_updatesMatchedShiftAndRecomputesHours() throws Exception {
    TasSession flagged = new TasSession();
    flagged.setSessionId(42);
    flagged.setEmployeeId("100");
    flagged.setDate(java.time.LocalDate.of(2026, 3, 10));
    flagged.setMatchedShiftId("manana");
    flagged.setMatchedShiftName("Manana");
    flagged.setAssignedShiftId("manana");
    flagged.setAssignedShiftName("Manana");
    flagged.setScans(List.of(
            java.time.LocalDateTime.of(2026, 3, 10, 15, 3),
            java.time.LocalDateTime.of(2026, 3, 10, 23, 5)));
    flagged.setNeedsResolution(true);
    flagged.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.SHIFT_MISMATCH)));

    TasUploadResult result = emptyResult();
    result.setFlaggedSessions(List.of(flagged));
    result.setAllSessions(List.of(flagged));
    when(parserService.parse(any())).thenReturn(emptyParseResult());
    when(uploadService.processScans(any(), any(), any())).thenReturn(result);

    MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
    String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
    String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

    when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
    TasReportBuilder.BuildResult buildResult = new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>());
    when(reportBuilder.build(any(), any(), any(), any(), any())).thenReturn(buildResult);

    Map<String, Object> resolution = new LinkedHashMap<>();
    resolution.put("sessionId", 42);
    resolution.put("acceptedShiftId", "tarde");

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("uploadToken", token);
    body.put("resolutions", List.of(resolution));

    mvc.perform(post("/api/tas/resolve")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(body)))
       .andExpect(status().isOk())
       .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

    assertThat(flagged.getMatchedShiftId()).isEqualTo("tarde");
    assertThat(flagged.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SHIFT_MISMATCH);
    assertThat(flagged.isNeedsResolution()).isFalse();
    verify(hoursCalculator).recompute(eq(flagged), any());
}
```

Add `import static org.assertj.core.api.Assertions.assertThat;` to the test file's imports if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && mvn -q test -Dtest=TasControllerTest`
Expected: FAIL — `flagged.getMatchedShiftId()` still `"manana"`, flags still contains `SHIFT_MISMATCH`, `needsResolution` still `true`, `recompute` never called.

- [ ] **Step 3: Implement the `acceptedShiftId` branch**

In `backend/src/main/java/com/planilla/backend/controller/TasController.java`, the resolve loop currently reads (around lines 144-171):

```java
            String resolvedStart = (String) res.get("resolvedStart");
            String resolvedEnd   = (String) res.get("resolvedEnd");

            if (resolvedStart != null && resolvedEnd != null) {
                LocalDateTime start = LocalDateTime.parse(resolvedStart, dtf);
                LocalDateTime end   = LocalDateTime.parse(resolvedEnd, dtf);

                session.setEffectiveStart(start);
                session.setLastScan(end);
                session.setScans(List.of(start, end));
                session.setFlags(Collections.emptyList());
                session.setNeedsResolution(false);

                long workedMinutes = java.time.temporal.ChronoUnit.MINUTES.between(start, end);
                if (workedMinutes < 0) workedMinutes = 0;
                session.setWorkedMinutes((int) workedMinutes);
                session.setWorkedHours(TasHoursCalculator.roundToHalfHour((int) workedMinutes));
                hoursCalculator.classifyHours(session, shifts);
            }
```

Replace it with:

```java
            String resolvedStart = (String) res.get("resolvedStart");
            String resolvedEnd   = (String) res.get("resolvedEnd");
            String acceptedShiftId = (String) res.get("acceptedShiftId");

            if (resolvedStart != null && resolvedEnd != null) {
                LocalDateTime start = LocalDateTime.parse(resolvedStart, dtf);
                LocalDateTime end   = LocalDateTime.parse(resolvedEnd, dtf);

                session.setEffectiveStart(start);
                session.setLastScan(end);
                session.setScans(List.of(start, end));
                session.setFlags(Collections.emptyList());
                session.setNeedsResolution(false);

                long workedMinutes = java.time.temporal.ChronoUnit.MINUTES.between(start, end);
                if (workedMinutes < 0) workedMinutes = 0;
                session.setWorkedMinutes((int) workedMinutes);
                session.setWorkedHours(TasHoursCalculator.roundToHalfHour((int) workedMinutes));
                hoursCalculator.classifyHours(session, shifts);
            } else if (acceptedShiftId != null) {
                session.setMatchedShiftId(acceptedShiftId);
                session.getFlags().removeIf(f -> f == TasFlag.SHIFT_MISMATCH);

                boolean hasBlockingFlags = session.getFlags().stream()
                        .anyMatch(f -> f != TasFlag.AMBIGUOUS_SHIFT);
                session.setNeedsResolution(hasBlockingFlags);

                if (!hasBlockingFlags) {
                    hoursCalculator.recompute(session, shifts);
                }
            }
```

This requires `import com.planilla.backend.model.tas.TasFlag;` — check the existing imports (line ~9 uses `com.planilla.backend.model.tas.*`-style); add the explicit `TasFlag` import if the wildcard doesn't already cover it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && mvn -q test -Dtest=TasControllerTest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/controller/TasController.java backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java
git commit -m "Support acceptedShiftId resolution for SHIFT_MISMATCH sessions"
```

---

### Task 6: Backend — `/api/tas/resolve` accepts `{ employeeId, date, keepSessionId }`

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/controller/TasController.java`
- Test: `backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java`

- [ ] **Step 1: Write the failing tests**

Add to `TasControllerTest.java`:

```java
private TasSession sameDayDoubleSession(int sessionId, String shiftId, String shiftName) {
    TasSession s = new TasSession();
    s.setSessionId(sessionId);
    s.setEmployeeId("100");
    s.setDate(java.time.LocalDate.of(2026, 3, 10));
    s.setMatchedShiftId(shiftId);
    s.setMatchedShiftName(shiftName);
    s.setAssignedShiftId(shiftId);
    s.setAssignedShiftName(shiftName);
    s.setScans(List.of(
            java.time.LocalDateTime.of(2026, 3, 10, 7, 0),
            java.time.LocalDateTime.of(2026, 3, 10, 15, 0)));
    s.setNeedsResolution(true);
    s.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE)));
    return s;
}

@Test
void resolve_keepSessionIdAll_clearsFlagAndRecomputesAllSessions() throws Exception {
    TasSession a = sameDayDoubleSession(10, "manana", "Manana");
    TasSession b = sameDayDoubleSession(11, "tarde", "Tarde");

    TasUploadResult result = emptyResult();
    result.setFlaggedSessions(List.of(a, b));
    result.setAllSessions(List.of(a, b));
    when(parserService.parse(any())).thenReturn(emptyParseResult());
    when(uploadService.processScans(any(), any(), any())).thenReturn(result);

    MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
    String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
    String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

    when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
    when(reportBuilder.build(any(), any(), any(), any(), any()))
            .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>()));

    Map<String, Object> resolution = new LinkedHashMap<>();
    resolution.put("employeeId", "100");
    resolution.put("date", "2026-03-10");
    resolution.put("keepSessionId", "all");

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("uploadToken", token);
    body.put("resolutions", List.of(resolution));

    mvc.perform(post("/api/tas/resolve")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(body)))
       .andExpect(status().isOk())
       .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

    assertThat(a.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
    assertThat(b.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
    assertThat(a.isNeedsResolution()).isFalse();
    assertThat(b.isNeedsResolution()).isFalse();
    verify(hoursCalculator, times(2)).recompute(any(), any());
}

@Test
void resolve_keepSessionIdSpecific_zeroesOutDiscardedSession() throws Exception {
    TasSession a = sameDayDoubleSession(10, "manana", "Manana");
    TasSession b = sameDayDoubleSession(11, "tarde", "Tarde");

    TasUploadResult result = emptyResult();
    result.setFlaggedSessions(List.of(a, b));
    result.setAllSessions(List.of(a, b));
    when(parserService.parse(any())).thenReturn(emptyParseResult());
    when(uploadService.processScans(any(), any(), any())).thenReturn(result);

    MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
    String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
    String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

    when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
    when(reportBuilder.build(any(), any(), any(), any(), any()))
            .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>()));

    Map<String, Object> resolution = new LinkedHashMap<>();
    resolution.put("employeeId", "100");
    resolution.put("date", "2026-03-10");
    resolution.put("keepSessionId", 10);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("uploadToken", token);
    body.put("resolutions", List.of(resolution));

    mvc.perform(post("/api/tas/resolve")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(body)))
       .andExpect(status().isOk())
       .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

    assertThat(a.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
    assertThat(a.isNeedsResolution()).isFalse();

    assertThat(b.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
    assertThat(b.isNeedsResolution()).isFalse();
    assertThat(b.getWorkedMinutes()).isEqualTo(0);
    assertThat(b.getWorkedHours()).isEqualTo(0.0);
    assertThat(b.getSimplesMinutes()).isEqualTo(0);
    assertThat(b.getDoblesMinutes()).isEqualTo(0);

    verify(hoursCalculator, times(1)).recompute(eq(a), any());
    verify(hoursCalculator, never()).recompute(eq(b), any());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && mvn -q test -Dtest=TasControllerTest`
Expected: FAIL — both new tests fail because the resolution is silently skipped (no `sessionId` field, so the existing `if (sessionIdObj == null) continue;` drops it).

- [ ] **Step 3: Implement the `keepSessionId` branch**

In `backend/src/main/java/com/planilla/backend/controller/TasController.java`, the resolve loop currently starts (around lines 134-141):

```java
        for (Map<String, Object> res : resolutions) {
            Object sessionIdObj = res.get("sessionId");
            if (sessionIdObj == null) continue;
            int sessionId = ((Number) sessionIdObj).intValue();
            TasSession session = flaggedBySessionId.get(sessionId);
            if (session == null) continue;
```

Replace with:

```java
        for (Map<String, Object> res : resolutions) {
            Object employeeIdObj = res.get("employeeId");
            Object dateObj = res.get("date");
            Object keepSessionIdObj = res.get("keepSessionId");
            if (employeeIdObj != null && dateObj != null && keepSessionIdObj != null) {
                applySameDayDoubleResolution(sessions, (String) employeeIdObj,
                        java.time.LocalDate.parse((String) dateObj), keepSessionIdObj, shifts);
                continue;
            }

            Object sessionIdObj = res.get("sessionId");
            if (sessionIdObj == null) continue;
            int sessionId = ((Number) sessionIdObj).intValue();
            TasSession session = flaggedBySessionId.get(sessionId);
            if (session == null) continue;
```

Add this private method near `mapAvailableShifts` (added in Task 3):

```java
    private void applySameDayDoubleResolution(
            List<TasSession> sessions,
            String employeeId,
            java.time.LocalDate date,
            Object keepSessionIdObj,
            List<Map<String, Object>> shifts) {

        boolean keepAll = "all".equals(keepSessionIdObj);
        Integer keepSessionId = keepAll ? null : ((Number) keepSessionIdObj).intValue();

        for (TasSession session : sessions) {
            if (!employeeId.equals(session.getEmployeeId())
                    || !date.equals(session.getDate())
                    || session.getFlags() == null
                    || !session.getFlags().contains(TasFlag.SAME_DAY_DOUBLE)) {
                continue;
            }

            session.getFlags().removeIf(f -> f == TasFlag.SAME_DAY_DOUBLE || f == TasFlag.SHIFT_MISMATCH);

            boolean discard = !keepAll && session.getSessionId() != keepSessionId;
            if (discard) {
                session.setWorkedMinutes(0);
                session.setWorkedHours(0.0);
                session.setSimplesMinutes(0);
                session.setDoblesMinutes(0);
                session.setNeedsResolution(false);
            } else {
                boolean hasBlockingFlags = session.getFlags().stream()
                        .anyMatch(f -> f != TasFlag.AMBIGUOUS_SHIFT);
                session.setNeedsResolution(hasBlockingFlags);
                if (!hasBlockingFlags) {
                    hoursCalculator.recompute(session, shifts);
                }
            }
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && mvn -q test -Dtest=TasControllerTest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/controller/TasController.java backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java
git commit -m "Support keepSessionId resolution for SAME_DAY_DOUBLE session groups"
```

---

### Task 7: Frontend — update types, API, and store for the new resolution shapes

**Files:**
- Modify: `frontend/src/tasTypes.ts`
- Modify: `frontend/src/tasApi.ts`
- Modify: `frontend/src/tasStore.ts`
- Test: `frontend/src/tasStore.test.ts` (create if it doesn't exist; check first with `ls frontend/src/tasStore.test.ts`)

- [ ] **Step 1: Update `tasTypes.ts`**

In `frontend/src/tasTypes.ts`:

1. Remove `consistentMismatch: boolean` from `TasSession`.
2. Add `assignedShiftId: string | null` and `assignedShiftName: string | null` to `TasSession` (alongside the existing `matchedShiftId`/`matchedShiftName`).
3. Add a new `ShiftOption` interface and an `availableShifts: ShiftOption[]` field to both `TasUploadResult` and `TasResolveResult`.

Resulting `TasSession` and new/updated interfaces:

```ts
export interface TasSession {
  sessionId: number
  employeeId: string
  employeeName: string
  date: string
  scans: string[]
  matchedShiftId: string | null
  matchedShiftName: string | null
  assignedShiftId: string | null
  assignedShiftName: string | null
  effectiveStart: string | null
  lastScan: string | null
  workedMinutes: number
  workedHours: number
  needsResolution: boolean
  flags: TasFlag[]
}

export interface ShiftOption {
  id: string
  name: string
  startTime: string
  endTime: string
}
```

```ts
export interface TasUploadResult {
  uploadToken: string
  resolvedRows?: ResolvedRow[]
  flaggedSessions: TasSession[]
  inactiveEmployeesFound: InactiveEmployee[]
  absentActiveEmployees: AbsentEmployee[]
  usedFallbackHolidays: boolean
  warnings: string[]
  availablePeriods?: TasPeriod[]
  availableShifts: ShiftOption[]
}

export interface TasResolveResult {
  uploadToken: string
  resolvedRows?: ResolvedRow[]
  flaggedSessions: TasSession[]
  usedFallbackHolidays: boolean
  availablePeriods?: TasPeriod[]
  availableShifts: ShiftOption[]
}
```

- [ ] **Step 2: Update `tasApi.ts` resolution type**

In `frontend/src/tasApi.ts`, add a `TasResolution` union type and use it for `resolveVerification`'s `resolutions` parameter:

```ts
import type { TasUploadResult, TasResolveResult, AbsentEmployee, TasPeriod, ResolvedRow } from './tasTypes';

export type TasResolution =
  | { sessionId: number; resolvedStart: string; resolvedEnd: string }
  | { sessionId: number; acceptedShiftId: string }
  | { employeeId: string; date: string; keepSessionId: number | 'all' };
```

Replace the `resolveVerification` signature:

```ts
export const resolveVerification = (
  token: string,
  resolutions: TasResolution[],
  period?: TasPeriod | null,
): Promise<TasResolveResult> => {
```

(body unchanged)

- [ ] **Step 3: Update `tasStore.ts`**

1. Remove `updateShift?: boolean` from `ResolvedSessionEntry`.
2. Add two new state slices and their setters/clear actions: `shiftAcceptances: Record<number, string>` and `sameDayDoubleResolutions: Record<string, number | 'all'>`.

```ts
export interface ResolvedSessionEntry {
  resolvedStart: string;
  resolvedEnd: string;
}
```

In the `TasStore` interface, add after `resolvedSessions`/`setResolvedSession`/`clearResolvedSessions`:

```ts
  shiftAcceptances: Record<number, string>;
  sameDayDoubleResolutions: Record<string, number | 'all'>;

  setShiftAcceptance: (sessionId: number, acceptedShiftId: string) => void;
  setSameDayDoubleResolution: (groupKey: string, keepSessionId: number | 'all') => void;
```

In `initialState`, add:

```ts
  shiftAcceptances: {} as Record<number, string>,
  sameDayDoubleResolutions: {} as Record<string, number | 'all'>,
```

In the store implementation, add alongside `setResolvedSession`/`clearResolvedSessions`:

```ts
  setShiftAcceptance: (sessionId, acceptedShiftId) => set(s => ({
    shiftAcceptances: { ...s.shiftAcceptances, [sessionId]: acceptedShiftId },
  })),
  setSameDayDoubleResolution: (groupKey, keepSessionId) => set(s => ({
    sameDayDoubleResolutions: { ...s.sameDayDoubleResolutions, [groupKey]: keepSessionId },
  })),
```

Update `clearResolvedSessions` to also clear the two new maps (it's called when the backend returns sessions still needing resolution, so all three in-flight resolution maps must reset together):

```ts
  clearResolvedSessions: () => set({ resolvedSessions: {}, shiftAcceptances: {}, sameDayDoubleResolutions: {} }),
```

- [ ] **Step 4: Write/update store tests**

Check whether `frontend/src/tasStore.test.ts` exists (`ls frontend/src/tasStore.test.ts`). If it exists, add tests in its style; if not, skip creating a new file — the new setters will be exercised via `VerificationScreen.test.tsx` in later tasks. Either way, add this test to whichever store-related test file is appropriate:

```ts
it('setShiftAcceptance stores the chosen shift id by session id', () => {
  useTasStore.getState().setShiftAcceptance(7, 'tarde');
  expect(useTasStore.getState().shiftAcceptances[7]).toBe('tarde');
});

it('setSameDayDoubleResolution stores the keep choice by group key', () => {
  useTasStore.getState().setSameDayDoubleResolution('100|2026-03-10', 'all');
  expect(useTasStore.getState().sameDayDoubleResolutions['100|2026-03-10']).toBe('all');
});

it('clearResolvedSessions clears shiftAcceptances and sameDayDoubleResolutions too', () => {
  useTasStore.getState().setShiftAcceptance(7, 'tarde');
  useTasStore.getState().setSameDayDoubleResolution('100|2026-03-10', 'all');
  useTasStore.getState().clearResolvedSessions();
  expect(useTasStore.getState().shiftAcceptances).toEqual({});
  expect(useTasStore.getState().sameDayDoubleResolutions).toEqual({});
});
```

- [ ] **Step 5: Run the type-check and any existing store tests**

Run: `cd frontend && npx tsc --noEmit`
Expected: Errors in `VerificationScreen.tsx`/`.test.tsx` referencing `consistentMismatch`/`updateShift`/`matchedShiftName` defaults — these are expected and will be fixed in Tasks 8-10. Confirm `tasTypes.ts`, `tasApi.ts`, and `tasStore.ts` themselves introduce no new errors (the errors should all point at `VerificationScreen.tsx`/`.test.tsx`).

Run the store test file if created/updated: `cd frontend && npx vitest run src/tasStore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/tasTypes.ts frontend/src/tasApi.ts frontend/src/tasStore.ts frontend/src/tasStore.test.ts
git commit -m "Add shift-acceptance and same-day-double resolution state"
```

(Drop `frontend/src/tasStore.test.ts` from the `git add` if it wasn't created/modified.)

---

### Task 8: Frontend — SHIFT_MISMATCH-only card redesign

**Files:**
- Modify: `frontend/src/components/tas/VerificationScreen.tsx`
- Test: `frontend/src/components/tas/VerificationScreen.test.tsx`

This task removes the dead "Sí, actualizar turno / No, mantener" block and `mismatchChoice` state, and adds a new `ShiftMismatchCard` component for sessions whose `flags` is exactly `['SHIFT_MISMATCH']`.

- [ ] **Step 1: Write the failing tests**

First, remove the now-obsolete `consistentMismatch banner` describe block (lines ~221-254) and the two `includes updateShift...` tests (in the `VerificationScreen submit` describe block, search for `includes updateShift`) from `VerificationScreen.test.tsx` — these test dead behavior that this task removes. Also update `makeSession` (lines 15-32): remove `matchedShiftName: 'Turno Mañana'` and `consistentMismatch: false`, add `assignedShiftId: 'S1'` and `assignedShiftName: 'Turno Mañana'`.

Then add a new describe block:

```ts
describe('VerificationScreen shift mismatch card', () => {
  function mismatchSession(overrides: Partial<TasSession> = {}): TasSession {
    return makeSession({
      flags: ['SHIFT_MISMATCH'],
      effectiveStart: '2026-03-10T07:03:00',
      lastScan: '2026-03-10T15:05:00',
      matchedShiftId: 'tarde',
      matchedShiftName: 'Tarde',
      assignedShiftId: 'manana',
      assignedShiftName: 'Manana',
      ...overrides,
    });
  }

  beforeEach(() => {
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    useTasStore.getState().setFlaggedSessions([mismatchSession()]);
  });

  it('shows the assigned and matched shift confirmation message', () => {
    render(<VerificationScreen />);
    expect(screen.getByText(/Turno asignado: Manana/)).toBeInTheDocument();
    expect(screen.getByText(/se aplicará Tarde/)).toBeInTheDocument();
  });

  it('does not render Entrada/Salida inputs or Horas calculadas', () => {
    render(<VerificationScreen />);
    expect(screen.queryByLabelText('Entrada')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Salida')).not.toBeInTheDocument();
    expect(screen.queryByText(/Horas calculadas/)).not.toBeInTheDocument();
  });

  it('Confirmar is enabled by default', () => {
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeEnabled();
  });

  it('confirming without choosing a different shift records the matched shift as accepted', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(useTasStore.getState().shiftAcceptances[1]).toBe('tarde');
  });

  it('clicking "Elegir otro turno" reveals a shift select with Aplicar/Cancelar', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /elegir otro turno/i }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /aplicar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument();
  });

  it('Cancelar collapses the dropdown without changing the displayed shift', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /elegir otro turno/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(/se aplicará Tarde/)).toBeInTheDocument();
  });

  it('Aplicar updates the confirmation message and records the chosen shift on confirm', () => {
    useTasStore.getState().setFlaggedSessions([mismatchSession()]);
    // availableShifts comes from the upload/resolve result, not flaggedSessions directly;
    // for this test we rely on the component falling back to matchedShiftId/matchedShiftName
    // plus assignedShift if availableShifts is empty -- so seed availableShifts via store if present,
    // otherwise this test exercises the dropdown using matchedShiftId/assignedShiftId as the two options.
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /elegir otro turno/i }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'manana' } });
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }));
    expect(screen.getByText(/se aplicará Manana/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(useTasStore.getState().shiftAcceptances[1]).toBe('manana');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx -t "shift mismatch card"`
Expected: FAIL — the current `SessionCard` always renders Entrada/Salida inputs and has no "Elegir otro turno" link.

- [ ] **Step 3: Implement `ShiftMismatchCard`**

Where `availableShifts` comes from: the store does not currently hold it. Add it now — in `frontend/src/tasStore.ts`, add `availableShifts: ShiftOption[]` to state (default `[]`) with a `setAvailableShifts` action, mirroring `availablePeriods`/`setAvailablePeriods`. Import `ShiftOption` from `./tasTypes`.

```ts
  availableShifts: ShiftOption[];
  setAvailableShifts: (shifts: ShiftOption[]) => void;
```

```ts
  availableShifts: [] as ShiftOption[],
```

```ts
  setAvailableShifts: (shifts) => set({ availableShifts: shifts }),
```

In `frontend/src/components/tas/VerificationScreen.tsx`, add the import:

```ts
import type { TasSession, TasFlag, TasPeriod, ShiftOption } from '../../tasTypes';
```

Add a new component above `SessionCard` (after `sessionMatchesFilter`):

```ts
interface ShiftMismatchCardProps {
  session: TasSession;
  availableShifts: ShiftOption[];
  confirmed: boolean;
  onConfirm: (acceptedShiftId: string) => void;
}

function ShiftMismatchCard({ session, availableShifts, confirmed, onConfirm }: ShiftMismatchCardProps) {
  const [selectedShiftId, setSelectedShiftId] = useState(session.matchedShiftId ?? '');
  const [choosingShift, setChoosingShift] = useState(false);
  const [pendingShiftId, setPendingShiftId] = useState(selectedShiftId);

  if (confirmed) {
    return (
      <div className="border-l-4 border-green-500 bg-white rounded-shape-md px-4 py-3 mb-3 flex items-center gap-4 shadow-sm">
        <div className="flex-1">
          <span className="font-medium text-on-surface">{session.employeeName}</span>
          <span className="mx-2 text-on-surface-variant">·</span>
          <span className="text-on-surface-variant text-body-sm">{formatDate(session.date)}</span>
        </div>
        <span className="text-green-600 text-body-sm font-medium">Confirmado</span>
      </div>
    );
  }

  const selectedShift = availableShifts.find(s => s.id === selectedShiftId);
  const selectedShiftName = selectedShift?.name ?? session.matchedShiftName ?? '';
  const selectedShiftTimes = selectedShift ? ` (${selectedShift.startTime}–${selectedShift.endTime})` : '';

  return (
    <div className="bg-white rounded-shape-md border border-outline-variant p-4 mb-3 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium text-on-surface">{session.employeeName}</span>
        <span className="text-on-surface-variant text-body-sm">{formatDate(session.date)}</span>
        <div className="flex gap-1 flex-wrap">
          {session.flags.map(f => (
            <span key={f} className={`text-label-sm px-2 py-0.5 rounded-full ${FLAG_COLORS[f]}`}>
              {flagLabel(f, session)}
            </span>
          ))}
        </div>
      </div>

      {session.scans.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {session.scans.map((s, i) => (
            <span key={i} className="px-2 py-1 rounded-shape-sm bg-surface-container text-body-sm text-on-surface-variant">
              {toHHMM(s)}
            </span>
          ))}
        </div>
      )}

      <div className="mb-3 rounded-shape-md border border-green-200 bg-green-50 px-3 py-2 text-body-sm">
        Turno asignado: <strong>{session.assignedShiftName ?? '—'}</strong> &rarr; se aplicará{' '}
        <strong>{selectedShiftName}{selectedShiftTimes}</strong> según las marcaciones.
        {!choosingShift && (
          <button
            type="button"
            onClick={() => { setPendingShiftId(selectedShiftId); setChoosingShift(true); }}
            className="ml-2 text-primary underline cursor-pointer"
          >
            Elegir otro turno
          </button>
        )}
      </div>

      {choosingShift && (
        <div className="mb-3 flex items-center gap-2">
          <select
            value={pendingShiftId}
            onChange={e => setPendingShiftId(e.target.value)}
            className="h-9 px-3 rounded-shape-sm border border-outline bg-white text-body-md focus:outline-none focus:border-primary"
          >
            {availableShifts.map(shift => (
              <option key={shift.id} value={shift.id}>
                {shift.name} ({shift.startTime}–{shift.endTime})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { setSelectedShiftId(pendingShiftId); setChoosingShift(false); }}
            className="m3-btn-filled"
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={() => setChoosingShift(false)}
            className="m3-btn-text"
          >
            Cancelar
          </button>
        </div>
      )}

      <button
        onClick={() => onConfirm(selectedShiftId)}
        className="m3-btn-filled"
      >
        Confirmar
      </button>
    </div>
  );
}
```

Check `m3-btn-text` exists as a class in the project's CSS (search `grep -rn "m3-btn-text" frontend/src`); if it doesn't exist, use the same `m3-btn-filled` class as Cancelar but add a `variant`-neutral style inline, e.g. `className="px-4 py-2 rounded-shape-full border border-outline text-on-surface cursor-pointer"`.

- [ ] **Step 4: Remove the dead `consistentMismatch` block and `mismatchChoice` state from `SessionCard`**

In `SessionCard` (the existing component), remove:
- The `mismatchChoice` state line: `const [mismatchChoice, setMismatchChoice] = useState<'update' | 'keep' | null>(null);`
- The `session.matchedShiftName && (...)` paragraph block (lines ~136-140)
- The `session.consistentMismatch && (...)` block (lines ~152-181)
- Change the `SessionCardProps.onConfirm` signature from `(resolvedStart: string, resolvedEnd: string, mismatchChoice: 'update' | 'keep' | null) => void` to `(resolvedStart: string, resolvedEnd: string) => void`
- Change the Confirmar button's `onClick` from `() => onConfirm(entry, exit, mismatchChoice)` to `() => onConfirm(entry, exit)`

- [ ] **Step 5: Wire `ShiftMismatchCard` into `VerificationScreen`**

In `VerificationScreen`, add new selectors near the top:

```ts
  const availableShifts          = useTasStore(s => s.availableShifts);
  const setAvailableShifts        = useTasStore(s => s.setAvailableShifts);
  const shiftAcceptances          = useTasStore(s => s.shiftAcceptances);
  const setShiftAcceptance        = useTasStore(s => s.setShiftAcceptance);
```

After `const filtered = needsResolutionSessions.filter(...)`, split `filtered` into render groups (full grouping for SAME_DAY_DOUBLE comes in Task 9 — for this task, only split out shift-mismatch-only sessions):

```ts
  const shiftMismatchOnly = filtered.filter(s => s.flags.length === 1 && s.flags[0] === 'SHIFT_MISMATCH');
  const regular = filtered.filter(s => !shiftMismatchOnly.includes(s));
```

Replace the `{filtered.map(session => (...))}` block with:

```tsx
            {regular.map(session => (
              <SessionCard
                key={session.sessionId}
                session={session}
                confirmed={!!resolvedSessions[session.sessionId]}
                onConfirm={(resolvedStart, resolvedEnd) =>
                  setResolvedSession(session.sessionId, { resolvedStart, resolvedEnd })
                }
              />
            ))}

            {shiftMismatchOnly.map(session => (
              <ShiftMismatchCard
                key={session.sessionId}
                session={session}
                availableShifts={availableShifts}
                confirmed={shiftAcceptances[session.sessionId] !== undefined}
                onConfirm={(acceptedShiftId) => setShiftAcceptance(session.sessionId, acceptedShiftId)}
              />
            ))}
```

Update `confirmedCount`/`pendingCount` to count shift-mismatch acceptances too. Replace:

```ts
  const confirmedCount  = Object.keys(resolvedSessions).length;
```

with:

```ts
  const confirmedCount  = Object.keys(resolvedSessions).length + Object.keys(shiftAcceptances).length;
```

Update `handleSubmit` to include `shiftAcceptances` in the `resolutions` payload and to populate `availableShifts`/clear the new maps on response. Replace the `resolutions` construction:

```ts
      const resolutions: TasResolution[] = [
        ...Object.entries(resolvedSessions).map(([id, entry]) => ({
          sessionId: Number(id),
          resolvedStart: entry.resolvedStart,
          resolvedEnd:   entry.resolvedEnd,
        })),
        ...Object.entries(shiftAcceptances).map(([id, acceptedShiftId]) => ({
          sessionId: Number(id),
          acceptedShiftId,
        })),
      ];
```

Add `import type { TasResolution } from '../../tasApi';` alongside the existing `resolveVerification` import:

```ts
import { resolveVerification } from '../../tasApi';
import type { TasResolution } from '../../tasApi';
```

After `setAvailablePeriods(result.availablePeriods ?? []);` (both occurrences — the early-return "still needs resolution" branch and the success branch), add:

```ts
      setAvailableShifts(result.availableShifts ?? []);
```

Finally, ensure `availableShifts` is populated on initial upload too. In `frontend/src/components/tas/UploadScreen.tsx` (or wherever the upload result is first consumed — search `setFlaggedSessions(` and `setAvailablePeriods(` together via `grep -rn "setAvailablePeriods" frontend/src/components/tas`), add a corresponding `setAvailableShifts(result.availableShifts ?? [])` call next to the existing `setAvailablePeriods` call.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx`
Expected: PASS — all tests including the new shift-mismatch-card ones and the existing suite (minus the removed dead-code tests).

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/tas/VerificationScreen.tsx frontend/src/components/tas/VerificationScreen.test.tsx frontend/src/tasStore.ts frontend/src/components/tas/UploadScreen.tsx
git commit -m "Redesign SHIFT_MISMATCH-only verification card with shift override"
```

(Adjust the `UploadScreen.tsx` path/inclusion based on where `setAvailablePeriods` is actually called from Step 5.)

---

### Task 9: Frontend — SAME_DAY_DOUBLE group card

**Files:**
- Modify: `frontend/src/components/tas/VerificationScreen.tsx`
- Test: `frontend/src/components/tas/VerificationScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add a new describe block:

```ts
describe('VerificationScreen same-day double group', () => {
  function doubleSession(overrides: Partial<TasSession> = {}): TasSession {
    return makeSession({
      flags: ['SAME_DAY_DOUBLE'],
      scans: ['2026-03-15T07:00:00', '2026-03-15T15:00:00'],
      effectiveStart: '2026-03-15T07:00:00',
      lastScan: '2026-03-15T15:00:00',
      matchedShiftId: 'manana',
      matchedShiftName: 'Manana',
      assignedShiftId: 'manana',
      assignedShiftName: 'Manana',
      ...overrides,
    });
  }

  beforeEach(() => {
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    useTasStore.getState().setFlaggedSessions([
      doubleSession({ sessionId: 1, matchedShiftId: 'manana', matchedShiftName: 'Manana' }),
      doubleSession({
        sessionId: 2,
        scans: ['2026-03-15T15:02:00', '2026-03-15T23:00:00'],
        effectiveStart: '2026-03-15T15:02:00',
        lastScan: '2026-03-15T23:00:00',
        matchedShiftId: 'tarde',
        matchedShiftName: 'Tarde',
      }),
    ]);
  });

  it('renders one group card for both sessions on the same employee/date', () => {
    render(<VerificationScreen />);
    expect(screen.getAllByText(/Ana López/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Manana/)).toBeInTheDocument();
    expect(screen.getByText(/Tarde/)).toBeInTheDocument();
  });

  it('renders a radio per session plus "Mantener todas", defaulting to "Mantener todas"', () => {
    render(<VerificationScreen />);
    const keepAllRadio = screen.getByRole('radio', { name: /mantener todas/i });
    expect(keepAllRadio).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('Confirmar is enabled without any selection change', () => {
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeEnabled();
  });

  it('confirming with default selection records "all" for the group', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(useTasStore.getState().sameDayDoubleResolutions['E1|2026-03-15']).toBe('all');
  });

  it('selecting a specific session and confirming records that session id', () => {
    render(<VerificationScreen />);
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]); // first session-specific radio
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(useTasStore.getState().sameDayDoubleResolutions['E1|2026-03-15']).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx -t "same-day double"`
Expected: FAIL — sessions currently render as two separate `SessionCard`s with time inputs, no radios.

- [ ] **Step 3: Implement `SameDayDoubleGroupCard` and grouping**

Add a new component after `ShiftMismatchCard`:

```ts
interface SameDayDoubleGroupCardProps {
  sessions: TasSession[];
  confirmed: boolean;
  onConfirm: (keepSessionId: number | 'all') => void;
}

function SameDayDoubleGroupCard({ sessions, confirmed, onConfirm }: SameDayDoubleGroupCardProps) {
  const [choice, setChoice] = useState<number | 'all'>('all');
  const first = sessions[0];

  if (confirmed) {
    return (
      <div className="border-l-4 border-green-500 bg-white rounded-shape-md px-4 py-3 mb-3 flex items-center gap-4 shadow-sm">
        <div className="flex-1">
          <span className="font-medium text-on-surface">{first.employeeName}</span>
          <span className="mx-2 text-on-surface-variant">·</span>
          <span className="text-on-surface-variant text-body-sm">{formatDate(first.date)}</span>
        </div>
        <span className="text-green-600 text-body-sm font-medium">Confirmado</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-shape-md border border-outline-variant p-4 mb-3 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium text-on-surface">{first.employeeName}</span>
        <span className="text-on-surface-variant text-body-sm">{formatDate(first.date)}</span>
        <span className={`text-label-sm px-2 py-0.5 rounded-full ${FLAG_COLORS.SAME_DAY_DOUBLE}`}>
          {FLAG_LABELS.SAME_DAY_DOUBLE}
        </span>
      </div>

      <div className="flex flex-col gap-2 mb-3">
        {sessions.map(session => (
          <label key={session.sessionId} className="flex items-center gap-2 text-body-sm text-on-surface cursor-pointer">
            <input
              type="radio"
              name={`same-day-double-${first.employeeId}-${first.date}`}
              checked={choice === session.sessionId}
              onChange={() => setChoice(session.sessionId)}
            />
            {session.matchedShiftName ?? '—'} ({toHHMM(session.effectiveStart)}–{toHHMM(session.lastScan)}) — marcaciones:{' '}
            {session.scans.map(toHHMM).join(', ')}
          </label>
        ))}
        <label className="flex items-center gap-2 text-body-sm text-on-surface cursor-pointer">
          <input
            type="radio"
            name={`same-day-double-${first.employeeId}-${first.date}`}
            checked={choice === 'all'}
            onChange={() => setChoice('all')}
          />
          Mantener todas
        </label>
      </div>

      <button
        onClick={() => onConfirm(choice)}
        className="m3-btn-filled"
      >
        Confirmar
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Wire grouping into `VerificationScreen`**

Add selectors:

```ts
  const sameDayDoubleResolutions    = useTasStore(s => s.sameDayDoubleResolutions);
  const setSameDayDoubleResolution  = useTasStore(s => s.setSameDayDoubleResolution);
```

Update the splitting logic introduced in Task 8. Replace:

```ts
  const shiftMismatchOnly = filtered.filter(s => s.flags.length === 1 && s.flags[0] === 'SHIFT_MISMATCH');
  const regular = filtered.filter(s => !shiftMismatchOnly.includes(s));
```

with:

```ts
  const sameDayDoubleSessions = filtered.filter(s => s.flags.includes('SAME_DAY_DOUBLE'));
  const shiftMismatchOnly = filtered.filter(
    s => !sameDayDoubleSessions.includes(s) && s.flags.length === 1 && s.flags[0] === 'SHIFT_MISMATCH',
  );
  const regular = filtered.filter(
    s => !sameDayDoubleSessions.includes(s) && !shiftMismatchOnly.includes(s),
  );

  const sameDayDoubleGroups = new Map<string, TasSession[]>();
  for (const session of sameDayDoubleSessions) {
    const key = `${session.employeeId}|${session.date}`;
    const group = sameDayDoubleGroups.get(key) ?? [];
    group.push(session);
    sameDayDoubleGroups.set(key, group);
  }
```

Add rendering for the groups, e.g. right before the `{regular.map(...)}` block:

```tsx
            {Array.from(sameDayDoubleGroups.entries()).map(([groupKey, groupSessions]) => (
              <SameDayDoubleGroupCard
                key={groupKey}
                sessions={groupSessions}
                confirmed={sameDayDoubleResolutions[groupKey] !== undefined}
                onConfirm={(keepSessionId) => setSameDayDoubleResolution(groupKey, keepSessionId)}
              />
            ))}
```

Update `confirmedCount` to also count each resolved group's session count:

```ts
  const confirmedCount = Object.keys(resolvedSessions).length
    + Object.keys(shiftAcceptances).length
    + Array.from(sameDayDoubleGroups.entries())
        .filter(([groupKey]) => sameDayDoubleResolutions[groupKey] !== undefined)
        .reduce((sum, [, sessions]) => sum + sessions.length, 0);
```

Update `handleSubmit`'s `resolutions` array to append same-day-double resolutions:

```ts
      const resolutions: TasResolution[] = [
        ...Object.entries(resolvedSessions).map(([id, entry]) => ({
          sessionId: Number(id),
          resolvedStart: entry.resolvedStart,
          resolvedEnd:   entry.resolvedEnd,
        })),
        ...Object.entries(shiftAcceptances).map(([id, acceptedShiftId]) => ({
          sessionId: Number(id),
          acceptedShiftId,
        })),
        ...Object.entries(sameDayDoubleResolutions).map(([groupKey, keepSessionId]) => {
          const [employeeId, date] = groupKey.split('|');
          return { employeeId, date, keepSessionId };
        }),
      ];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx`
Expected: PASS (full suite)

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/tas/VerificationScreen.tsx frontend/src/components/tas/VerificationScreen.test.tsx
git commit -m "Add grouped keep-all/keep-one card for SAME_DAY_DOUBLE sessions"
```

---

### Task 10: Full-suite verification and coverage check

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && mvn -q test`
Expected: all tests PASS.

- [ ] **Step 2: Run the full frontend test suite with coverage**

Run: `cd frontend && npx vitest run --coverage`
Expected: all tests PASS; coverage for `VerificationScreen.tsx`, `tasStore.ts`, `tasApi.ts` remains at/near 100% per `feedback_test_coverage.md`. If any branch in `ShiftMismatchCard`/`SameDayDoubleGroupCard` is uncovered (e.g. the `selectedShift` fallback when `availableShifts` is empty, or the `confirmed` early-return branches), add a small targeted test for that branch in `VerificationScreen.test.tsx`.

- [ ] **Step 3: Run backend coverage**

Run: `cd backend && mvn -q test jacoco:report` (or whatever the project's existing coverage command is — check `backend/pom.xml` for the jacoco goal binding first)
Expected: ~99% instruction coverage maintained for `TasController`, `TasSessionGrouper`, `TasHoursCalculator`.

- [ ] **Step 4: Manual smoke test**

Start backend and frontend dev servers, upload a CSV that produces `SHIFT_MISMATCH` and `SAME_DAY_DOUBLE` flagged sessions (e.g. `docs/Reporte TAS Marzo 2026.csv` mentioned by the user), and confirm in the browser:
- SHIFT_MISMATCH-only cards show the confirmation message (no time fields, no "NaNh")
- "Elegir otro turno" reveals the dropdown and "Aplicar" updates the message
- SAME_DAY_DOUBLE sessions render as one group card with radios, default "Mantener todas"
- Submitting resolves all sessions and reaches the review screen

- [ ] **Step 5: No commit for this task** (verification only — fix any issues found via targeted commits using the patterns from Tasks 1-9).

---

## Self-Review Notes

- **Spec coverage:** Section 1 (toHHMM) → Task 1. Section 2 (SHIFT_MISMATCH redesign incl. backend fields, availableShifts, dropdown, acceptedShiftId resolve) → Tasks 2, 3, 5, 7, 8. Section 3 (SAME_DAY_DOUBLE redesign incl. grouping, keepSessionId resolve) → Tasks 6, 9. Section 4 (resolve endpoint extensions) → Tasks 5, 6. Testing section → covered per-task plus Task 10.
- **Dead code removal:** the unpopulated `consistentMismatch`/`matchedShiftName`-as-frontend-only field and the unused `updateShift` resolution field (confirmed via grep that `TasController.resolve()` never read it) are removed in Tasks 7-8 rather than left alongside the new mechanism.
- **Combined-flags note (deviation from literal spec wording):** when a session carries both `SAME_DAY_DOUBLE` and `SHIFT_MISMATCH`, Task 6's `applySameDayDoubleResolution` removes both flags so the group resolution alone clears `needsResolution` — matching the user's stated intent ("require no input from the user just a visual confirmation") without requiring a second SHIFT_MISMATCH card for the same session.
- **Type consistency:** `TasResolution` (tasApi.ts) ↔ `resolutions` array built in `handleSubmit` (Task 9) ↔ backend `resolve()` branch dispatch (Tasks 5-6) all use the same three shapes: `{sessionId, resolvedStart, resolvedEnd}`, `{sessionId, acceptedShiftId}`, `{employeeId, date, keepSessionId}`. `recompute(session, shifts)` (Task 4) is used identically in Tasks 5 and 6.
