# TAS Ambiguous-Shift Session Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dropping employee scans that fall outside every configured shift's detection window — group them into an `AMBIGUOUS_SHIFT`-flagged session built from the real scan times, compute hours normally (8h default duration for the simples/dobles split), and surface a per-employee informational badge on the review screen.

**Architecture:** `TasSessionGrouper` gets a fallback session-formation path (`openAmbiguousSession`) plus an accumulation/closing rule (same-day, ≤12h span) for sessions with `matchedShiftId == null`. `TasHoursCalculator.calculate()` is changed so `AMBIGUOUS_SHIFT` alone doesn't set `needsResolution`. `TasReportBuilder`/`EmployeeRow`/`ResolvedRow` gain a `diasTurnoAmbiguo` count, surfaced as a badge in `ReviewScreen.tsx`.

**Tech Stack:** Spring Boot (Java 17, JUnit 5, AssertJ, Mockito) backend; React/TypeScript + Vitest/Testing Library frontend.

**Branch:** `fix/tas-ambiguous-shift-detection` (already created, holds the design doc commit `df4a0e3`). All commits in this plan go on this branch.

---

## Task 1: Add `AMBIGUOUS_SHIFT` to `TasFlag` (backend + frontend)

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/model/tas/TasFlag.java`
- Modify: `frontend/src/tasTypes.ts:1`

- [ ] **Step 1: Add the enum value**

Edit `backend/src/main/java/com/planilla/backend/model/tas/TasFlag.java`:

```java
package com.planilla.backend.model.tas;

public enum TasFlag {
    MISSING_ENTRY,
    MISSING_EXIT,
    SHIFT_MISMATCH,
    SAME_DAY_DOUBLE,
    START_CUTOFF,
    END_CUTOFF,
    AMBIGUOUS_SHIFT
}
```

- [ ] **Step 2: Add the frontend union member**

Edit `frontend/src/tasTypes.ts:1`:

```ts
export type TasFlag = 'MISSING_ENTRY' | 'MISSING_EXIT' | 'SHIFT_MISMATCH' | 'SAME_DAY_DOUBLE' | 'START_CUTOFF' | 'END_CUTOFF' | 'AMBIGUOUS_SHIFT'
```

- [ ] **Step 3: Compile check**

Run: `cd backend && ./mvnw -q compile` and `cd frontend && npx tsc --noEmit`
Expected: both succeed (the enum value is unused so far, no compile errors).

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/model/tas/TasFlag.java frontend/src/tasTypes.ts
git commit -m "Add AMBIGUOUS_SHIFT flag to TasFlag enum and frontend type"
```

---

## Task 2: `TasSessionGrouper` — open an ambiguous session instead of dropping the scan

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasSessionGrouper.java:72-118` (and add `openAmbiguousSession`)
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java:177-186`

- [ ] **Step 1: Replace the existing "scan outside all windows" test with the new expected behavior**

In `TasSessionGrouperTest.java`, replace the `group_scanOutsideAllWindows_notGroupedIntoSession` test (lines 177-186) with:

```java
    @Test
    void group_scanOutsideAllWindows_createsAmbiguousSession() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 11, 30))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getMatchedShiftId()).isNull();
        assertThat(s.getFlags()).containsExactly(TasFlag.AMBIGUOUS_SHIFT);
        assertThat(s.getScans()).containsExactly(LocalDateTime.of(2026, 3, 10, 11, 30));
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./mvnw -q test -Dtest=TasSessionGrouperTest#group_scanOutsideAllWindows_createsAmbiguousSession`
Expected: FAIL — `sessions` is empty (current code drops the scan).

- [ ] **Step 3: Add the `ChronoUnit` import and `AMBIGUOUS_MAX_SPAN_MINUTES` constant**

In `TasSessionGrouper.java`, add the import (alongside the existing `java.time.*` imports at lines 8-11):

```java
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
```

And add the constant next to the existing ones (lines 16-18):

```java
    private static final int DEDUP_WINDOW_MINUTES    = 5;
    private static final int DETECTION_BEFORE_MINUTES = 60;
    private static final int DETECTION_AFTER_MINUTES  = 10;
    private static final int AMBIGUOUS_MAX_SPAN_MINUTES = 720;
```

- [ ] **Step 4: Replace the session-formation fallback and add `openAmbiguousSession`**

Replace the `currentSession == null` branch (lines 83-88):

