# TAS Overtime Rules Redesign (TASK-33) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redefine `horas_extras_simples`/`horas_extras_dobles` as overtime-only fields (Mon-Sat overtime vs. Sunday/holiday hours), handle cross-midnight sessions that span a Sunday/holiday boundary, and add a per-employee "does not accrue overtime" flag configurable from both the Config Employees tab and the TAS review screen.

**Architecture:** Backend changes are concentrated in `TasHoursCalculator` (per-session classification), `TasReportBuilder` (per-employee aggregation + exemption zeroing), `EmployeeRegistryService`/`EmployeeRegistryController` (new flag), and `TasController` (new recompute endpoint). Frontend changes add a toggle column to `EmployeesTab` and `ReviewScreen`, with `ReviewScreen` calling a recompute endpoint after toggling.

**Tech Stack:** Spring Boot (Java 17), JdbcTemplate + H2, React + TypeScript + Zustand, Vitest, JUnit5/Mockito/AssertJ.

---

### Task 1: Redefine Mon-Sat overtime split in `TasHoursCalculator`

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasHoursCalculator.java:157-183`
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasHoursCalculatorTest.java`

- [ ] **Step 1: Update the existing within-shift test to expect 0/0**

In `TasHoursCalculatorTest.java`, replace the `calculate_hoursWithinShiftDuration_allSimples` test (lines 273-286):

```java
    @Test
    void calculate_hoursWithinShiftDuration_noOvertime() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getSimplesMinutes()).isEqualTo(0);
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
    }
```

- [ ] **Step 2: Update the existing over-shift-duration test to expect overtime-only-to-simples**

Replace the `calculate_hoursExceedingShiftDuration_splitSimplesDobles` test (lines 288-302):

```java
    @Test
    void calculate_hoursExceedingShiftDuration_overtimeGoesToSimplesOnly() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 17, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(600);
        assertThat(s.getSimplesMinutes()).isEqualTo(120); // 600 - 480 (shift duration)
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
    }
```

- [ ] **Step 3: Update the ambiguous-shift test's expected split**

In `calculate_ambiguousShiftFlagAlone_doesNotBlockHoursComputation` (lines 304-323), replace the final two assertions:

```java
        // 8h default shift duration: overtime beyond 480min goes to simples, dobles stays 0
        assertThat(s.getSimplesMinutes()).isEqualTo(120);
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
```

- [ ] **Step 4: Run the test file to confirm these three now fail**

Run: `cd backend && mvn -q -Dtest=TasHoursCalculatorTest test`
Expected: FAIL — `calculate_hoursWithinShiftDuration_noOvertime`, `calculate_hoursExceedingShiftDuration_overtimeGoesToSimplesOnly`, and `calculate_ambiguousShiftFlagAlone_doesNotBlockHoursComputation` fail against the old `classifyHours` logic.

- [ ] **Step 5: Rewrite `classifyHours` in `TasHoursCalculator.java`**

Replace lines 157-183 (the `classifyHours` method body) with:

```java
    public void classifyHours(TasSession session, List<Map<String, Object>> shifts) {
        int totalMinutes = session.getWorkedMinutes();

        boolean startIsSpecial = isSpecialDay(session.getDate());

        LocalDateTime effectiveStart = session.getEffectiveStart();
        LocalDateTime lastScan = session.getLastScan();
        boolean crossesIntoNextDay = effectiveStart != null && lastScan != null
                && lastScan.toLocalDate().isAfter(effectiveStart.toLocalDate());

        if (crossesIntoNextDay) {
            LocalDate nextDate = effectiveStart.toLocalDate().plusDays(1);
            boolean endIsSpecial = isSpecialDay(nextDate);

            if (startIsSpecial != endIsSpecial) {
                LocalDateTime midnight = LocalDateTime.of(nextDate, LocalTime.MIDNIGHT);
                long rawBeforeMidnight = Math.max(0, ChronoUnit.MINUTES.between(effectiveStart, midnight));
                long rawAfterMidnight  = Math.max(0, ChronoUnit.MINUTES.between(midnight, lastScan));

                int specialMinutes = startIsSpecial
                        ? (int) Math.min(totalMinutes, rawBeforeMidnight)
                        : (int) Math.min(totalMinutes, rawAfterMidnight);
                int normalMinutes = totalMinutes - specialMinutes;

                session.setSimplesMinutes(classifyNormalMinutes(normalMinutes, session, shifts));
                session.setDoblesMinutes(specialMinutes);
                return;
            }
        }

        if (startIsSpecial) {
            session.setSimplesMinutes(0);
            session.setDoblesMinutes(totalMinutes);
            return;
        }

        session.setSimplesMinutes(classifyNormalMinutes(totalMinutes, session, shifts));
        session.setDoblesMinutes(0);
    }

    private boolean isSpecialDay(LocalDate date) {
        return date.getDayOfWeek() == DayOfWeek.SUNDAY || holidayService.isHoliday(date);
    }

    private int classifyNormalMinutes(int totalMinutes, TasSession session, List<Map<String, Object>> shifts) {
        Map<String, Object> shift = findShiftById(shifts, session.getMatchedShiftId());
        int shiftDurationMinutes = computeShiftDurationMinutes(shift);

        int shiftDurationInHalfHours = (int) (Math.floor(shiftDurationMinutes / 30.0));
        int shiftDurationRoundedMinutes = shiftDurationInHalfHours * 30;

        return totalMinutes > shiftDurationRoundedMinutes
                ? totalMinutes - shiftDurationRoundedMinutes
                : 0;
    }
```

- [ ] **Step 6: Run the full `TasHoursCalculatorTest` suite**

Run: `cd backend && mvn -q -Dtest=TasHoursCalculatorTest test`
Expected: PASS — all tests including the three updated in steps 1-3.

