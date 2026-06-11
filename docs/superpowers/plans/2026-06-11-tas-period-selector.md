# TAS Period Selector (Verification Screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick one quincena/month at the verification step when a TAS upload spans multiple periods, so "Enviar" only requires resolving that period's flagged sessions and `resolvedRows` ends up with one row per employee.

**Architecture:** Add a `TasPeriod(anio, mes, numeroDequincena)` record shared by backend and frontend. `TasReportBuilder.build()` is refactored to group by `TasPeriod` (fixing a multi-month grouping bug) and gains an optional `periodFilter` parameter plus a `computeAvailablePeriods()` helper. The controller exposes `availablePeriods` on `/upload`, `/inactive-review`, and `/resolve`, and `/resolve` accepts `anio`/`mes`/`numeroDequincena` to scope `resolvedRows`. The frontend store tracks `availablePeriods`/`selectedPeriod`; `VerificationScreen` shows a dropdown (when >1 period), filters sessions by period, relaxes its "all confirmed" gate, and sends the selected period on submit. `App.tsx`/`ReactivationReviewScreen.tsx` route to verification whenever there's something to resolve OR more than one period.

**Tech Stack:** Spring Boot (Java 17 records), JUnit 5 + AssertJ + Mockito, React + TypeScript, Vitest + Testing Library, Zustand.

---

## Spec reference

`docs/superpowers/specs/2026-06-11-tas-period-selector-design.md`

## File map