```java
        for (TasScanRecord scan : scans) {
            if (currentSession == null) {
                Map<String, Object> openerShift = findOpenerShift(scan.getTimestamp(), shifts, assignedShift, isCrossMidnight);
                currentSession = openerShift != null
                        ? openSession(employeeId, scan, openerShift, assignedShift, isCrossMidnight)
                        : openAmbiguousSession(employeeId, scan);
            } else {
```

Add the new `openAmbiguousSession` method right after `openSession` (after line 213):

```java
    private TasSession openAmbiguousSession(String employeeId, TasScanRecord firstScan) {
        TasSession session = new TasSession();
        session.setEmployeeId(employeeId);
        session.setEmployeeName(firstScan.getEmployeeName());
        session.setDate(firstScan.getTimestamp().toLocalDate());
        session.setCrossMidnight(false);
        session.setSessionAnchor("D");
        session.setFlags(new ArrayList<>(List.of(TasFlag.AMBIGUOUS_SHIFT)));

        List<LocalDateTime> scans = new ArrayList<>();
        scans.add(firstScan.getTimestamp());
        session.setScans(scans);

        session.setMatchedShiftId(null);

        return session;
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && ./mvnw -q test -Dtest=TasSessionGrouperTest#group_scanOutsideAllWindows_createsAmbiguousSession`
Expected: PASS

- [ ] **Step 6: Run the full grouper test suite to check for regressions**

Run: `cd backend && ./mvnw -q test -Dtest=TasSessionGrouperTest`
Expected: PASS (all existing tests still pass — `findOpenerShift == null` only happens when `currentSession == null`, which is the only branch changed so far)

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/service/tas/TasSessionGrouper.java backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java
git commit -m "Open an ambiguous session instead of dropping unmatched scans"
```

---

## Task 3: `TasSessionGrouper` — accumulate scans into the ambiguous session (same-day, ≤12h cap)

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasSessionGrouper.java` (the `else` branch of `groupEmployeeSessions`)
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java`

- [ ] **Step 1: Write the failing tests**

Add these three tests to `TasSessionGrouperTest.java` (after the test added in Task 2):

```java
    @Test
    void group_ambiguousSession_accumulatesSameDayScans() {
        List<TasScanRecord> scans = List.of(
            scan("134", LocalDateTime.of(2026, 4, 30, 8, 51)),
            scan("134", LocalDateTime.of(2026, 4, 30, 19, 11))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("134"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getMatchedShiftId()).isNull();
        assertThat(s.getFlags()).containsExactly(TasFlag.AMBIGUOUS_SHIFT);
        assertThat(s.getScans()).containsExactly(
            LocalDateTime.of(2026, 4, 30, 8, 51),
            LocalDateTime.of(2026, 4, 30, 19, 11)
        );
    }

    @Test
    void group_ambiguousSession_splitsAcrossCalendarDays() {
        List<TasScanRecord> scans = List.of(
            scan("134", LocalDateTime.of(2026, 4, 30, 8, 51)),
            scan("134", LocalDateTime.of(2026, 4, 30, 19, 11)),
            scan("134", LocalDateTime.of(2026, 5, 1, 9, 2))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("134"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getDate()).isEqualTo(LocalDate.of(2026, 4, 30));
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT);
        assertThat(sessions.get(1).getDate()).isEqualTo(LocalDate.of(2026, 5, 1));
        assertThat(sessions.get(1).getScans()).containsExactly(LocalDateTime.of(2026, 5, 1, 9, 2));
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT);
    }

    @Test
    void group_ambiguousSession_splitsWhenSpanExceeds12Hours() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 8, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 21, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getScans()).containsExactly(LocalDateTime.of(2026, 3, 10, 8, 0));
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT);
        assertThat(sessions.get(1).getScans()).containsExactly(LocalDateTime.of(2026, 3, 10, 21, 0));
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ./mvnw -q test -Dtest=TasSessionGrouperTest#group_ambiguousSession_accumulatesSameDayScans+group_ambiguousSession_splitsAcrossCalendarDays+group_ambiguousSession_splitsWhenSpanExceeds12Hours`
Expected: FAIL — currently every scan after the first opens a brand-new ambiguous session (no accumulation), so `sessions` will have more entries than expected (3 sessions for the first two tests, not 1/2).

- [ ] **Step 3: Implement the accumulation/closing logic**

In `TasSessionGrouper.java`, the `else` branch of `groupEmployeeSessions` currently starts with the `isNextShiftExitScan` check (line 90) followed directly by the `openerShift` re-evaluation (lines 98-108). Insert the new ambiguous-session check **between** them:

```java
            } else {
                if (isNextShiftExitScan(scan.getTimestamp(), currentSession, shifts, assignedShift)) {
                    currentSession.getScans().add(scan.getTimestamp());
                    finalizeSession(currentSession);
                    sessions.add(currentSession);
                    currentSession = null;
                    continue;
                }

                if (currentSession.getMatchedShiftId() == null) {
                    LocalDateTime sessionFirstScan = currentSession.getScans().get(0);
                    boolean differentDay = !scan.getTimestamp().toLocalDate().equals(currentSession.getDate());
                    boolean exceedsSpan = ChronoUnit.MINUTES.between(sessionFirstScan, scan.getTimestamp()) > AMBIGUOUS_MAX_SPAN_MINUTES;

                    if (differentDay || exceedsSpan) {
                        finalizeSession(currentSession);
                        sessions.add(currentSession);
                        Map<String, Object> openerShift = findOpenerShift(scan.getTimestamp(), shifts, assignedShift, isCrossMidnight);
                        currentSession = openerShift != null
                                ? openSession(employeeId, scan, openerShift, assignedShift, isCrossMidnight)
                                : openAmbiguousSession(employeeId, scan);
                    } else {
                        currentSession.getScans().add(scan.getTimestamp());
                    }
                    continue;
                }

                Map<String, Object> openerShift = currentSession.getScans().size() == 1
                        && isScanAfterCurrentShiftEnd(scan.getTimestamp(), currentSession, shifts)
                        ? findOpenerShift(scan.getTimestamp(), shifts, assignedShift, isCrossMidnight)
                        : null;
                if (openerShift != null) {
                    finalizeSession(currentSession);
                    sessions.add(currentSession);
                    currentSession = openSession(employeeId, scan, openerShift, assignedShift, isCrossMidnight);
                } else {
                    currentSession.getScans().add(scan.getTimestamp());
                }
            }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && ./mvnw -q test -Dtest=TasSessionGrouperTest`
Expected: PASS (all tests, including the 3 new ones and the one from Task 2)

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/service/tas/TasSessionGrouper.java backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java
git commit -m "Accumulate ambiguous-session scans within a 12h same-day window"
```

---

## Task 4: `TasSessionGrouper` — fix `detectSameDayDouble` for ambiguous sessions

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasSessionGrouper.java:222-238`
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java`

- [ ] **Step 1: Write the failing tests**

Add these two tests to `TasSessionGrouperTest.java`:

```java
    @Test
    void group_sameDayDouble_normalAndAmbiguousSessionsSameDay() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 0, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 14, 30))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT, TasFlag.SAME_DAY_DOUBLE);
        assertThat(sessions.get(1).getMatchedShiftId()).isEqualTo(TARDE_ID);
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.SAME_DAY_DOUBLE);
    }

    @Test
    void group_sameDayDouble_twoAmbiguousSessionsSameDay() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 0, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 12, 30))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT, TasFlag.SAME_DAY_DOUBLE);
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT, TasFlag.SAME_DAY_DOUBLE);
        assertThat(sessions.get(1).getMatchedShiftId()).isNull();
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ./mvnw -q test -Dtest=TasSessionGrouperTest#group_sameDayDouble_normalAndAmbiguousSessionsSameDay+group_sameDayDouble_twoAmbiguousSessionsSameDay`
Expected: FAIL — both sessions have `matchedShiftId == null` (in the second test) or `{null, "tarde"}` collapses to a 2-element set already in the first test... but in the second test `shiftIds = {null}` has size 1, so `SAME_DAY_DOUBLE` is never added. The first test may actually pass already (size 2 distinct), so confirm by running — the second test is the one that must fail.

- [ ] **Step 3: Fix `detectSameDayDouble`**

Replace the body of `detectSameDayDouble` (lines 222-238):

```java
    private void detectSameDayDouble(List<TasSession> sessions) {
        Map<LocalDate, List<TasSession>> byDate = new LinkedHashMap<>();
        for (TasSession s : sessions) {
            byDate.computeIfAbsent(s.getDate(), k -> new ArrayList<>()).add(s);
        }
        for (List<TasSession> daySessions : byDate.values()) {
            if (daySessions.size() < 2) continue;
            Set<String> shiftIds = new HashSet<>();
            for (TasSession s : daySessions) {
                String key = s.getFlags().contains(TasFlag.AMBIGUOUS_SHIFT)
                        ? "ambiguous-" + System.identityHashCode(s)
                        : s.getMatchedShiftId();
                shiftIds.add(key);
            }
            if (shiftIds.size() < 2) continue;
            for (TasSession s : daySessions) {
                if (!s.getFlags().contains(TasFlag.SAME_DAY_DOUBLE)) {
                    s.getFlags().add(TasFlag.SAME_DAY_DOUBLE);
                }
            }
        }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && ./mvnw -q test -Dtest=TasSessionGrouperTest`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/service/tas/TasSessionGrouper.java backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java