- [ ] **Step 7: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git checkout -b feature/tas-overtime-rules-redesign
git add backend/src/main/java/com/planilla/backend/service/tas/TasHoursCalculator.java backend/src/test/java/com/planilla/backend/service/tas/TasHoursCalculatorTest.java
git commit -m "Redefine Mon-Sat overtime split: simples is overtime-only, dobles no longer receives Mon-Sat hours"
```

---

### Task 2: Cross-midnight sessions spanning a Sunday/holiday boundary

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasHoursCalculator.java` (already rewritten in Task 1 — this task adds tests for the branch it introduced)
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasHoursCalculatorTest.java`

- [ ] **Step 1: Write a failing test — shift starts on Sunday, ends Monday**

Add to `TasHoursCalculatorTest.java`. This uses the `noche` shift (19:00-07:00, cross-midnight, 12h duration → 720min, which rounds to 720 in 30-min steps).

```java
    @Test
    void calculate_crossMidnight_startsSunday_endsMonday_splitsAtMidnight() {
        // Sunday 2026-03-08 19:00 -> Monday 2026-03-09 07:00 (noche shift, no break)
        LocalDate sunday = LocalDate.of(2026, 3, 8);
        TasSession s = session(sunday,
            LocalDateTime.of(2026, 3, 8, 19, 0),
            LocalDateTime.of(2026, 3, 9, 7, 0)
        );
        s.setCrossMidnight(true);
        s.setMatchedShiftId("noche");

        Map<String, Object> nocheShift = new LinkedHashMap<>();
        nocheShift.put("id", "noche");
        nocheShift.put("name", "Noche");
        nocheShift.put("start_time", "19:00");
        nocheShift.put("end_time", "07:00");
        nocheShift.put("cross_midnight", true);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(nocheShift));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(720); // 12h, no break
        // 5h (19:00-00:00) on Sunday -> dobles; 7h (00:00-07:00) Monday, within 12h shift -> simples 0
        assertThat(s.getDoblesMinutes()).isEqualTo(300);
        assertThat(s.getSimplesMinutes()).isEqualTo(0);
    }
```

- [ ] **Step 2: Run it to verify it currently fails (or already passes)**

Run: `cd backend && mvn -q -Dtest=TasHoursCalculatorTest#calculate_crossMidnight_startsSunday_endsMonday_splitsAtMidnight test`
Expected: With the Task 1 rewrite already in place, this should PASS — the new `classifyHours` handles this branch. If it FAILS, re-check the `classifyHours` rewrite from Task 1 step 5 (e.g. `effectiveStart`/`lastScan` not set correctly before `classifyHours` runs).

- [ ] **Step 3: Write a failing test — shift starts on a normal day, ends on Sunday**

```java
    @Test
    void calculate_crossMidnight_startsSaturday_endsSunday_splitsAtMidnight() {
        // Saturday 2026-03-07 19:00 -> Sunday 2026-03-08 07:00 (noche shift, no break)
        LocalDate saturday = LocalDate.of(2026, 3, 7);
        TasSession s = session(saturday,
            LocalDateTime.of(2026, 3, 7, 19, 0),
            LocalDateTime.of(2026, 3, 8, 7, 0)
        );
        s.setCrossMidnight(true);
        s.setMatchedShiftId("noche");

        Map<String, Object> nocheShift = new LinkedHashMap<>();
        nocheShift.put("id", "noche");
        nocheShift.put("name", "Noche");
        nocheShift.put("start_time", "19:00");
        nocheShift.put("end_time", "07:00");
        nocheShift.put("cross_midnight", true);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(nocheShift));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(720); // 12h, no break
        // 7h (19:00-00:00) Saturday, within 12h shift -> simples 0; 5h (00:00-07:00) Sunday -> dobles
        assertThat(s.getDoblesMinutes()).isEqualTo(300);
        assertThat(s.getSimplesMinutes()).isEqualTo(0);
    }

    @Test
    void calculate_crossMidnight_startsFriday_endsSaturday_noSpecialDay_normalSplit() {
        // Friday 2026-03-06 19:00 -> Saturday 2026-03-07 09:00 (noche shift, 14h worked, no break)
        LocalDate friday = LocalDate.of(2026, 3, 6);
        TasSession s = session(friday,
            LocalDateTime.of(2026, 3, 6, 19, 0),
            LocalDateTime.of(2026, 3, 7, 9, 0)
        );
        s.setCrossMidnight(true);
        s.setMatchedShiftId("noche");

        Map<String, Object> nocheShift = new LinkedHashMap<>();
        nocheShift.put("id", "noche");
        nocheShift.put("name", "Noche");
        nocheShift.put("start_time", "19:00");
        nocheShift.put("end_time", "07:00");
        nocheShift.put("cross_midnight", true);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(nocheShift));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(840); // 14h, no break
        // Neither Friday nor Saturday is special -> normal split: 840 - 720 (12h shift) = 120 simples
        assertThat(s.getSimplesMinutes()).isEqualTo(120);
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
    }
```

- [ ] **Step 4: Run all three new tests**

Run: `cd backend && mvn -q -Dtest=TasHoursCalculatorTest test`
Expected: PASS for all three. If `calculate_crossMidnight_startsFriday_endsSaturday_noSpecialDay_normalSplit` fails because `crossesIntoNextDay` is true but `startIsSpecial == endIsSpecial` (both false), confirm the rewrite falls through to the final `if (startIsSpecial) {...} else { classifyNormalMinutes(totalMinutes, ...) }` branch using the **full** `totalMinutes`, not a midnight-split portion — this is the expected fallthrough behavior from Task 1 step 5.

- [ ] **Step 5: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add backend/src/test/java/com/planilla/backend/service/tas/TasHoursCalculatorTest.java
git commit -m "Add tests for cross-midnight sessions spanning a Sunday/holiday boundary"
```

---

### Task 3: Add `accrues_overtime` column to `employee_registry`

**Files:**
- Modify: `backend/src/main/resources/schema-h2.sql:20-28`
- Modify: `backend/src/main/resources/migrate-holiday-year.sql`

- [ ] **Step 1: Add the column to the CREATE TABLE statement (for fresh databases)**

In `schema-h2.sql`, update the `employee_registry` table definition (lines 20-28):

```sql
CREATE TABLE IF NOT EXISTS employee_registry (
    employee_id     VARCHAR(50)   PRIMARY KEY,
    name            VARCHAR(255)  NOT NULL,
    shift_id        VARCHAR(36),
    active          BOOLEAN       NOT NULL DEFAULT TRUE,
    accrues_overtime BOOLEAN      NOT NULL DEFAULT TRUE,
    first_seen      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_emp_shift FOREIGN KEY (shift_id) REFERENCES shift_config(id) ON DELETE SET NULL
);
```

- [ ] **Step 2: Add an ALTER statement for existing databases**

`migrate-holiday-year.sql` runs with `continueOnError=true` before `schema-h2.sql`, so it's the right place for additive column migrations on existing installs. Append to `backend/src/main/resources/migrate-holiday-year.sql`:

```sql