- Create: `backend/src/main/java/com/planilla/backend/model/tas/TasPeriod.java`
- Create: `backend/src/test/java/com/planilla/backend/model/tas/TasPeriodTest.java`
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasReportBuilder.java`
- Modify: `backend/src/test/java/com/planilla/backend/service/tas/TasReportBuilderTest.java`
- Modify: `backend/src/main/java/com/planilla/backend/controller/TasController.java`
- Modify: `backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java`
- Modify: `frontend/src/tasTypes.ts`
- Create: `frontend/src/dateNames.ts`
- Modify: `frontend/src/components/config/HolidaysTab.tsx`
- Modify: `frontend/src/tasStore.ts`
- Modify: `frontend/src/tasStore.test.ts`
- Modify: `frontend/src/tasApi.ts`
- Modify: `frontend/src/tasApi.test.ts`
- Modify: `frontend/src/components/tas/VerificationScreen.tsx`
- Modify: `frontend/src/components/tas/VerificationScreen.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/components/tas/ReactivationReviewScreen.tsx`
- Modify: `frontend/src/components/tas/ReactivationReviewScreen.test.tsx`

---

## Task 1: `TasPeriod` record

**Files:**
- Create: `backend/src/main/java/com/planilla/backend/model/tas/TasPeriod.java`
- Test: `backend/src/test/java/com/planilla/backend/model/tas/TasPeriodTest.java`

- [ ] **Step 1: Write the failing test**

```java
package com.planilla.backend.model.tas;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class TasPeriodTest {

    @Test
    void of_dayInFirstHalf_returnsQuincenaOne() {
        TasPeriod period = TasPeriod.of(LocalDate.of(2026, 4, 15));
        assertThat(period).isEqualTo(new TasPeriod(2026, 4, 1));
    }

    @Test
    void of_dayInSecondHalf_returnsQuincenaTwo() {
        TasPeriod period = TasPeriod.of(LocalDate.of(2026, 4, 16));
        assertThat(period).isEqualTo(new TasPeriod(2026, 4, 2));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./mvnw test -Dtest=TasPeriodTest`
Expected: FAIL — compilation error, `TasPeriod` does not exist.

- [ ] **Step 3: Write the implementation**

```java
package com.planilla.backend.model.tas;

import java.time.LocalDate;

public record TasPeriod(int anio, int mes, int numeroDequincena) {
    public static TasPeriod of(LocalDate date) {
        return new TasPeriod(date.getYear(), date.getMonthValue(),
                date.getDayOfMonth() <= 15 ? 1 : 2);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./mvnw test -Dtest=TasPeriodTest`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/model/tas/TasPeriod.java backend/src/test/java/com/planilla/backend/model/tas/TasPeriodTest.java
git commit -m "Add TasPeriod record for (anio, mes, numeroDequincena) grouping"
```

---

## Task 2: `TasReportBuilder` — group by `TasPeriod`, add `periodFilter`, add `computeAvailablePeriods`

This task fixes the existing multi-month grouping bug (currently grouped by quincena number `1`/`2` only, ignoring year/month) and adds the period-scoped build used by `/resolve`.

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasReportBuilder.java`
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasReportBuilderTest.java`

- [ ] **Step 1: Write the failing tests**

Add `import com.planilla.backend.model.tas.TasPeriod;` to the top of `TasReportBuilderTest.java` (after the existing `TasSession` import), then append these three tests at the end of the class, just before the final closing `}`:

```java
    @Test
    void build_multiMonthFile_groupsByYearMonthQuincena() {
        LocalDate start = LocalDate.of(2026, 4, 16);
        LocalDate end   = LocalDate.of(2026, 5, 15);

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 4, 20), 480, 0),
            resolvedSession("100", LocalDate.of(2026, 5, 5), 480, 0)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        assertThat(result.rows).hasSize(2);
        EmployeeRow aprilRow = result.rows.stream().filter(r -> r.getMes() == 4).findFirst().orElseThrow();
        EmployeeRow mayRow   = result.rows.stream().filter(r -> r.getMes() == 5).findFirst().orElseThrow();
        assertThat(aprilRow.getAnio()).isEqualTo(2026);
        assertThat(aprilRow.getNumeroDequincena()).isEqualTo(2);
        assertThat(mayRow.getAnio()).isEqualTo(2026);
        assertThat(mayRow.getNumeroDequincena()).isEqualTo(1);
    }

    @Test
    void build_periodFilter_onlyMatchingPeriodReturned() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 31);

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0),
            resolvedSession("100", LocalDate.of(2026, 3, 20), 480, 0)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts, new TasPeriod(2026, 3, 1));

        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getNumeroDequincena()).isEqualTo(1);
    }

    @Test
    void computeAvailablePeriods_returnsDistinctSortedPeriods() {
        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 4, 20), 480, 0),
            resolvedSession("100", LocalDate.of(2026, 4, 21), 480, 0),
            resolvedSession("100", LocalDate.of(2026, 5, 5), 480, 0)
        );

        List<TasPeriod> periods = builder.computeAvailablePeriods(sessions);

        assertThat(periods).containsExactly(
            new TasPeriod(2026, 4, 2),
            new TasPeriod(2026, 5, 1)
        );
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./mvnw test -Dtest=TasReportBuilderTest`
Expected: FAIL — compilation errors (`build(sessions, start, end, shifts, periodFilter)` and `computeAvailablePeriods` don't exist yet), and `build_multiMonthFile_groupsByYearMonthQuincena` would fail on current logic anyway (wrong `mes`/`anio` for the second quincena).

- [ ] **Step 3: Rewrite `TasReportBuilder.java`**

Replace the entire file content with:

```java
package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasPeriod;
import com.planilla.backend.model.tas.TasSession;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class TasReportBuilder {

    private final HolidayService holidayService;

    public TasReportBuilder(HolidayService holidayService) {
        this.holidayService = holidayService;
    }

    public BuildResult build(
            List<TasSession> sessions,
            LocalDate reportStart,
            LocalDate reportEnd,
            List<Map<String, Object>> shifts) {
        return build(sessions, reportStart, reportEnd, shifts, null);
    }

    public BuildResult build(
            List<TasSession> sessions,
            LocalDate reportStart,
            LocalDate reportEnd,
            List<Map<String, Object>> shifts,
            TasPeriod periodFilter) {

        List<TasSession> filteredSessions = periodFilter == null
                ? sessions
                : sessions.stream()
                        .filter(s -> TasPeriod.of(s.getDate()).equals(periodFilter))
                        .collect(Collectors.toList());

        Map<String, Set<LocalDate>> workedDaysByEmployee = new LinkedHashMap<>();
        Map<String, Map<TasPeriod, int[]>> minutesByEmployeePeriod = new LinkedHashMap<>();
        Map<String, Map<TasPeriod, Set<LocalDate>>> ambiguousDaysByEmpPeriod = new LinkedHashMap<>();

        for (TasSession session : filteredSessions) {
            String empId = session.getEmployeeId();
            TasPeriod period = TasPeriod.of(session.getDate());

            workedDaysByEmployee
                    .computeIfAbsent(empId, k -> new HashSet<>())
                    .add(session.getDate());

            int[] minutes = minutesByEmployeePeriod
                    .computeIfAbsent(empId, k -> new LinkedHashMap<>())
                    .computeIfAbsent(period, k -> new int[2]);

            if (!session.isNeedsResolution()) {
                minutes[0] += session.getSimplesMinutes();
                minutes[1] += session.getDoblesMinutes();
            }

            if (session.getFlags() != null && session.getFlags().contains(TasFlag.AMBIGUOUS_SHIFT)) {
                ambiguousDaysByEmpPeriod
                        .computeIfAbsent(empId, k -> new LinkedHashMap<>())
                        .computeIfAbsent(period, k -> new HashSet<>())
                        .add(session.getDate());
            }
        }

        Map<String, String> employeeNamesFromScans = buildEmployeeNamesMap(filteredSessions);
        Map<String, String> consistentMismatchShiftIds = detectConsistentMismatches(filteredSessions);

        List<EmployeeRow> rows = new ArrayList<>();

        for (Map.Entry<String, Map<TasPeriod, int[]>> empEntry : minutesByEmployeePeriod.entrySet()) {
            String empId = empEntry.getKey();
            String empName = employeeNamesFromScans.getOrDefault(empId, "");
            Set<LocalDate> workedDays = workedDaysByEmployee.getOrDefault(empId, new HashSet<>());

            for (Map.Entry<TasPeriod, int[]> pEntry : empEntry.getValue().entrySet()) {
                TasPeriod period = pEntry.getKey();
                int[] minutes = pEntry.getValue();

                int simplesHours = (int) Math.round(Math.floor(minutes[0] / 30.0) / 2.0);
                int doblesHours  = (int) Math.round(Math.floor(minutes[1] / 30.0) / 2.0);

                LocalDate qStart = period.numeroDequincena() == 1
                        ? LocalDate.of(period.anio(), period.mes(), 1)
                        : LocalDate.of(period.anio(), period.mes(), 16);
                LocalDate qEnd = period.numeroDequincena() == 1
                        ? LocalDate.of(period.anio(), period.mes(), 15)
                        : qStart.withDayOfMonth(qStart.lengthOfMonth());

                if (qStart.isBefore(reportStart)) qStart = reportStart;
                if (qEnd.isAfter(reportEnd)) qEnd = reportEnd;

                int nonWorkedDays = countNonWorkedDays(qStart, qEnd, workedDays);

                EmployeeRow row = new EmployeeRow();
                row.setCodigoEmpleado(empId);
                row.setNombreEmpleado(empName);
                row.setHorasExtrasSimples(simplesHours);
                row.setHorasExtrasDobles(doblesHours);
                row.setDiasNoLaborados(nonWorkedDays);
                row.setMes(period.mes());
                row.setAnio(period.anio());
                row.setNumeroDequincena(period.numeroDequincena());

                int diasTurnoAmbiguo = ambiguousDaysByEmpPeriod
                        .getOrDefault(empId, Map.of())
                        .getOrDefault(period, Set.of())
                        .size();
                row.setDiasTurnoAmbiguo(diasTurnoAmbiguo);

                rows.add(row);
            }
        }

        return new BuildResult(rows, consistentMismatchShiftIds);
    }

    public List<TasPeriod> computeAvailablePeriods(List<TasSession> sessions) {
        return sessions.stream()
                .map(s -> TasPeriod.of(s.getDate()))
                .distinct()
                .sorted(Comparator.comparingInt(TasPeriod::anio)
                        .thenComparingInt(TasPeriod::mes)
                        .thenComparingInt(TasPeriod::numeroDequincena))
                .collect(Collectors.toList());
    }

    private int countNonWorkedDays(LocalDate start, LocalDate end, Set<LocalDate> workedDays) {
        int count = 0;
        LocalDate d = start;
        while (!d.isAfter(end)) {
            DayOfWeek dow = d.getDayOfWeek();
            if (dow != DayOfWeek.SUNDAY
                    && !holidayService.isHoliday(d)
                    && !workedDays.contains(d)) {
                count++;
            }
            d = d.plusDays(1);
        }
        return count;
    }

    private Map<String, String> buildEmployeeNamesMap(List<TasSession> sessions) {
        Map<String, String> names = new LinkedHashMap<>();
        for (TasSession session : sessions) {
            names.putIfAbsent(session.getEmployeeId(),
                    session.getEmployeeName() != null ? session.getEmployeeName() : "");
        }
        return names;
    }

    private Map<String, String> detectConsistentMismatches(List<TasSession> sessions) {
        Map<String, Map<TasPeriod, Set<String>>> mismatchShiftsByEmpPeriod = new LinkedHashMap<>();
        Map<String, Integer> totalSessionsByEmpPeriod = new LinkedHashMap<>();
        Map<String, Integer> mismatchSessionsByEmpPeriod = new LinkedHashMap<>();

        for (TasSession session : sessions) {
            String empId  = session.getEmployeeId();
            TasPeriod period = TasPeriod.of(session.getDate());
            String key = empId + ":" + period;

            totalSessionsByEmpPeriod.merge(key, 1, Integer::sum);

            if (session.getFlags() != null && session.getFlags().contains(TasFlag.SHIFT_MISMATCH)) {
                mismatchSessionsByEmpPeriod.merge(key, 1, Integer::sum);
                if (session.getMatchedShiftId() != null) {
                    mismatchShiftsByEmpPeriod
                            .computeIfAbsent(empId, k -> new LinkedHashMap<>())
                            .computeIfAbsent(period, k -> new HashSet<>())
                            .add(session.getMatchedShiftId());
                }
            }
        }

        Map<String, String> result = new LinkedHashMap<>();

        for (Map.Entry<String, Map<TasPeriod, Set<String>>> empEntry : mismatchShiftsByEmpPeriod.entrySet()) {
            String empId = empEntry.getKey();
            for (Map.Entry<TasPeriod, Set<String>> pEntry : empEntry.getValue().entrySet()) {
                TasPeriod period = pEntry.getKey();
                Set<String> altShifts = pEntry.getValue();
                if (altShifts.size() != 1) continue;

                String key = empId + ":" + period;
                int total      = totalSessionsByEmpPeriod.getOrDefault(key, 0);
                int mismatched = mismatchSessionsByEmpPeriod.getOrDefault(key, 0);

                if (total > 0 && total == mismatched) {
                    result.put(empId, altShifts.iterator().next());
                }
            }
        }

        return result;
    }

    public static class BuildResult {
        public final List<EmployeeRow> rows;
        public final Map<String, String> consistentMismatchShiftIds;

        public BuildResult(List<EmployeeRow> rows, Map<String, String> consistentMismatchShiftIds) {
            this.rows                      = rows;
            this.consistentMismatchShiftIds = consistentMismatchShiftIds;
        }
    }
}
```

Note: `detectConsistentMismatches` previously only added a shift to `mismatchShiftsByEmpQuincena` when `getMatchedShiftId() != null`, but always incremented `mismatchSessionsByEmpQuincena` regardless — this rewrite preserves that exact behavior (the `if (session.getMatchedShiftId() != null)` guard wraps only the shift-set insertion, not the counter).

- [ ] **Step 4: Run all TasReportBuilder tests to verify they pass**

Run: `cd backend && ./mvnw test -Dtest=TasReportBuilderTest`
Expected: PASS (all existing tests + 3 new ones, 13 total)

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/service/tas/TasReportBuilder.java backend/src/test/java/com/planilla/backend/service/tas/TasReportBuilderTest.java
git commit -m "Group TasReportBuilder by (anio, mes, quincena) and add period filter/availablePeriods"
```

---

## Task 3: `TasController` — `availablePeriods` and period-scoped `/resolve`

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/controller/TasController.java`
- Test: `backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java`

- [ ] **Step 1: Write the failing tests**

Add `import com.planilla.backend.model.tas.TasPeriod;` to the imports of `TasControllerTest.java` (alongside the existing `TasSession`/`TasUploadResult` imports).

In the existing `resolve_validResolution_returns200WithUpdatedRows` test, change:

```java
        when(reportBuilder.build(any(), any(), any(), any())).thenReturn(buildResult);
```

to:

```java
        when(reportBuilder.build(any(), any(), any(), any(), any())).thenReturn(buildResult);
```

Then add these two new tests, e.g. right after `resolve_validResolution_returns200WithUpdatedRows`:

```java
    @Test
    void upload_includesAvailablePeriodsField() throws Exception {
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(emptyResult());

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.availablePeriods").isArray());
    }

    @Test
    void resolve_withPeriod_passesPeriodFilterToReportBuilder() throws Exception {
        TasSession flagged = new TasSession();
        flagged.setSessionId(42);
        flagged.setEmployeeId("100");
        flagged.setNeedsResolution(true);
        flagged.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.MISSING_EXIT)));

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
        resolution.put("resolvedStart", "2026-03-10 07:00");
        resolution.put("resolvedEnd", "2026-03-10 15:00");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of(resolution));
        body.put("anio", 2026);
        body.put("mes", 3);
        body.put("numeroDequincena", 1);

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.availablePeriods").isArray());

        verify(reportBuilder).build(any(), any(), any(), any(), eq(new TasPeriod(2026, 3, 1)));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./mvnw test -Dtest=TasControllerTest`
Expected: FAIL — `reportBuilder.build(any(), any(), any(), any(), any())` doesn't match the controller's current 4-arg call (returns null `BuildResult` → NPE on `state.setResolvedRows`/`buildResult.rows`), and `$.availablePeriods` is missing from both responses.

- [ ] **Step 3: Update `TasController.java`**

Add the import near the other `model.tas` imports (after line 6, `import com.planilla.backend.model.tas.TasUploadResult;`):

```java
import com.planilla.backend.model.tas.TasPeriod;
```

In `resolve()`, replace:

```java
        TasReportBuilder.BuildResult buildResult = reportBuilder.build(
                sessions, state.getReportStart(), state.getReportEnd(), shifts);
        state.setResolvedRows(buildResult.rows);

        List<TasSession> remainingFlagged = sessions.stream()
                .filter(TasSession::isNeedsResolution)
                .collect(Collectors.toList());

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("uploadToken", token);
        resp.put("resolvedRows", state.getResolvedRows());
        resp.put("flaggedSessions", remainingFlagged);
        resp.put("usedFallbackHolidays", state.isUsedFallbackHolidays());
        return ResponseEntity.ok(resp);
```

with:

```java
        TasPeriod periodFilter = null;
        Object anioObj = body.get("anio");
        Object mesObj = body.get("mes");
        Object numeroDequincenaObj = body.get("numeroDequincena");
        if (anioObj != null && mesObj != null && numeroDequincenaObj != null) {
            periodFilter = new TasPeriod(
                    ((Number) anioObj).intValue(),
                    ((Number) mesObj).intValue(),
                    ((Number) numeroDequincenaObj).intValue());
        }

        TasReportBuilder.BuildResult buildResult = reportBuilder.build(
                sessions, state.getReportStart(), state.getReportEnd(), shifts, periodFilter);
        state.setResolvedRows(buildResult.rows);

        List<TasSession> remainingFlagged = sessions.stream()
                .filter(TasSession::isNeedsResolution)
                .collect(Collectors.toList());

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("uploadToken", token);
        resp.put("resolvedRows", state.getResolvedRows());
        resp.put("flaggedSessions", remainingFlagged);
        resp.put("usedFallbackHolidays", state.isUsedFallbackHolidays());
        resp.put("availablePeriods", reportBuilder.computeAvailablePeriods(sessions));
        return ResponseEntity.ok(resp);
```

In `buildResponseBody()`, replace:

```java
    private Map<String, Object> buildResponseBody(String token, TasUploadResult result) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolvedRows", result.getResolvedRows());
        body.put("flaggedSessions", result.getFlaggedSessions());
        body.put("inactiveEmployeesFound", result.getInactiveEmployeesFound() != null
                ? result.getInactiveEmployeesFound()
                : Collections.emptyList());
        body.put("warnings", result.getWarnings());
        body.put("usedFallbackHolidays", result.isUsedFallbackHolidays());
        body.put("absentActiveEmployees", result.getAbsentActiveEmployees());
        return body;
    }
```

with:

```java
    private Map<String, Object> buildResponseBody(String token, TasUploadResult result) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolvedRows", result.getResolvedRows());
        body.put("flaggedSessions", result.getFlaggedSessions());
        body.put("inactiveEmployeesFound", result.getInactiveEmployeesFound() != null
                ? result.getInactiveEmployeesFound()
                : Collections.emptyList());
        body.put("warnings", result.getWarnings());
        body.put("usedFallbackHolidays", result.isUsedFallbackHolidays());
        body.put("absentActiveEmployees", result.getAbsentActiveEmployees());
        body.put("availablePeriods", reportBuilder.computeAvailablePeriods(
                result.getAllSessions() != null ? result.getAllSessions() : Collections.emptyList()));
        return body;
    }
```

- [ ] **Step 4: Run all controller tests to verify they pass**

Run: `cd backend && ./mvnw test -Dtest=TasControllerTest`
Expected: PASS (all existing tests + 2 new ones)

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && ./mvnw test`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/controller/TasController.java backend/src/test/java/com/planilla/backend/controller/TasControllerTest.java
git commit -m "Expose availablePeriods and accept period filter on /api/tas/resolve"
```

---

## Task 4: `tasTypes.ts` — `TasPeriod` and `availablePeriods`

**Files:**
- Modify: `frontend/src/tasTypes.ts`

- [ ] **Step 1: Add the `TasPeriod` interface and `availablePeriods` fields**

In `frontend/src/tasTypes.ts`, add after the `TasFlag` type (line 1):

```ts
export interface TasPeriod { anio: number; mes: number; numeroDequincena: number }
```

Then update `TasUploadResult` and `TasResolveResult` to add `availablePeriods: TasPeriod[]`:

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
}

export interface TasResolveResult {
  uploadToken: string
  resolvedRows?: ResolvedRow[]
  flaggedSessions: TasSession[]
  usedFallbackHolidays: boolean
  availablePeriods?: TasPeriod[]
}
```

`availablePeriods` is optional on these types so existing test fixtures (which omit it) keep type-checking.

- [ ] **Step 2: Run typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors — fields are optional, existing fixtures unaffected)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/tasTypes.ts
git commit -m "Add TasPeriod type and availablePeriods to TAS upload/resolve results"
```

---

## Task 5: Shared Spanish month names (`dateNames.ts`)

Extract the month-name array already used by `HolidaysTab.tsx` into a shared module so `VerificationScreen` can reuse it.

**Files:**
- Create: `frontend/src/dateNames.ts`
- Modify: `frontend/src/components/config/HolidaysTab.tsx`

- [ ] **Step 1: Create `frontend/src/dateNames.ts`**

```ts
export const MONTH_NAMES_ES = [
  '', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
```

- [ ] **Step 2: Update `HolidaysTab.tsx` to import it**

In `frontend/src/components/config/HolidaysTab.tsx`, replace:

```ts
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTH_NAMES_ES = [
  '', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
```

with:

```ts
import { MONTH_NAMES_ES } from '../../dateNames';

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
```

Place the new `import` with the other imports at the top of the file (after the existing imports), and keep `DAY_NAMES` where it was.

- [ ] **Step 3: Run HolidaysTab tests**

Run: `cd frontend && npx vitest run src/components/config/HolidaysTab.test.tsx`
Expected: PASS (no behavior change)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/dateNames.ts frontend/src/components/config/HolidaysTab.tsx
git commit -m "Extract shared Spanish month names into dateNames.ts"
```

---

## Task 6: `tasStore.ts` — `availablePeriods` / `selectedPeriod`

**Files:**
- Modify: `frontend/src/tasStore.ts`
- Test: `frontend/src/tasStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `TasPeriod` to the type import at the top of `frontend/src/tasStore.test.ts`:

```ts
import type { TasSession, InactiveEmployee, AbsentEmployee, TasPeriod } from './tasTypes';
```

Add a new `describe` block, e.g. after the `setResolvedRows` block:

```ts
// -----------------------------------------------------------------
// availablePeriods / selectedPeriod
// -----------------------------------------------------------------

describe('setAvailablePeriods', () => {
  it('starts with an empty availablePeriods and null selectedPeriod', () => {
    expect(useTasStore.getState().availablePeriods).toEqual([]);
    expect(useTasStore.getState().selectedPeriod).toBeNull();
  });

  it('stores periods and defaults selectedPeriod to the first one', () => {
    const periods: TasPeriod[] = [
      { anio: 2026, mes: 4, numeroDequincena: 1 },
      { anio: 2026, mes: 4, numeroDequincena: 2 },
    ];
    useTasStore.getState().setAvailablePeriods(periods);
    expect(useTasStore.getState().availablePeriods).toEqual(periods);
    expect(useTasStore.getState().selectedPeriod).toEqual(periods[0]);
  });

  it('keeps the current selectedPeriod if it is still in the new list', () => {
    const periods: TasPeriod[] = [
      { anio: 2026, mes: 4, numeroDequincena: 1 },
      { anio: 2026, mes: 4, numeroDequincena: 2 },
    ];
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[1]);

    useTasStore.getState().setAvailablePeriods(periods);
    expect(useTasStore.getState().selectedPeriod).toEqual(periods[1]);
  });

  it('falls back to the first period if the current selection is no longer present', () => {
    const periods: TasPeriod[] = [
      { anio: 2026, mes: 4, numeroDequincena: 1 },
      { anio: 2026, mes: 4, numeroDequincena: 2 },
    ];
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[1]);

    const newPeriods: TasPeriod[] = [{ anio: 2026, mes: 5, numeroDequincena: 1 }];
    useTasStore.getState().setAvailablePeriods(newPeriods);
    expect(useTasStore.getState().selectedPeriod).toEqual(newPeriods[0]);
  });

  it('sets selectedPeriod to null when the new list is empty', () => {
    useTasStore.getState().setAvailablePeriods([{ anio: 2026, mes: 4, numeroDequincena: 1 }]);
    useTasStore.getState().setAvailablePeriods([]);
    expect(useTasStore.getState().selectedPeriod).toBeNull();
  });
});

describe('setSelectedPeriod', () => {
  it('sets the selected period directly', () => {
    const period: TasPeriod = { anio: 2026, mes: 4, numeroDequincena: 2 };
    useTasStore.getState().setSelectedPeriod(period);
    expect(useTasStore.getState().selectedPeriod).toEqual(period);
  });
});
```

Also add `availablePeriods`/`selectedPeriod` assertions to the existing `resetTas` test: after calling `setAvailablePeriods([...])` and `setSelectedPeriod(...)` before `resetTas()`, and after `resetTas()` assert both reset:

```ts
    useTasStore.getState().setAvailablePeriods([{ anio: 2026, mes: 4, numeroDequincena: 1 }]);
```

(add this line alongside the other `useTasStore.getState().set...` calls before `useTasStore.getState().resetTas();`), and add to the post-reset assertions:

```ts
    expect(s.availablePeriods).toEqual([]);
    expect(s.selectedPeriod).toBeNull();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tasStore.test.ts`
Expected: FAIL — `setAvailablePeriods`/`setSelectedPeriod`/`availablePeriods`/`selectedPeriod` don't exist on the store.

- [ ] **Step 3: Update `tasStore.ts`**

Add `TasPeriod` to the type import:

```ts
import type { TasView, TasSession, InactiveEmployee, InactiveDecision, AbsentEmployee, ResolvedRow, TasPeriod } from './tasTypes';
```

Add to the `TasStore` interface (after `resolvedRows: ResolvedRow[];`):

```ts
  availablePeriods: TasPeriod[];
  selectedPeriod: TasPeriod | null;
```

and to the actions section (after `setResolvedRows: (rows: ResolvedRow[]) => void;`):

```ts
  setAvailablePeriods: (periods: TasPeriod[]) => void;
  setSelectedPeriod: (period: TasPeriod | null) => void;
```

Add to `initialState` (after `resolvedRows: [] as ResolvedRow[],`):

```ts
  availablePeriods: [] as TasPeriod[],
  selectedPeriod: null as TasPeriod | null,
```

Add the action implementations (after `setResolvedRows: (rows) => set({ resolvedRows: rows }),`):

```ts
  setAvailablePeriods: (periods) => set(s => {
    const stillValid = s.selectedPeriod !== null && periods.some(p =>
      p.anio === s.selectedPeriod!.anio &&
      p.mes === s.selectedPeriod!.mes &&
      p.numeroDequincena === s.selectedPeriod!.numeroDequincena);
    return {
      availablePeriods: periods,
      selectedPeriod: stillValid ? s.selectedPeriod : (periods[0] ?? null),
    };
  }),
  setSelectedPeriod: (period) => set({ selectedPeriod: period }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tasStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tasStore.ts frontend/src/tasStore.test.ts
git commit -m "Add availablePeriods/selectedPeriod to tasStore"
```

---

## Task 7: `tasApi.ts` — pass selected period to `/resolve`

**Files:**
- Modify: `frontend/src/tasApi.ts`
- Test: `frontend/src/tasApi.test.ts`

- [ ] **Step 1: Write the failing test**

In `frontend/src/tasApi.test.ts`, add `TasPeriod` to the type import:

```ts
import type { TasUploadResult, AbsentEmployee, TasPeriod } from './tasTypes';
```

Add a new test inside the `describe('resolveVerification', ...)` block:

```ts
  it('includes period fields in the body when a period is provided', async () => {
    mockPost.mockResolvedValue({ data: mockResult });
    const resolutions = [{ sessionId: 1, resolvedStart: '08:00', resolvedEnd: '17:00' }];
    const period: TasPeriod = { anio: 2026, mes: 4, numeroDequincena: 1 };
    await resolveVerification('tok-abc', resolutions, period);
    expect(mockPost).toHaveBeenCalledWith('/tas/resolve', {
      uploadToken: 'tok-abc',
      resolutions,
      anio: 2026,
      mes: 4,
      numeroDequincena: 1,
    });
  });
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `cd frontend && npx vitest run src/tasApi.test.ts`
Expected: FAIL — current `resolveVerification` signature has no third parameter and never sends `anio`/`mes`/`numeroDequincena`.

- [ ] **Step 3: Update `tasApi.ts`**

Add `TasPeriod` to the type import:

```ts
import type { TasUploadResult, TasResolveResult, AbsentEmployee, TasPeriod } from './tasTypes';
```

Replace `resolveVerification`:

```ts
export const resolveVerification = (
  token: string,
  resolutions: { sessionId: number; resolvedStart: string; resolvedEnd: string; updateShift?: boolean }[],
  period?: TasPeriod | null,
): Promise<TasResolveResult> =>
  client.post<TasResolveResult>('/tas/resolve', {
    uploadToken: token,
    resolutions,
    ...(period ? { anio: period.anio, mes: period.mes, numeroDequincena: period.numeroDequincena } : {}),
  }).then(r => r.data);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tasApi.test.ts`
Expected: PASS — including the existing `resolveVerification` test, since calling without a `period` produces a body identical to before (`{uploadToken, resolutions}`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tasApi.ts frontend/src/tasApi.test.ts
git commit -m "Send selected period to /api/tas/resolve"
```

---

## Task 8: `VerificationScreen.tsx` — period dropdown, filtering, gating, submit

**Files:**
- Modify: `frontend/src/components/tas/VerificationScreen.tsx`
- Test: `frontend/src/components/tas/VerificationScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add `TasPeriod` to the type import at the top of `VerificationScreen.test.tsx`:

```ts
import type { TasSession, TasResolveResult, TasPeriod } from '../../tasTypes';
```

Add a new `describe` block at the end of the file:

```ts
describe('VerificationScreen period selector', () => {
  const periods: TasPeriod[] = [
    { anio: 2026, mes: 3, numeroDequincena: 1 },
    { anio: 2026, mes: 3, numeroDequincena: 2 },
  ];

  it('does not render a period dropdown when only one period is available', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([periods[0]]);
    render(<VerificationScreen />);
    expect(screen.queryByLabelText(/periodo/i)).not.toBeInTheDocument();
  });

  it('renders a period dropdown with labeled options when multiple periods are available', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods(periods);
    render(<VerificationScreen />);
    expect(screen.getByText('Marzo 2026 - Quincena 1')).toBeInTheDocument();
    expect(screen.getByText('Marzo 2026 - Quincena 2')).toBeInTheDocument();
  });

  it('filters sessions by the selected period and updates on change', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeName: 'Ana', date: '2026-03-05' }),
      makeSession({ sessionId: 2, employeeName: 'Luis', employeeId: 'E2', date: '2026-03-20' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    render(<VerificationScreen />);

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Luis')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/periodo/i), { target: { value: '2026-3-2' } });

    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
    expect(screen.getByText('Luis')).toBeInTheDocument();
  });

  it('enables Enviar when there are no sessions to resolve in the selected period', () => {
    useTasStore.getState().setFlaggedSessions([]);
    useTasStore.getState().setAvailablePeriods(periods);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled();
  });

  it('renders the inline note about single-period submission', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    render(<VerificationScreen />);
    expect(screen.getByText(/Solo se enviará el periodo seleccionado/i)).toBeInTheDocument();
  });

  it('includes the selected period in the resolveVerification payload', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([
      makeSession({ effectiveStart: '08:00:00', lastScan: '17:00:00', date: '2026-03-05' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));

    const [, , period] = mockResolveVerification.mock.calls[0];
    expect(period).toEqual({ anio: 2026, mes: 3, numeroDequincena: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx`
Expected: FAIL — no period dropdown, no inline note, `needsResolutionSessions` not filtered by period, `allConfirmed` still requires `totalToResolve > 0`, `resolveVerification` called with only 2 args.

- [ ] **Step 3: Update `VerificationScreen.tsx`**

Add imports at the top (after the existing `import type { TasSession, TasFlag } from '../../tasTypes';`):

```ts
import type { TasPeriod } from '../../tasTypes';
import { MONTH_NAMES_ES } from '../../dateNames';
```

Add helper functions near the other module-level helpers (after `sessionMatchesFilter`):

```ts
function getSessionPeriod(dateStr: string): TasPeriod {
  const [anio, mes, day] = dateStr.split('-').map(Number);
  return { anio, mes, numeroDequincena: day <= 15 ? 1 : 2 };
}

function periodsEqual(a: TasPeriod, b: TasPeriod): boolean {
  return a.anio === b.anio && a.mes === b.mes && a.numeroDequincena === b.numeroDequincena;
}

function periodLabel(period: TasPeriod): string {
  const monthName = MONTH_NAMES_ES[period.mes];
  const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  return `${capitalized} ${period.anio} - Quincena ${period.numeroDequincena}`;
}

function periodKey(period: TasPeriod): string {
  return `${period.anio}-${period.mes}-${period.numeroDequincena}`;
}
```

In the `VerificationScreen` component, add new selectors (after `const setError = useTasStore(s => s.setError);`):

```ts
  const availablePeriods       = useTasStore(s => s.availablePeriods);
  const selectedPeriod         = useTasStore(s => s.selectedPeriod);
  const setSelectedPeriod      = useTasStore(s => s.setSelectedPeriod);
  const setAvailablePeriods    = useTasStore(s => s.setAvailablePeriods);
```

Replace the `needsResolutionSessions` line:

```ts
  const needsResolutionSessions = flaggedSessions.filter(s => s.needsResolution);
```

with:

```ts
  const needsResolutionSessions = flaggedSessions.filter(s =>
    s.needsResolution && (selectedPeriod === null || periodsEqual(getSessionPeriod(s.date), selectedPeriod))
  );
```

Replace `allConfirmed`:

```ts
  const allConfirmed = pendingCount === 0 && totalToResolve > 0;
```

with:

```ts
  const allConfirmed = pendingCount === 0;
```

Replace `handleSubmit`:

```ts
  const handleSubmit = async () => {
    if (!uploadToken) return;
    try {
      const resolutions = Object.entries(resolvedSessions).map(([id, entry]) => ({
        sessionId: Number(id),
        resolvedStart: entry.resolvedStart,
        resolvedEnd:   entry.resolvedEnd,
        updateShift:   entry.updateShift,
      }));
      const result = await resolveVerification(uploadToken, resolutions, selectedPeriod);
      setAvailablePeriods(result.availablePeriods ?? []);
      const stillNeedsResolution = result.flaggedSessions.some(s =>
        s.needsResolution && (selectedPeriod === null || periodsEqual(getSessionPeriod(s.date), selectedPeriod))
      );
      if (stillNeedsResolution) {
        clearResolvedSessions();
        setFlaggedSessions(result.flaggedSessions);
        setUploadToken(result.uploadToken);
        return;
      }
      setFlaggedSessions(result.flaggedSessions);
      setUploadToken(result.uploadToken);
      setResolvedRowCount(result.resolvedRows?.length ?? 0);
      setResolvedRows(result.resolvedRows ?? []);
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      setTasView('review');
    } catch {
      setTasView('verification');
      setError('Ocurrió un error al enviar. Intente nuevamente.');
    }
  };
```

Finally, in the JSX, add the period dropdown and inline note right after the heading (`<h2 ...>Verificación de marcaciones</h2>`):

```tsx
        <h2 className="text-headline-sm font-medium text-on-surface mb-4">
          Verificación de marcaciones
        </h2>

        {availablePeriods.length > 1 && (
          <div className="mb-4">
            <label htmlFor="period-select" className="text-label-md text-on-surface-variant mr-2">
              Periodo:
            </label>
            <select
              id="period-select"
              aria-label="Periodo"
              value={selectedPeriod ? periodKey(selectedPeriod) : ''}
              onChange={e => {
                const [anio, mes, numeroDequincena] = e.target.value.split('-').map(Number);
                setSelectedPeriod({ anio, mes, numeroDequincena });
              }}
              className="h-9 px-3 rounded-shape-sm border border-outline bg-white text-body-md focus:outline-none focus:border-primary"
            >
              {availablePeriods.map(p => (
                <option key={periodKey(p)} value={periodKey(p)}>
                  {periodLabel(p)}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-body-sm text-on-surface-variant mb-4">
          Solo se enviará el periodo seleccionado. Para procesar otros periodos, vuelva a cargar el archivo.
        </p>
```

(this replaces just the heading element — the rest of the JSX, starting with the filter chips `<div className="flex gap-2 flex-wrap mb-6">`, stays unchanged)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tas/VerificationScreen.test.tsx`
Expected: PASS (all existing tests + 6 new ones)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/tas/VerificationScreen.tsx frontend/src/components/tas/VerificationScreen.test.tsx
git commit -m "Add period selector, filtering, and gating to VerificationScreen"
```

---

## Task 9: Routing — `App.tsx` and `ReactivationReviewScreen.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/App.test.tsx`
- Modify: `frontend/src/components/tas/ReactivationReviewScreen.tsx`
- Test: `frontend/src/components/tas/ReactivationReviewScreen.test.tsx`

- [ ] **Step 1: Write the failing test for `App.tsx`**

In `frontend/src/App.test.tsx`, add a new `describe` block (e.g. after `describe('App view routing', ...)`):

```tsx
describe('TAS multi-period routing', () => {
  it('routes to verification when multiple periods exist even with no flagged sessions', async () => {
    mockUploadTasFile.mockResolvedValue({
      uploadToken: 'token-1',
      flaggedSessions: [],
      resolvedRows: [],
      inactiveEmployeesFound: [],
      absentActiveEmployees: [],
      usedFallbackHolidays: false,
      availablePeriods: [
        { anio: 2026, mes: 3, numeroDequincena: 1 },
        { anio: 2026, mes: 3, numeroDequincena: 2 },
      ],
    });

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('verification'));
    expect(useTasStore.getState().availablePeriods).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: FAIL — `handleTasFile` doesn't read `availablePeriods` and routes to `'review'` (no flagged sessions today routes to `review`).

- [ ] **Step 3: Update `App.tsx`**

Add a selector (alongside the other `useTasStore` selectors, after `const setUsedFallbackHolidays = useTasStore(s => s.setUsedFallbackHolidays);`):

```ts
  const setAvailablePeriods = useTasStore(s => s.setAvailablePeriods);
```

In `handleTasFile`, replace:

```ts
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      if (result.inactiveEmployeesFound.length > 0) {
        setTasView('inactiveReview');
      } else {
        const hasNeedsResolution = result.flaggedSessions.some(s => s.needsResolution);
        setTasView(hasNeedsResolution ? 'verification' : 'review');
      }
```

with:

```ts
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      setAvailablePeriods(result.availablePeriods ?? []);
      if (result.inactiveEmployeesFound.length > 0) {
        setTasView('inactiveReview');
      } else {
        const hasNeedsResolution = result.flaggedSessions.some(s => s.needsResolution);
        const hasMultiplePeriods = (result.availablePeriods?.length ?? 0) > 1;
        setTasView(hasNeedsResolution || hasMultiplePeriods ? 'verification' : 'review');
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: PASS (all existing tests + 1 new one)

- [ ] **Step 5: Write the failing test for `ReactivationReviewScreen.tsx`**

In `frontend/src/components/tas/ReactivationReviewScreen.test.tsx`, add a new test inside `describe('ReactivationReviewScreen continue', ...)`, e.g. after `'advances to review when no sessions need resolution'`:

```tsx
  it('routes to verification when multiple periods exist even with no flagged sessions', async () => {
    setup();
    mockSubmitInactiveReview.mockResolvedValue({
      ...mockResult,
      resolvedRows: [],
      availablePeriods: [
        { anio: 2026, mes: 3, numeroDequincena: 1 },
        { anio: 2026, mes: 3, numeroDequincena: 2 },
      ],
    });
    render(<ReactivationReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('verification'));
    expect(useTasStore.getState().availablePeriods).toHaveLength(2);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/tas/ReactivationReviewScreen.test.tsx`
Expected: FAIL — `handleContinue` doesn't read `availablePeriods` and routes to `'review'`.

- [ ] **Step 7: Update `ReactivationReviewScreen.tsx`**

Add a selector (alongside the other `useTasStore` selectors, after `const setResolvedRows = useTasStore(s => s.setResolvedRows);`):

```ts
  const setAvailablePeriods = useTasStore(s => s.setAvailablePeriods);
```

In `handleContinue`, replace:

```ts
      setResolvedRows(result.resolvedRows ?? []);
      const hasNeedsResolution = result.flaggedSessions.some(s => s.needsResolution);
      setTasView(hasNeedsResolution ? 'verification' : 'review');
```

with:

```ts
      setResolvedRows(result.resolvedRows ?? []);
      setAvailablePeriods(result.availablePeriods ?? []);
      const hasNeedsResolution = result.flaggedSessions.some(s => s.needsResolution);
      const hasMultiplePeriods = (result.availablePeriods?.length ?? 0) > 1;
      setTasView(hasNeedsResolution || hasMultiplePeriods ? 'verification' : 'review');
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/tas/ReactivationReviewScreen.test.tsx`
Expected: PASS (all existing tests + 1 new one)

- [ ] **Step 9: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS (no regressions)

- [ ] **Step 10: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/components/tas/ReactivationReviewScreen.tsx frontend/src/components/tas/ReactivationReviewScreen.test.tsx
git commit -m "Route to verification for multi-period uploads even without flagged sessions"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run full backend suite**

Run: `cd backend && ./mvnw test`
Expected: PASS, 0 failures

- [ ] **Step 2: Run full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, 0 failures

- [ ] **Step 3: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Manual smoke test**

Start backend and frontend dev servers, upload a TAS file spanning two quincenas, confirm:
- The verification screen shows a period dropdown with both quincenas labeled (e.g. "Abril 2026 - Quincena 1").
- Switching periods preserves already-confirmed session resolutions.
- "Enviar" is enabled once the selected period's flagged sessions are confirmed (or immediately if it has none).
- The review screen shows exactly one row per employee for the submitted period.
- The inline note about single-period submission is visible on the verification screen.