git commit -m "Fix same-day-double detection for ambiguous sessions"
```

---

## Task 5: `TasSessionGrouper` — document the cross-midnight ambiguous limitation with a test

**Files:**
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java`

- [ ] **Step 1: Write the test (it should already pass — this documents the known limitation)**

Add to `TasSessionGrouperTest.java`:

```java
    @Test
    void group_ambiguousScansAcrossMidnight_splitsAtDayBoundary_knownLimitation() {
        // Known limitation: an overnight stretch of scans that matches no shift window
        // is split into two single-scan ambiguous sessions at the calendar-day boundary,
        // instead of one continuous cross-midnight session.
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 23, 0)),
            scan("100", LocalDateTime.of(2026, 3, 11, 1, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getDate()).isEqualTo(LocalDate.of(2026, 3, 10));
        assertThat(sessions.get(0).getScans()).containsExactly(LocalDateTime.of(2026, 3, 10, 23, 0));
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT);
        assertThat(sessions.get(1).getDate()).isEqualTo(LocalDate.of(2026, 3, 11));
        assertThat(sessions.get(1).getScans()).containsExactly(LocalDateTime.of(2026, 3, 11, 1, 0));
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT);
    }
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd backend && ./mvnw -q test -Dtest=TasSessionGrouperTest#group_ambiguousScansAcrossMidnight_splitsAtDayBoundary_knownLimitation`
Expected: PASS — `differentDay` is `true` for the second scan (2026-03-11 vs 2026-03-10), so the session splits at the boundary as designed.

- [ ] **Step 3: Commit**

```bash
git add backend/src/test/java/com/planilla/backend/service/tas/TasSessionGrouperTest.java
git commit -m "Add test documenting cross-midnight ambiguous-session split limitation"
```

---

## Task 6: `TasHoursCalculator` — `AMBIGUOUS_SHIFT` alone must not block hours computation

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasHoursCalculator.java:42-53`
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasHoursCalculatorTest.java`

- [ ] **Step 1: Write the failing tests**

Add these two tests to `TasHoursCalculatorTest.java` (after the last test, before the closing brace):

```java
    @Test
    void calculate_ambiguousShiftFlagAlone_doesNotBlockHoursComputation() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 9, 0),
            LocalDateTime.of(2026, 3, 10, 19, 0)
        );
        s.setMatchedShiftId(null);
        s.setFlags(new ArrayList<>(List.of(TasFlag.AMBIGUOUS_SHIFT)));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 3, 10, 9, 0));
        assertThat(s.getWorkedMinutes()).isEqualTo(600);
        assertThat(s.getWorkedHours()).isEqualTo(10.0);
        // 8h default shift duration: 480min simples, remainder dobles
        assertThat(s.getSimplesMinutes()).isEqualTo(480);
        assertThat(s.getDoblesMinutes()).isEqualTo(120);
    }

    @Test
    void calculate_ambiguousShiftWithOtherFlag_stillNeedsResolution() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 9, 0),
            LocalDateTime.of(2026, 3, 10, 19, 0)
        );
        s.setMatchedShiftId(null);
        s.setFlags(new ArrayList<>(List.of(TasFlag.AMBIGUOUS_SHIFT, TasFlag.SAME_DAY_DOUBLE)));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isTrue();
        assertThat(s.getWorkedMinutes()).isEqualTo(0);
        assertThat(s.getWorkedHours()).isEqualTo(0.0);
        assertThat(s.getSimplesMinutes()).isEqualTo(0);
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ./mvnw -q test -Dtest=TasHoursCalculatorTest#calculate_ambiguousShiftFlagAlone_doesNotBlockHoursComputation+calculate_ambiguousShiftWithOtherFlag_stillNeedsResolution`
Expected: FAIL — the first test fails because `flagged = true` (the session has `AMBIGUOUS_SHIFT`), so `needsResolution` is `true` and hours are zeroed instead of computed.

- [ ] **Step 3: Implement the `hasBlockingFlags` change**

Replace lines 42-53 in `TasHoursCalculator.java`:

```java
            boolean hasBlockingFlags = session.getFlags() != null
                    && session.getFlags().stream().anyMatch(f -> f != TasFlag.AMBIGUOUS_SHIFT);
            session.setNeedsResolution(hasBlockingFlags);

            if (!hasBlockingFlags) {
                computeWorkedHours(session, shifts, legalBreakAllowance);
                classifyHours(session, shifts);
            } else {
                session.setWorkedMinutes(0);
                session.setWorkedHours(0.0);
                session.setSimplesMinutes(0);
                session.setDoblesMinutes(0);
            }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && ./mvnw -q test -Dtest=TasHoursCalculatorTest`