-- Add accrues_overtime flag for employees who don't accrue horas_extras_simples/dobles (TASK-33).
-- Runs with continueOnError=true so it is silently skipped on fresh databases where
-- employee_registry doesn't exist yet (schema-h2.sql will create it with the column already).
ALTER TABLE employee_registry ADD COLUMN IF NOT EXISTS accrues_overtime BOOLEAN NOT NULL DEFAULT TRUE;
```

- [ ] **Step 3: Verify by starting the backend locally**

Run: `cd backend && mvn -q spring-boot:run -D spring-boot.run.arguments=--server.port=49399 &` then check it starts without SQL errors, then stop it:
Run: `sleep 8 && curl -s http://localhost:49399/api/config/employees | head -c 200; kill %1`
Expected: backend starts cleanly (no SQL exceptions in output) and the employees endpoint responds (likely `[]` on a clean DB).

- [ ] **Step 4: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add backend/src/main/resources/schema-h2.sql backend/src/main/resources/migrate-holiday-year.sql
git commit -m "Add accrues_overtime column to employee_registry"
```

---

### Task 4: `EmployeeRegistryService` — get/set `accruesOvertime`

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/EmployeeRegistryService.java`
- Test: `backend/src/test/java/com/planilla/backend/service/tas/EmployeeRegistryServiceTest.java`

- [ ] **Step 1: Read the existing test file's setup to match patterns**

Run: `sed -n '1,60p' backend/src/test/java/com/planilla/backend/service/tas/EmployeeRegistryServiceTest.java`

This shows how `jdbc` is mocked (H2 JdbcTemplate) and how `toEmployeeDto` rows are constructed in tests — match that style for the new test below.

- [ ] **Step 2: Write a failing test for `setAccruesOvertime`**

Add to `EmployeeRegistryServiceTest.java`:

```java
    @Test
    void setAccruesOvertime_updatesFlagAndReturnsDto() {
        when(jdbc.queryForList(contains("WHERE r.employee_id = ?"), eq("100")))
            .thenReturn(List.of(rowMap("100", "Ana", "manana", "Manana", true, false)));

        Map<String, Object> result = service.setAccruesOvertime("100", false);

        verify(jdbc).update("UPDATE employee_registry SET accrues_overtime = ? WHERE employee_id = ?", false, "100");
        assertThat(result.get("accruesOvertime")).isEqualTo(false);
    }
```

If the test file doesn't already have a `rowMap(...)` helper, add one matching the existing `toEmployeeDto` column names (`EMPLOYEE_ID`, `NAME`, `SHIFT_ID`, `SHIFT_NAME`, `ACTIVE`, plus the new `ACCRUES_OVERTIME`):

```java
    private Map<String, Object> rowMap(String id, String name, String shiftId, String shiftName, boolean active, boolean accruesOvertime) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("EMPLOYEE_ID", id);
        row.put("NAME", name);
        row.put("SHIFT_ID", shiftId);
        row.put("SHIFT_NAME", shiftName);
        row.put("ACTIVE", active);
        row.put("ACCRUES_OVERTIME", accruesOvertime);
        return row;
    }
```

- [ ] **Step 3: Run to confirm it fails**

Run: `cd backend && mvn -q -Dtest=EmployeeRegistryServiceTest#setAccruesOvertime_updatesFlagAndReturnsDto test`
Expected: FAIL — compile error or "method not found" (`setAccruesOvertime` doesn't exist yet).

- [ ] **Step 4: Implement `setAccruesOvertime` and include the field in `toEmployeeDto`**

In `EmployeeRegistryService.java`:

1. Update `SELECT_BASE` (line 18-20) to include the new column:

```java
    private static final String SELECT_BASE =
        "SELECT r.employee_id, r.name, r.shift_id, r.active, r.accrues_overtime, s.name AS shift_name " +
        "FROM employee_registry r LEFT JOIN shift_config s ON r.shift_id = s.id";
```

2. Add `accruesOvertime` to `toEmployeeDto` (after line 185 `dto.put("active", row.get("ACTIVE"));`):

```java
        dto.put("accruesOvertime", row.get("ACCRUES_OVERTIME"));
```

3. Add the new method near `setActive` (after line 119):

```java
    public Map<String, Object> setAccruesOvertime(String employeeId, boolean accruesOvertime) {
        jdbc.update(
            "UPDATE employee_registry SET accrues_overtime = ? WHERE employee_id = ?",
            accruesOvertime, employeeId
        );
        return getById(employeeId);
    }
```

- [ ] **Step 5: Run the test again**

Run: `cd backend && mvn -q -Dtest=EmployeeRegistryServiceTest test`
Expected: PASS — new test passes, and existing tests still pass (they may need their `rowMap`/inline maps updated to include `ACCRUES_OVERTIME` if `toEmployeeDto` is exercised — check failures and add `row.put("ACCRUES_OVERTIME", true)` to any existing row-map fixtures that hit `toEmployeeDto`).

- [ ] **Step 6: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add backend/src/main/java/com/planilla/backend/service/tas/EmployeeRegistryService.java backend/src/test/java/com/planilla/backend/service/tas/EmployeeRegistryServiceTest.java
git commit -m "Add accruesOvertime get/set to EmployeeRegistryService"
```

---

### Task 5: `EmployeeRegistryController` — PATCH endpoint for `accruesOvertime`

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/controller/EmployeeRegistryController.java`
- Test: `backend/src/test/java/com/planilla/backend/controller/EmployeeRegistryControllerTest.java`

- [ ] **Step 1: Write a failing controller test**

Add to `EmployeeRegistryControllerTest.java`:

```java
    @Test
    void updateAccruesOvertime_callsServiceAndReturnsUpdatedEmployee() {
        Map<String, Object> updated = new LinkedHashMap<>();
        updated.put("id", "100");
        updated.put("accruesOvertime", false);
        when(employeeRegistryService.setAccruesOvertime("100", false)).thenReturn(updated);

        ResponseEntity<?> response = controller.updateAccruesOvertime("100", Map.of("accruesOvertime", false));

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEqualTo(updated);
    }

    @Test
    void updateAccruesOvertime_notFound_returns404() {
        when(employeeRegistryService.setAccruesOvertime("999", true)).thenReturn(null);

        ResponseEntity<?> response = controller.updateAccruesOvertime("999", Map.of("accruesOvertime", true));

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }
```

(Check the existing test file's imports/setup for `employeeRegistryService` mock and `controller` instance naming — match those exactly.)

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && mvn -q -Dtest=EmployeeRegistryControllerTest test`
Expected: FAIL — compile error, `updateAccruesOvertime` doesn't exist on `EmployeeRegistryController`.

- [ ] **Step 3: Implement the endpoint**

In `EmployeeRegistryController.java`, add after the `deactivate` method (after line 80):

```java
    @PatchMapping("/{id}/accrues-overtime")
    public ResponseEntity<?> updateAccruesOvertime(@PathVariable String id, @RequestBody Map<String, Object> body) {
        Object value = body.get("accruesOvertime");
        if (!(value instanceof Boolean)) {
            return ResponseEntity.badRequest().body(error(400, "MISSING_FIELD", "accruesOvertime is required"));
        }
        Map<String, Object> updated = employeeRegistryService.setAccruesOvertime(id, (Boolean) value);
        if (updated == null) {
            return ResponseEntity.status(404).body(error(404, "EMPLOYEE_NOT_FOUND", "Employee not found"));
        }
        return ResponseEntity.ok(updated);
    }
```

- [ ] **Step 4: Run tests**

Run: `cd backend && mvn -q -Dtest=EmployeeRegistryControllerTest test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add backend/src/main/java/com/planilla/backend/controller/EmployeeRegistryController.java backend/src/test/java/com/planilla/backend/controller/EmployeeRegistryControllerTest.java
git commit -m "Add PATCH endpoint to toggle employee accruesOvertime flag"
```

---

### Task 6: `EmployeeRow` — add `accruesOvertime` field

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/model/EmployeeRow.java`

- [ ] **Step 1: Add the field and accessors**

In `EmployeeRow.java`, add a field (after `diasTurnoAmbiguo`, line 13):

```java
    private boolean accruesOvertime = true;
```

And accessors (after line 42):

```java
    public boolean isAccruesOvertime() { return accruesOvertime; }
    public void setAccruesOvertime(boolean accruesOvertime) { this.accruesOvertime = accruesOvertime; }
```

- [ ] **Step 2: Compile to confirm no breakage**

Run: `cd backend && mvn -q -Dtest=EmployeeRowTest test 2>/dev/null || mvn -q compile`
Expected: compiles cleanly. (Defaulting to `true` keeps all existing tests/usages valid since they don't set this field.)

- [ ] **Step 3: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add backend/src/main/java/com/planilla/backend/model/EmployeeRow.java
git commit -m "Add accruesOvertime field to EmployeeRow"
```

---

### Task 7: `TasReportBuilder` — zero out hours for non-accruing employees

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasReportBuilder.java`
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasReportBuilderTest.java`
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasAmbiguousShiftPipelineTest.java`

- [ ] **Step 1: Write a failing test for the exemption**

Add to `TasReportBuilderTest.java`:

```java
    @Test
    void build_employeeDoesNotAccrueOvertime_zeroesSimplesAndDobles() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        when(employeeRegistryService.isAccruesOvertime("100")).thenReturn(false);

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 60)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        assertThat(result.rows).hasSize(1);
        EmployeeRow row = result.rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isEqualTo(0);
        assertThat(row.getHorasExtrasDobles()).isEqualTo(0);
        assertThat(row.isAccruesOvertime()).isFalse();
    }

    @Test
    void build_employeeAccruesOvertime_keepsComputedHours() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        when(employeeRegistryService.isAccruesOvertime("100")).thenReturn(true);

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 60)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        EmployeeRow row = result.rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isEqualTo(8);
        assertThat(row.getHorasExtrasDobles()).isEqualTo(1);
        assertThat(row.isAccruesOvertime()).isTrue();
    }
```

Add the mock declaration near the top of the test class (alongside `@Mock HolidayService holidayService;`):

```java
    @Mock EmployeeRegistryService employeeRegistryService;
```

And update the constructor call in `setUp()` (line 32):

```java
        builder = new TasReportBuilder(holidayService, employeeRegistryService);
        lenient().when(employeeRegistryService.isAccruesOvertime(any())).thenReturn(true);
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && mvn -q -Dtest=TasReportBuilderTest test`
Expected: FAIL — compile errors (`TasReportBuilder(HolidayService, EmployeeRegistryService)` constructor and `isAccruesOvertime` don't exist).

- [ ] **Step 3: Add `isAccruesOvertime` to `EmployeeRegistryService`**

In `EmployeeRegistryService.java`, add a lightweight lookup (near `isNewEmployee`, after line 127):

```java
    public boolean isAccruesOvertime(String employeeId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT accrues_overtime FROM employee_registry WHERE employee_id = ?", employeeId
        );
        if (rows.isEmpty()) return true;
        Object value = rows.get(0).get("ACCRUES_OVERTIME");
        if (value == null) value = rows.get(0).get("accrues_overtime");
        return !(value instanceof Boolean) || (Boolean) value;
    }
```

- [ ] **Step 4: Update `TasReportBuilder` constructor and zeroing logic**

In `TasReportBuilder.java`:

1. Add the field and update the constructor (lines 17-21):

```java
    private final HolidayService holidayService;
    private final EmployeeRegistryService employeeRegistryService;

    public TasReportBuilder(HolidayService holidayService, EmployeeRegistryService employeeRegistryService) {
        this.holidayService = holidayService;
        this.employeeRegistryService = employeeRegistryService;
    }
```

2. In the row-building loop, after `row.setDiasTurnoAmbiguo(diasTurnoAmbiguo);` (line 116), add:

```java
                boolean accruesOvertime = employeeRegistryService.isAccruesOvertime(empId);
                row.setAccruesOvertime(accruesOvertime);
                if (!accruesOvertime) {
                    row.setHorasExtrasSimples(0);
                    row.setHorasExtrasDobles(0);
                }
```

- [ ] **Step 5: Fix other constructor call sites**

In `TasAmbiguousShiftPipelineTest.java:43`, change:
```java
        reportBuilder = new TasReportBuilder(holidayService);
```
to:
```java
        reportBuilder = new TasReportBuilder(holidayService, employeeRegistryService);
```

Add `@Mock EmployeeRegistryService employeeRegistryService;` to that test class if not present, and stub `lenient().when(employeeRegistryService.isAccruesOvertime(any())).thenReturn(true);` in its `setUp()`.

- [ ] **Step 6: Run the full report-builder and pipeline test suites**

Run: `cd backend && mvn -q -Dtest=TasReportBuilderTest,TasAmbiguousShiftPipelineTest test`
Expected: PASS for all tests.

- [ ] **Step 7: Run the full backend test suite to catch any other breakages (e.g. `TasUploadServiceTest`, `TasControllerTest` autowiring `TasReportBuilder`)**

Run: `cd backend && mvn -q test`
Expected: PASS. If a Spring context test fails to wire `TasReportBuilder`, confirm `EmployeeRegistryService` is itself a `@Service` (it already is) so Spring can autowire the new constructor param automatically.

- [ ] **Step 8: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add backend/src/main/java/com/planilla/backend/service/tas/TasReportBuilder.java backend/src/main/java/com/planilla/backend/service/tas/EmployeeRegistryService.java backend/src/test/java/com/planilla/backend/service/tas/TasReportBuilderTest.java backend/src/test/java/com/planilla/backend/service/tas/TasAmbiguousShiftPipelineTest.java
git commit -m "Zero out horas_extras_simples/dobles for employees that do not accrue overtime"
```

---

### Task 8: `TasController` — recompute endpoint

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/controller/TasController.java`
- Test: `backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java`

- [ ] **Step 1: Read the existing `resolve` test for the state-store mocking pattern**

Run: `grep -n -B5 -A 30 "void resolve_" backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java | head -60`

This shows how `TasUploadState` is seeded into the controller's internal `stateStore` for tests (likely via reflection or a setup helper — match that pattern).

- [ ] **Step 2: Write a failing test for `recompute`**

Add to `TasControllerTest.java` (adapt the state-seeding to match the pattern found in Step 1):

```java
    @Test
    void recompute_rebuildsResolvedRowsFromCachedSessions() {
        String token = "tok-recompute";
        TasUploadState state = new TasUploadState();
        state.setUploadToken(token);
        state.setSessions(List.of());
        state.setReportStart(LocalDate.of(2026, 3, 1));
        state.setReportEnd(LocalDate.of(2026, 3, 15));
        seedState(token, state); // helper matching existing pattern, e.g. reflection into stateStore

        EmployeeRow recomputedRow = new EmployeeRow();
        recomputedRow.setCodigoEmpleado("100");
        when(reportBuilder.build(eq(state.getSessions()), eq(state.getReportStart()), eq(state.getReportEnd()), anyList(), isNull()))
            .thenReturn(new TasReportBuilder.BuildResult(List.of(recomputedRow), new LinkedHashMap<>()));

        ResponseEntity<?> response = controller.recompute(token);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        assertThat(body.get("resolvedRows")).isEqualTo(List.of(recomputedRow));
        assertThat(state.getResolvedRows()).isEqualTo(List.of(recomputedRow));
    }

    @Test
    void recompute_invalidToken_returns400() {
        ResponseEntity<?> response = controller.recompute("does-not-exist");
        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }
```

- [ ] **Step 3: Run to confirm it fails**

Run: `cd backend && mvn -q -Dtest=TasControllerTest test`
Expected: FAIL — `recompute` method doesn't exist on `TasController`.

- [ ] **Step 4: Implement the endpoint**

In `TasController.java`, add after the `submit` method (after line 239):

```java
    @PostMapping("/recompute/{uploadToken}")
    public ResponseEntity<?> recompute(@PathVariable String uploadToken) {
        TasUploadState state = stateStore.get(uploadToken);
        if (state == null) {
            return ResponseEntity.badRequest().body(Map.of("code", "INVALID_TOKEN", "message", "Token inválido."));
        }

        List<TasSession> sessions = state.getSessions();
        if (sessions == null) sessions = Collections.emptyList();

        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();

        TasReportBuilder.BuildResult buildResult = reportBuilder.build(
                sessions, state.getReportStart(), state.getReportEnd(), shifts, null);
        state.setResolvedRows(buildResult.rows);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("uploadToken", uploadToken);
        resp.put("resolvedRows", state.getResolvedRows());
        return ResponseEntity.ok(resp);
    }
```

- [ ] **Step 5: Run tests**

Run: `cd backend && mvn -q -Dtest=TasControllerTest test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add backend/src/main/java/com/planilla/backend/controller/TasController.java backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java
git commit -m "Add recompute endpoint to rebuild resolvedRows after employee flag changes"
```

---

### Task 9: Frontend — `configTypes`/`configApi` for `accruesOvertime`

**Files:**
- Modify: `frontend/src/configTypes.ts:9-16`
- Modify: `frontend/src/configApi.ts:26-27`
- Test: `frontend/src/configApi.test.ts` (if it exists — check first)

- [ ] **Step 1: Check for an existing configApi test file**

Run: `ls frontend/src/configApi.test.ts 2>/dev/null && grep -n "updateEmployee" frontend/src/configApi.test.ts`

- [ ] **Step 2: Add `accruesOvertime` to the `Employee` interface**

In `configTypes.ts`, update the `Employee` interface (lines 9-16):

```typescript
export interface Employee {
  id: string;
  code: string;
  name: string;
  shiftId: string | null;
  shiftName: string | null;
  active: boolean;
  accruesOvertime: boolean;
}
```

- [ ] **Step 3: Add `updateAccruesOvertime` to `configApi.ts`**

After `updateEmployee` (line 26-27):

```typescript
export const updateAccruesOvertime = (id: string, accruesOvertime: boolean): Promise<Employee> =>
  client.patch<Employee>(`/config/employees/${id}/accrues-overtime`, { accruesOvertime }).then(r => r.data);
```

- [ ] **Step 4: If a configApi test file exists with a pattern for `updateEmployee`, add a matching test for `updateAccruesOvertime`**

Following the existing pattern (mocked axios client), e.g.:

```typescript
it('updateAccruesOvertime calls PATCH with the flag', async () => {
  mockClient.patch.mockResolvedValue({ data: { id: '100', accruesOvertime: false } });
  const result = await updateAccruesOvertime('100', false);
  expect(mockClient.patch).toHaveBeenCalledWith('/config/employees/100/accrues-overtime', { accruesOvertime: false });
  expect(result.accruesOvertime).toBe(false);
});
```

- [ ] **Step 5: Run frontend tests**

Run: `cd frontend && npx vitest run configApi`
Expected: PASS (or no test file found, which is fine if none existed before).

- [ ] **Step 6: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add frontend/src/configTypes.ts frontend/src/configApi.ts frontend/src/configApi.test.ts 2>/dev/null
git commit -m "Add accruesOvertime to Employee type and config API"
```

---

### Task 10: Frontend — `EmployeesTab` toggle column

**Files:**
- Modify: `frontend/src/components/config/EmployeesTab.tsx`
- Modify: `frontend/src/components/config/EmployeesTab.test.tsx`

- [ ] **Step 1: Read the existing test file's pattern for the `active` toggle test**

Run: `grep -n -B5 -A 15 "Activar empleado\|Desactivar empleado" frontend/src/components/config/EmployeesTab.test.tsx`

- [ ] **Step 2: Write a failing test for the new toggle**

Following the pattern found in Step 1, add a test that:
1. Renders `EmployeesTab` with an employee that has `accruesOvertime: true`.
2. Finds a toggle with `aria-label` `"No acumula horas extra"` (when `accruesOvertime` is true, clicking turns it off) or `"Acumula horas extra"` (when false, clicking turns it on) — mirroring the active toggle's `aria-label` pattern at `EmployeesTab.tsx:245`.
3. Clicks it and asserts `updateAccruesOvertime` was called with `(emp.id, false)`.

Example (adapt employee fixture shape to match what the existing test file already uses for `getEmployees` mocks — just add `accruesOvertime: true` to each fixture):

```typescript
it('toggles accruesOvertime and calls updateAccruesOvertime', async () => {
  mockGetEmployees.mockResolvedValue([
    { id: '100', code: '100', name: 'Ana', shiftId: 'manana', shiftName: 'Manana', active: true, accruesOvertime: true },
  ]);
  mockUpdateAccruesOvertime.mockResolvedValue({ id: '100', code: '100', name: 'Ana', shiftId: 'manana', shiftName: 'Manana', active: true, accruesOvertime: false });

  render(<EmployeesTab />);
  await screen.findByText('Ana');

  fireEvent.click(screen.getByRole('switch', { name: /acumula horas extra/i }));

  await waitFor(() => expect(mockUpdateAccruesOvertime).toHaveBeenCalledWith('100', false));
});
```

Add `mockUpdateAccruesOvertime` to the file's existing `vi.mock('../../configApi', ...)` block, mirroring how `mockUpdateEmployee` is mocked.

- [ ] **Step 3: Run to confirm it fails**

Run: `cd frontend && npx vitest run EmployeesTab`
Expected: FAIL — no element matches `role: 'switch', name: /acumula horas extra/i`.

- [ ] **Step 4: Implement the toggle column**

In `EmployeesTab.tsx`:

1. Import `updateAccruesOvertime` (line 3):

```typescript
import { getEmployees, updateEmployee, updateAccruesOvertime, bulkAssignShift, getShifts } from '../../configApi';
```

2. Add a handler near `handleActiveToggle` (after line 92):

```typescript
  const handleAccruesOvertimeToggle = async (emp: Employee) => {
    const newValue = !emp.accruesOvertime;
    try {
      const updated = await updateAccruesOvertime(emp.id, newValue);
      setEmployeesData(employees.map(e => e.id === emp.id ? updated : e));
      showToast('Cambios guardados');
    } catch {
      setEmployeesError('No se pudo actualizar el indicador de horas extra.');
    }
  };
```

3. Add a header cell after `<th className="px-4 py-2 font-medium text-gray-700">Activo</th>` (line 211):

```tsx
                <th className="px-4 py-2 font-medium text-gray-700">Acumula horas extra</th>
```

4. Add a body cell after the `active` toggle `<td>` (after line 257, before the closing `</tr>`):

```tsx
                    <td className="px-4 py-2">
                      <button
                        role="switch"
                        aria-checked={emp.accruesOvertime}
                        aria-label={emp.accruesOvertime ? 'No acumula horas extra' : 'Acumula horas extra'}
                        onClick={() => handleAccruesOvertimeToggle(emp)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          emp.accruesOvertime ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            emp.accruesOvertime ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
```

5. Update the `colSpan={5}` on the reactivation note row (line 261) to `colSpan={6}` since there's now a 6th column.

- [ ] **Step 5: Run the test**

Run: `cd frontend && npx vitest run EmployeesTab`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add frontend/src/components/config/EmployeesTab.tsx frontend/src/components/config/EmployeesTab.test.tsx
git commit -m "Add 'Acumula horas extra' toggle to Config Employees tab"
```

---

### Task 11: Frontend — `tasTypes`/`tasApi` for `accruesOvertime` and recompute

**Files:**
- Modify: `frontend/src/tasTypes.ts:29-39`
- Modify: `frontend/src/tasApi.ts`

- [ ] **Step 1: Add `accruesOvertime` to `ResolvedRow`**

In `tasTypes.ts`, update the `ResolvedRow` interface (lines 29-39):

```typescript
export interface ResolvedRow {
  codigoEmpleado: string
  nombreEmpleado: string
  diasNoLaborados: number
  horasExtrasSimples: number
  horasExtrasDobles: number
  mes: number
  anio: number
  numeroDequincena: number | null
  diasTurnoAmbiguo: number
  accruesOvertime: boolean
}
```

- [ ] **Step 2: Add `recomputeTas` to `tasApi.ts`**

After `submitTas` (line 36-37):

```typescript
export const recomputeTas = (token: string): Promise<{ uploadToken: string; resolvedRows: ResolvedRow[] }> =>
  client.post<{ uploadToken: string; resolvedRows: ResolvedRow[] }>(`/tas/recompute/${token}`).then(r => r.data);
```

Confirm `ResolvedRow` is already imported in `tasApi.ts` (check the top of the file); if not, add the import.

- [ ] **Step 3: Run a quick typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new type errors. (Existing `ResolvedRow` literals in test files — e.g. `ReviewScreen.test.tsx` — will now be missing `accruesOvertime`; this is addressed in Task 12.)

- [ ] **Step 4: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add frontend/src/tasTypes.ts frontend/src/tasApi.ts
git commit -m "Add accruesOvertime to ResolvedRow and recomputeTas API call"
```

---

### Task 12: Frontend — `ReviewScreen` toggle column with recompute

**Files:**
- Modify: `frontend/src/components/tas/ReviewScreen.tsx`
- Modify: `frontend/src/components/tas/ReviewScreen.test.tsx`

- [ ] **Step 1: Update the test fixtures to include `accruesOvertime`**

In `ReviewScreen.test.tsx`, update the `rows` fixture (lines 12-15) to add `accruesOvertime: true` to each row:

```typescript
const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
];
```

- [ ] **Step 2: Run existing tests to confirm they still pass with the fixture update**

Run: `cd frontend && npx vitest run ReviewScreen`
Expected: PASS (fixture change alone shouldn't break anything yet).

- [ ] **Step 3: Write a failing test for the toggle + recompute flow**

Add to `ReviewScreen.test.tsx`:

```typescript
describe('ReviewScreen accruesOvertime toggle', () => {
  it('toggles the flag, calls updateAccruesOvertime then recomputeTas, and refreshes rows', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);

    mockUpdateAccruesOvertime.mockResolvedValue({ id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false });
    const recomputedRows: ResolvedRow[] = [
      { ...rows[0], horasExtrasSimples: 0, horasExtrasDobles: 0, accruesOvertime: false },
      rows[1],
    ];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: recomputedRows });

    render(<ReviewScreen />);

    fireEvent.click(screen.getAllByRole('switch', { name: /acumula horas extra/i })[0]);

    await waitFor(() => expect(mockUpdateAccruesOvertime).toHaveBeenCalledWith('E1', false));
    expect(mockRecomputeTas).toHaveBeenCalledWith('tok-1');
    await waitFor(() => expect(useTasStore.getState().resolvedRows).toEqual(recomputedRows));
  });

  it('reverts the toggle and shows an error if updateAccruesOvertime fails', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    mockUpdateAccruesOvertime.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch', { name: /acumula horas extra/i })[0]);

    await waitFor(() => expect(useTasStore.getState().error).not.toBeNull());
    expect(mockRecomputeTas).not.toHaveBeenCalled();
    expect(useTasStore.getState().resolvedRows).toEqual(rows);
  });
});
```

Add the necessary mocks at the top of the file alongside `vi.mock('../../tasApi')` and `vi.mock('../../configApi')`:

```typescript
import * as configApi from '../../configApi';
vi.mock('../../configApi');