Expected: PASS (all tests, including the two new ones — existing tests use `flags=new ArrayList<>()` so `hasBlockingFlags` is `false` for them too, same as before)

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/service/tas/TasHoursCalculator.java backend/src/test/java/com/planilla/backend/service/tas/TasHoursCalculatorTest.java
git commit -m "Don't block hours computation on AMBIGUOUS_SHIFT flag alone"
```

---

## Task 7: `EmployeeRow` + `TasReportBuilder` — add `diasTurnoAmbiguo`

**Files:**
- Modify: `backend/src/main/java/com/planilla/backend/model/EmployeeRow.java`
- Modify: `backend/src/main/java/com/planilla/backend/service/tas/TasReportBuilder.java`
- Test: `backend/src/test/java/com/planilla/backend/service/tas/TasReportBuilderTest.java`

- [ ] **Step 1: Write the failing test**

Add to `TasReportBuilderTest.java` (after the last test, before the closing brace):

```java
    @Test
    void build_diasTurnoAmbiguo_countsDistinctAmbiguousDaysPerEmployeeQuincena() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        TasSession ambiguous = resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0);
        ambiguous.setMatchedShiftId(null);
        ambiguous.setFlags(new ArrayList<>(List.of(TasFlag.AMBIGUOUS_SHIFT)));

        TasSession normal = resolvedSession("100", LocalDate.of(2026, 3, 6), 480, 0);

        TasReportBuilder.BuildResult result = builder.build(List.of(ambiguous, normal), start, end, shifts);

        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getDiasTurnoAmbiguo()).isEqualTo(1);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./mvnw -q test -Dtest=TasReportBuilderTest#build_diasTurnoAmbiguo_countsDistinctAmbiguousDaysPerEmployeeQuincena`
Expected: COMPILE FAIL — `EmployeeRow.getDiasTurnoAmbiguo()` doesn't exist yet.

- [ ] **Step 3: Add the field to `EmployeeRow`**

Edit `backend/src/main/java/com/planilla/backend/model/EmployeeRow.java`, add a new field and accessor pair (after `numeroDequincena`, line 12):

```java
    private String codigoEmpleado;
    private String nombreEmpleado;
    private int diasNoLaborados;
    private int horasExtrasSimples;
    private int horasExtrasDobles;
    private int mes;
    private int anio;
    private Integer numeroDequincena; // set by user after upload
    private int diasTurnoAmbiguo;
```

And add the accessor pair at the end of the class (after `setNumeroDequincena`, line 38):

```java
    public Integer getNumeroDequincena() { return numeroDequincena; }
    public void setNumeroDequincena(Integer numeroDequincena) { this.numeroDequincena = numeroDequincena; }

    public int getDiasTurnoAmbiguo() { return diasTurnoAmbiguo; }
    public void setDiasTurnoAmbiguo(int diasTurnoAmbiguo) { this.diasTurnoAmbiguo = diasTurnoAmbiguo; }
```

- [ ] **Step 4: Accumulate ambiguous days in `TasReportBuilder.build`**

In `TasReportBuilder.java`, add a new accumulator map alongside `workedDaysByEmployee`/`minutesByEmployeeQuincena` (after line 29):

```java
        Map<String, String> employeeNames = new LinkedHashMap<>();
        Map<String, Set<LocalDate>> workedDaysByEmployee = new LinkedHashMap<>();
        Map<String, Map<Integer, int[]>> minutesByEmployeeQuincena = new LinkedHashMap<>();
        Map<String, Map<Integer, Set<LocalDate>>> ambiguousDaysByEmpQuincena = new LinkedHashMap<>();
```

Inside the first `for (TasSession session : sessions)` loop (lines 31-49), after the `minutes` accumulation block, add:

```java
            if (!session.isNeedsResolution()) {
                minutes[0] += session.getSimplesMinutes();
                minutes[1] += session.getDoblesMinutes();
            }

            if (session.getFlags() != null && session.getFlags().contains(TasFlag.AMBIGUOUS_SHIFT)) {
                ambiguousDaysByEmpQuincena
                        .computeIfAbsent(empId, k -> new LinkedHashMap<>())
                        .computeIfAbsent(quincena, k -> new HashSet<>())
                        .add(session.getDate());
            }
```

Then, in the row-building loop (lines 62-91), after `int[] minutes = qEntry.getValue();` (line 64), compute and set the count:

```java
            for (Map.Entry<Integer, int[]> qEntry : empEntry.getValue().entrySet()) {
                int quincena = qEntry.getKey();
                int[] minutes = qEntry.getValue();

                int diasTurnoAmbiguo = ambiguousDaysByEmpQuincena
                        .getOrDefault(empId, Map.of())
                        .getOrDefault(quincena, Set.of())
                        .size();
```

And set it on the row, after `row.setNumeroDequincena(quincena);` (line 89):

```java
                row.setNumeroDequincena(quincena);
                row.setDiasTurnoAmbiguo(diasTurnoAmbiguo);
                rows.add(row);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && ./mvnw -q test -Dtest=TasReportBuilderTest`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/planilla/backend/model/EmployeeRow.java backend/src/main/java/com/planilla/backend/service/tas/TasReportBuilder.java backend/src/test/java/com/planilla/backend/service/tas/TasReportBuilderTest.java
git commit -m "Surface diasTurnoAmbiguo count per employee/quincena"
```

---

## Task 8: Frontend — `ResolvedRow.diasTurnoAmbiguo` type + badge on `ReviewScreen`

**Files:**
- Modify: `frontend/src/tasTypes.ts:23-32`
- Modify: `frontend/src/components/tas/ReviewScreen.tsx`
- Modify: `frontend/src/components/tas/ReviewScreen.test.tsx`
- Modify: `frontend/src/tasStore.test.ts:312`, `:337`
- Modify: `frontend/src/components/tas/VerificationScreen.test.tsx:36-37`

- [ ] **Step 1: Add the field to `ResolvedRow`**

Edit `frontend/src/tasTypes.ts:23-32`:

```ts
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
}
```

- [ ] **Step 2: Fix existing fixtures so the project still type-checks**

In `frontend/src/tasStore.test.ts`, add `diasTurnoAmbiguo: 0` to both row literals:

Line 312:
```ts
      { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0 },
```

Line 337:
```ts
      { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0 },
```

In `frontend/src/components/tas/VerificationScreen.test.tsx:36-37`:

```ts
    { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0 },
    { codigoEmpleado: 'E2', nombreEmpleado: 'Luis', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0 },
```

In `frontend/src/components/tas/ReviewScreen.test.tsx:13-14`:

```ts
const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0 },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0 },
];
```

- [ ] **Step 3: Run the type check and existing test suites to confirm no breakage**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/tasStore.test.ts src/components/tas/VerificationScreen.test.tsx src/components/tas/ReviewScreen.test.tsx`
Expected: PASS

- [ ] **Step 4: Write the failing badge tests**

Add to `frontend/src/components/tas/ReviewScreen.test.tsx`, inside `describe('ReviewScreen rendering', ...)`:

```ts
  it('shows the ambiguous-shift badge when diasTurnoAmbiguo > 0', () => {
    useTasStore.getState().setResolvedRows([
      { ...rows[0], diasTurnoAmbiguo: 2 },
      rows[1],
    ]);
    render(<ReviewScreen />);
    expect(screen.getByText('2 sin turno')).toBeInTheDocument();
  });

  it('does not show the ambiguous-shift badge when diasTurnoAmbiguo is 0', () => {
    useTasStore.getState().setResolvedRows(rows);
    render(<ReviewScreen />);
    expect(screen.queryByText(/sin turno/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/tas/ReviewScreen.test.tsx`
Expected: FAIL — `screen.getByText('2 sin turno')` is not found (no badge rendered yet).

- [ ] **Step 6: Add the badge to `ReviewScreen.tsx`**

In `frontend/src/components/tas/ReviewScreen.tsx`, replace the employee-name cell (line 49):

```tsx
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/tas/ReviewScreen.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 8: Run the full frontend suite to check for regressions**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/tasTypes.ts frontend/src/tasStore.test.ts frontend/src/components/tas/VerificationScreen.test.tsx frontend/src/components/tas/ReviewScreen.tsx frontend/src/components/tas/ReviewScreen.test.tsx
git commit -m "Add diasTurnoAmbiguo badge to review screen"
```

---

## Task 9: Integration test — employee 134 fixture produces non-empty `resolvedRows`

**Files:**
- Create: `backend/src/test/java/com/planilla/backend/service/tas/TasAmbiguousShiftPipelineTest.java`

This wires the real (non-mocked) `TasSessionGrouper`, `TasHoursCalculator`, and `TasReportBuilder` together with employee 134's actual scan pattern (assigned Mañana, but scans ~08:51-09:02 entry / ~19:11-21:42 exit, outside all detection windows) to confirm the end-to-end fix: `resolvedRows` is non-empty and hours are computed.