const mockUpdateAccruesOvertime = vi.mocked(configApi.updateAccruesOvertime);
const mockRecomputeTas = vi.mocked(tasApi.recomputeTas);
```

- [ ] **Step 4: Run to confirm the new tests fail**

Run: `cd frontend && npx vitest run ReviewScreen`
Expected: FAIL — no `role: 'switch', name: /acumula horas extra/i` elements exist yet in `ReviewScreen`.

- [ ] **Step 5: Implement the toggle column in `ReviewScreen.tsx`**

Rewrite `ReviewScreen.tsx`:

```tsx
import { useState } from 'react';
import { useTasStore } from '../../tasStore';
import { submitTas, recomputeTas } from '../../tasApi';
import { updateAccruesOvertime } from '../../configApi';

export default function ReviewScreen() {
  const uploadToken  = useTasStore(s => s.uploadToken);
  const resolvedRows = useTasStore(s => s.resolvedRows);
  const setResolvedRows = useTasStore(s => s.setResolvedRows);
  const setTasView   = useTasStore(s => s.setTasView);
  const setJobId     = useTasStore(s => s.setJobId);
  const setError     = useTasStore(s => s.setError);

  const [pendingToggle, setPendingToggle] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!uploadToken) return;
    try {
      setTasView('submitting');
      const { jobId } = await submitTas(uploadToken);
      setJobId(jobId);
      setTasView('result');
    } catch {
      setTasView('review');
      setError('Ocurrió un error al enviar. Intente nuevamente.');
    }
  };

  const handleAccruesOvertimeToggle = async (row: typeof resolvedRows[number]) => {
    if (!uploadToken) return;
    const newValue = !row.accruesOvertime;
    setPendingToggle(row.codigoEmpleado);
    try {
      await updateAccruesOvertime(row.codigoEmpleado, newValue);
      const { resolvedRows: refreshed } = await recomputeTas(uploadToken);
      setResolvedRows(refreshed);
    } catch {
      setError('No se pudo actualizar el indicador de horas extra.');
    } finally {
      setPendingToggle(null);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div className="flex-1 overflow-auto px-6 py-6">
        <h2 className="text-headline-sm font-medium text-on-surface mb-2">
          Revisión de registros procesados
        </h2>
        <p className="text-body-md text-on-surface-variant mb-6">
          {resolvedRows.length === 1
            ? 'Se procesó 1 registro. Revisa la información antes de enviar.'
            : `Se procesaron ${resolvedRows.length} registros. Revisa la información antes de enviar.`}
        </p>

        <table className="w-full border-collapse bg-white rounded-shape-md overflow-hidden shadow-sm">
          <thead>
            <tr className="border-b border-outline-variant">
              <th className="text-left text-label-lg text-on-surface-variant py-2 px-4">Empleado</th>
              <th className="text-left text-label-lg text-on-surface-variant py-2 px-4">Código</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Días no laborados</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Horas extras simples</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Horas extras dobles</th>
              <th className="text-center text-label-lg text-on-surface-variant py-2 px-4">Acumula horas extra</th>
            </tr>
          </thead>
          <tbody>
            {resolvedRows.map(row => (
              <tr key={`${row.codigoEmpleado}-${row.anio}-${row.mes}-${row.numeroDequincena}`} className="border-b border-outline-variant last:border-b-0">
                <td className="py-3 px-4 text-body-md text-on-surface">
                  {row.nombreEmpleado}
                  {row.diasTurnoAmbiguo > 0 && (
                    <span
                      title={`${row.diasTurnoAmbiguo} día(s) en que las marcaciones no coincidieron con ningún turno configurado. Se calcularon con base en las marcaciones reales (turno de 8h por defecto).`}
                      className="ml-2 text-label-sm px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                    >
                      {row.diasTurnoAmbiguo} sin turno
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-body-md text-on-surface-variant">{row.codigoEmpleado}</td>
                <td className="py-3 px-4 text-body-md text-on-surface-variant text-right">{row.diasNoLaborados}</td>
                <td className="py-3 px-4 text-body-md text-on-surface-variant text-right">{row.horasExtrasSimples}</td>
                <td className="py-3 px-4 text-body-md text-on-surface-variant text-right">{row.horasExtrasDobles}</td>
                <td className="py-3 px-4 text-center">
                  <button
                    role="switch"
                    aria-checked={row.accruesOvertime}
                    aria-label={row.accruesOvertime ? 'No acumula horas extra' : 'Acumula horas extra'}
                    disabled={pendingToggle === row.codigoEmpleado}
                    onClick={() => handleAccruesOvertimeToggle(row)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${
                      row.accruesOvertime ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        row.accruesOvertime ? 'translate-x-4' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-outline-variant px-6 py-4 flex justify-end">
        <button onClick={handleSubmit} className="m3-btn-filled">
          Enviar
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npx vitest run ReviewScreen`
Expected: PASS.

- [ ] **Step 7: Run full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add frontend/src/components/tas/ReviewScreen.tsx frontend/src/components/tas/ReviewScreen.test.tsx
git commit -m "Add accruesOvertime toggle to TAS review screen with recompute on change"
```

---

### Task 13: Documentation updates

**Files:**
- Modify: `docs/tas_shift_rules.md`

- [ ] **Step 1: Rewrite "Weekly Hours: Simples vs. Dobles"**

Find the section starting at line 212 ("## Weekly Hours: Simples vs. Dobles **[CONFIRMED]**") and replace its content (lines 212-220) with:

```markdown
## Weekly Hours: Simples vs. Dobles **[CONFIRMED]**

Both `horas_extras_simples` and `horas_extras_dobles` are **overtime-only** fields — regular (non-overtime) worked hours are not reported to the SP at all.

- **`horas_extras_simples`**: overtime hours worked **Mon-Sat (non-holiday), beyond the employee's assigned shift duration**.
- **`horas_extras_dobles`**: **all** hours worked on **Sundays** and **public holidays** (the full session, not just the portion beyond shift duration).

**Cross-midnight sessions spanning a Sunday/holiday boundary** (e.g. a night shift starting Saturday and ending Sunday, or starting Sunday and ending Monday) are split at midnight:
- The portion of worked minutes on the Sunday/holiday calendar date counts in full toward `horas_extras_dobles`.
- The remaining portion (on the normal day) is classified using the Mon-Sat overtime-only rule above.

The 44h/week cumulative threshold does **not** apply — overtime is determined per-day based on the shift's expected duration, not weekly accumulation.

### Overtime Exemption

Some employees are contractually required to work longer shifts but do not accrue overtime (due to contract/hierarchical position). Each employee has an `accruesOvertime` flag (default: `true`):

- When `false`, both `horas_extras_simples` and `horas_extras_dobles` are reported as `0` for that employee, regardless of hours actually worked (including Sundays/holidays).
- Configurable from **Config → Empleados** (Tab 2) via a toggle, same interaction pattern as the `active` toggle.
- Also shown and editable on the **Revisión de registros procesados** (Review) screen, visible for every employee on every report. Toggling it there updates the persisted employee record and immediately recomputes that report's `resolvedRows`.
```

- [ ] **Step 2: Remove the TASK-33 forward-reference note in "Worked Hours per Session"**

Find the paragraph in the "Worked Hours per Session" section (around line 182) containing: *"**Note**: this 8h default is shared with TASK-33's planned overtime-rules redesign..."*. Remove that sentence (keep the rest of the paragraph about `AMBIGUOUS_SHIFT` sessions and the 8h default duration, since that behavior is unchanged).

- [ ] **Step 3: Commit**

```bash
cd /Users/andysapper/Documents/Repos/planilla-lito
git add docs/tas_shift_rules.md
git commit -m "Update TAS shift rules doc for overtime redesign (TASK-33)"
```

---

### Task 14: Final verification and PR

**Files:** none (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && mvn -q test`
Expected: PASS, ~99% instruction coverage maintained (check `mvn -q jacoco:report` / `target/site/jacoco/index.html` if coverage gate is enforced).

- [ ] **Step 2: Run full frontend test suite with coverage**

Run: `cd frontend && npx vitest run --coverage`
Expected: PASS, ~100% coverage maintained.

- [ ] **Step 3: Manual smoke test (per CLAUDE.md PR template requirement for UI changes)**

Start backend and frontend dev servers, upload a TAS file with at least one employee, on the Review screen toggle "Acumula horas extra" off for one employee and confirm `horas_extras_simples`/`horas_extras_dobles` immediately become `0` in the table; toggle back on and confirm the original values reappear. Then check Config → Empleados shows the same toggle state for that employee.

- [ ] **Step 4: Open PR**

Per `CLAUDE.md`: push the `feature/tas-overtime-rules-redesign` branch and open a PR targeting `master` using the PR template (Summary / Test plan / 🤖 Generated with Claude Code). Do not merge — leave that to Andy.