- [ ] **Step 1: Write the failing test**

Create `backend/src/test/java/com/planilla/backend/service/tas/TasAmbiguousShiftPipelineTest.java`:

```java
package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TasAmbiguousShiftPipelineTest {

    @Mock AppConfigService appConfigService;
    @Mock HolidayService holidayService;
    @Mock ShiftConfigService shiftConfigService;

    TasSessionGrouper grouper;
    TasHoursCalculator calculator;
    TasReportBuilder reportBuilder;

    private List<Map<String, Object>> shifts;

    @BeforeEach
    void setUp() {
        grouper = new TasSessionGrouper();
        calculator = new TasHoursCalculator(appConfigService, holidayService, shiftConfigService);
        reportBuilder = new TasReportBuilder(holidayService);

        Map<String, Object> manana = new LinkedHashMap<>();
        manana.put("id", "manana");
        manana.put("name", "Manana");
        manana.put("start_time", "07:00");
        manana.put("end_time", "15:00");
        manana.put("cross_midnight", false);

        Map<String, Object> tarde = new LinkedHashMap<>();
        tarde.put("id", "tarde");
        tarde.put("name", "Tarde");
        tarde.put("start_time", "15:00");
        tarde.put("end_time", "23:00");
        tarde.put("cross_midnight", false);

        Map<String, Object> noche = new LinkedHashMap<>();
        noche.put("id", "noche");
        noche.put("name", "Noche");
        noche.put("start_time", "19:00");
        noche.put("end_time", "07:00");
        noche.put("cross_midnight", true);

        shifts = List.of(manana, tarde, noche);

        when(appConfigService.getLegalBreakAllowanceMinutes()).thenReturn(45);
        when(shiftConfigService.getAllShifts()).thenReturn(shifts);
        when(holidayService.isHoliday(any())).thenReturn(false);
    }

    private TasScanRecord scan(String empId, String name, LocalDateTime ts) {
        TasScanRecord r = new TasScanRecord();
        r.setEmployeeId(empId);
        r.setEmployeeName(name);
        r.setTimestamp(ts);
        return r;
    }

    @Test
    void employee134_scansOutsideAllShiftWindows_produceNonEmptyResolvedRows() {
        String name = "Morales Cifuentes Roberto Daniel";
        List<TasScanRecord> scans = List.of(
            scan("134", name, LocalDateTime.of(2026, 4, 30, 8, 51)),
            scan("134", name, LocalDateTime.of(2026, 4, 30, 19, 11)),
            scan("134", name, LocalDateTime.of(2026, 5, 4, 8, 55)),
            scan("134", name, LocalDateTime.of(2026, 5, 4, 19, 5))
        );

        Map<String, String> assignments = Map.of("134", "manana");

        List<TasSession> sessions = grouper.group(scans, shifts, assignments);
        assertThat(sessions).hasSize(2);
        assertThat(sessions).allSatisfy(s -> assertThat(s.getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT));

        LocalDate reportStart = LocalDate.of(2026, 4, 16);
        LocalDate reportEnd   = LocalDate.of(2026, 5, 15);
        calculator.calculate(sessions, reportStart, reportEnd);

        assertThat(sessions).allSatisfy(s -> assertThat(s.isNeedsResolution()).isFalse());
        assertThat(sessions).allSatisfy(s -> assertThat(s.getWorkedMinutes()).isGreaterThan(0));

        TasReportBuilder.BuildResult result = reportBuilder.build(sessions, reportStart, reportEnd, shifts);

        assertThat(result.rows).isNotEmpty();
        EmployeeRow row = result.rows.get(0);
        assertThat(row.getCodigoEmpleado()).isEqualTo("134");
        assertThat(row.getDiasTurnoAmbiguo()).isGreaterThan(0);
    }
}
```

- [ ] **Step 2: Run the test**

Run: `cd backend && ./mvnw -q test -Dtest=TasAmbiguousShiftPipelineTest`
Expected: PASS — given Tasks 2-7 are complete, this should pass on the first run. If it fails, re-check the session count/flags assumptions against the actual output (e.g. print `sessions` if `hasSize(2)` doesn't match) before changing any production code — this test should not require further production changes if Tasks 2-7 are correct.

- [ ] **Step 3: Commit**

```bash
git add backend/src/test/java/com/planilla/backend/service/tas/TasAmbiguousShiftPipelineTest.java
git commit -m "Add end-to-end test for ambiguous-shift pipeline (employee 134 scenario)"
```

---

## Task 10: Update `docs/tas_shift_rules.md`

**Files:**
- Modify: `docs/tas_shift_rules.md`

- [ ] **Step 1: Document the `AMBIGUOUS_SHIFT` flag and update Session Grouping**

In the **Session Grouping** section (after line 90, before "**Same-day double session**" at line 101), add:

```markdown
**Ambiguous sessions**: if a scan would open a new session (`currentSession == null`) but does not fall within any configured shift's detection window, a session is still opened from that scan — flagged `AMBIGUOUS_SHIFT`, with `matchedShiftId = null`. Subsequent scans accumulate into this session as long as they're on the **same calendar day** and within **12 hours** of the session's first scan; once either limit is exceeded, the session closes and a new one opens (ambiguous again, or matched, depending on the triggering scan).

**Known limitation**: an overnight stretch of scans that matches no shift window is split into two single-scan ambiguous sessions at the calendar-day boundary, instead of one continuous cross-midnight session. Same category as the missing-exit-plus-same-day-re-entry limitation below.
```

Update the **Same-day double session** line (line 101) to:

```markdown
**Same-day double session**: if two detection-window hits from **different** shifts occur on the same calendar day → flag for manual confirmation. Two ambiguous sessions on the same calendar day are also treated as distinct "shifts" for this check (each gets a unique internal key), so they are flagged too.
```

- [ ] **Step 2: Update Shift Mismatch Detection item 3**

Replace line 113:

```markdown
3. If no shift matches → the session is still built from the actual scans (first scan = entry, last scan = exit, same grouping rules as a normal session, capped at a 12h same-day span — see Session Grouping), flagged `AMBIGUOUS_SHIFT`, and computed normally (effectiveStart = first scan, no grace/tardy, 8h default shift duration for the simples/dobles split — see Worked Hours per Session). This is purely informational: shown as a badge on the employee's row in the pre-submit review screen ("N sin turno"), no manual input required.
```

- [ ] **Step 3: Update Missing Scan Detection**

After the "Known limitation" paragraph (line 152), add:

```markdown
**Ambiguous sessions** (`AMBIGUOUS_SHIFT`, `matchedShiftId = null`) never get `MISSING_ENTRY`/`MISSING_EXIT` flags — there is no expected shift time to compare scans against.
```

- [ ] **Step 4: Update Worked Hours per Session**

After line 174 ("Sessions with `needsResolution = true`..."), add:

```markdown
**Ambiguous sessions** (`AMBIGUOUS_SHIFT`, `matchedShiftId = null`) are computed normally: `effectiveStart = firstScan` (no grace/tardy adjustment), and the simples/dobles split uses an **8h default shift duration** — the existing fallback when no shift is matched. `AMBIGUOUS_SHIFT` alone does **not** set `needsResolution = true`; only if it co-occurs with another flag (e.g. `SAME_DAY_DOUBLE`) is the session blocked and zeroed as above. **Note**: this 8h default is shared with TASK-33's planned overtime-rules redesign — when TASK-33 changes how shift duration feeds into simples/dobles, this fallback for ambiguous sessions should be revisited too.
```

- [ ] **Step 5: Update Output Flow / review screen mention**

After the existing **Output Flow** paragraph (line 356), add:

```markdown
If any employee has one or more days flagged `AMBIGUOUS_SHIFT` in the quincena, the review screen shows an informational badge next to their name ("N sin turno") with a tooltip explaining that those days' hours were calculated from the actual scans using an 8h default shift duration. This badge is purely informational and does not block submission.
```

- [ ] **Step 6: Commit**

```bash
git add docs/tas_shift_rules.md
git commit -m "Document AMBIGUOUS_SHIFT flag and ambiguous session handling"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage**: all 8 doc-update items, the `TasFlag` addition, grouper fallback + accumulation + same-day-double fix, `TasHoursCalculator` wrinkle, `EmployeeRow`/`TasReportBuilder`/`ResolvedRow` count, `ReviewScreen` badge, and the 5 grouper test scenarios + 2 calculator tests + 1 report-builder test + 1 pipeline test from the design doc's Testing section are all covered by Tasks 1-10.
- **Type consistency**: `diasTurnoAmbiguo` (int / number) used consistently across `EmployeeRow`, `TasReportBuilder`, `tasTypes.ts`, `ReviewScreen.tsx`, and all touched test fixtures. `AMBIGUOUS_SHIFT` matches between `TasFlag.java` and `tasTypes.ts`.
- **No placeholders**: every step has complete code/commands.
