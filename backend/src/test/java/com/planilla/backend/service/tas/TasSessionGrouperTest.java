package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

import static org.assertj.core.api.Assertions.*;

class TasSessionGrouperTest {

    private TasSessionGrouper grouper;

    private static final String MANANA_ID    = "manana";
    private static final String TARDE_ID     = "tarde";
    private static final String NOCHE_ID     = "noche";

    private List<Map<String, Object>> shifts;
    private Map<String, Object> manana;
    private Map<String, Object> tarde;
    private Map<String, Object> noche;

    @BeforeEach
    void setUp() {
        grouper = new TasSessionGrouper();

        manana = new LinkedHashMap<>();
        manana.put("id", MANANA_ID);
        manana.put("name", "Manana");
        manana.put("startTime", "07:00");
        manana.put("endTime", "15:00");
        manana.put("crossMidnight", false);

        tarde = new LinkedHashMap<>();
        tarde.put("id", TARDE_ID);
        tarde.put("name", "Tarde");
        tarde.put("startTime", "15:00");
        tarde.put("endTime", "23:00");
        tarde.put("crossMidnight", false);

        noche = new LinkedHashMap<>();
        noche.put("id", NOCHE_ID);
        noche.put("name", "Noche");
        noche.put("startTime", "19:00");
        noche.put("endTime", "07:00");
        noche.put("crossMidnight", true);

        shifts = List.of(manana, tarde, noche);
    }

    private TasScanRecord scan(String empId, LocalDateTime ts) {
        TasScanRecord r = new TasScanRecord();
        r.setEmployeeId(empId);
        r.setEmployeeName("Test " + empId);
        r.setTimestamp(ts);
        return r;
    }

    private Map<String, String> assignManana(String... empIds) {
        Map<String, String> map = new LinkedHashMap<>();
        for (String id : empIds) map.put(id, MANANA_ID);
        return map;
    }

    private Map<String, String> assignNoche(String... empIds) {
        Map<String, String> map = new LinkedHashMap<>();
        for (String id : empIds) map.put(id, NOCHE_ID);
        return map;
    }

    @Test
    void group_singleSession_createdForMananaEmployee() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 12, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 15, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getEmployeeId()).isEqualTo("100");
        assertThat(s.getScans()).hasSize(3);
        assertThat(s.getMatchedShiftId()).isEqualTo(MANANA_ID);
        assertThat(s.getFlags()).isEmpty();
    }

    @Test
    void group_deduplication_removesConsecutiveScansWithin5Minutes() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 2)),
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 4)),
            scan("100", LocalDateTime.of(2026, 3, 10, 15, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getScans()).hasSize(2);
    }

    @Test
    void group_crossMidnightSession_stitchedCorrectly() {
        List<TasScanRecord> scans = List.of(
            scan("300", LocalDateTime.of(2026, 3, 10, 19, 3)),
            scan("300", LocalDateTime.of(2026, 3, 10, 22, 30)),
            scan("300", LocalDateTime.of(2026, 3, 11, 2, 15)),
            scan("300", LocalDateTime.of(2026, 3, 11, 7, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignNoche("300"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getScans()).hasSize(4);
        assertThat(s.isCrossMidnight()).isTrue();
        assertThat(s.getLastScan()).isEqualTo(LocalDateTime.of(2026, 3, 11, 7, 0));
    }

    @Test
    void group_crossMidnightEmployee_nextNocheOpensNewSession() {
        List<TasScanRecord> scans = List.of(
            scan("300", LocalDateTime.of(2026, 3, 10, 19, 3)),
            scan("300", LocalDateTime.of(2026, 3, 11, 7, 0)),
            scan("300", LocalDateTime.of(2026, 3, 11, 19, 5))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignNoche("300"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(1).getScans()).hasSize(1);
    }

    @Test
    void group_shiftMismatch_flaggedWhenScanNotInAssignedWindow() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 15, 5))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.SHIFT_MISMATCH);
        assertThat(sessions.get(0).getMatchedShiftId()).isEqualTo(TARDE_ID);
    }

    @Test
    void group_manana_exitJustAfterShiftEnd_producesOneSession() {
        // 15:05 is after Mañana ends (15:00) but within the end-time tolerance [15:00, 15:10].
        // Previously this incorrectly opened a new Tarde session. Corrected behavior: one session.
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 15, 5))
        );

        Map<String, String> assignments = new LinkedHashMap<>();
        assignments.put("100", MANANA_ID);

        List<TasSession> sessions = grouper.group(scans, shifts, assignments);

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getMatchedShiftId()).isEqualTo(MANANA_ID);
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(0).getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE, TasFlag.SHIFT_MISMATCH);
    }

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
    void group_twoAmbiguousSessionsSameDay_notFlaggedSameDayDouble() {
        // Both sessions are AMBIGUOUS_SHIFT (no matched shift), so there's no way to
        // tell they represent distinct shifts - likely a single shift split by the
        // ambiguous-session span/day-boundary rules. Should not be flagged as a double.
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 0, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 12, 30))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT);
        assertThat(sessions.get(0).getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE);
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT);
        assertThat(sessions.get(1).getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE);
        assertThat(sessions.get(1).getMatchedShiftId()).isNull();
    }

    @Test
    void group_employeeWithNoScans_producesNoSessions() {
        List<TasScanRecord> scans = Collections.emptyList();

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).isEmpty();
    }

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

    @Test
    void group_sessionIds_assignedSequentially() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("200", LocalDateTime.of(2026, 3, 10, 7, 5))
        );
        Map<String, String> assignments = Map.of("100", MANANA_ID, "200", MANANA_ID);

        List<TasSession> sessions = grouper.group(scans, shifts, assignments);

        assertThat(sessions).hasSize(2);
        Set<Integer> ids = new HashSet<>();
        for (TasSession s : sessions) ids.add(s.getSessionId());
        assertThat(ids).hasSize(2);
    }

    @Test
    void group_detectionWindow_scanAtWindowStartAccepted() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 6, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getMatchedShiftId()).isEqualTo(MANANA_ID);
    }

    @Test
    void group_employeeNameCopiedFromFirstScan() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 15, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getEmployeeName()).isEqualTo("Test 100");
    }

    @Test
    void group_detectionWindow_scanAtWindowEndAccepted() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 10))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getMatchedShiftId()).isEqualTo(MANANA_ID);
    }

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
    void group_nocheShiftWithWiderAfterWindow_matchesLateEntryAsOpener() {
        Map<String, Object> nocheWide = new HashMap<>(noche);
        nocheWide.put("detectionAfterMinutes", 50);

        List<Map<String, Object>> shiftsWithWideNoche = List.of(manana, tarde, nocheWide);

        List<TasScanRecord> scans = List.of(
            scan("EMP1", LocalDateTime.of(2026, 3, 26, 19, 19))
        );

        List<TasSession> sessions = grouper.group(scans, shiftsWithWideNoche, assignNoche("EMP1"));

        assertThat(sessions).hasSize(1);
        TasSession session = sessions.get(0);
        assertThat(session.getMatchedShiftId()).isEqualTo(NOCHE_ID);
        assertThat(session.getFlags()).doesNotContain(TasFlag.AMBIGUOUS_SHIFT);
    }

    @Test
    void group_mananaShiftWithWiderBeforeWindow_matchesEarlyEntryAsOpener() {
        Map<String, Object> mananaWide = new HashMap<>(manana);
        mananaWide.put("detectionBeforeMinutes", 90);

        List<Map<String, Object>> shiftsWithWideManana = List.of(mananaWide, tarde, noche);

        // 05:45 is outside the default 60-min before window (06:00-07:10)
        // but within the widened 90-min window (05:30-07:10).
        List<TasScanRecord> scans = List.of(
            scan("EMP1", LocalDateTime.of(2026, 3, 10, 5, 45))
        );

        List<TasSession> sessions = grouper.group(scans, shiftsWithWideManana, assignManana("EMP1"));

        assertThat(sessions).hasSize(1);
        TasSession session = sessions.get(0);
        assertThat(session.getMatchedShiftId()).isEqualTo(MANANA_ID);
        assertThat(session.getFlags()).doesNotContain(TasFlag.AMBIGUOUS_SHIFT);
    }

    @Test
    void group_detectionAfterMinutesAsNonNumber_fallsBackToDefault() {
        Map<String, Object> nocheNonNumber = new HashMap<>(noche);
        nocheNonNumber.put("detectionAfterMinutes", "50");

        List<Map<String, Object>> shiftsWithNonNumberNoche = List.of(manana, tarde, nocheNonNumber);

        // 19:19 would be within a 50-min after window (19:00-19:50) if the String
        // were honored, but falls outside the default 10-min window (19:00-19:10),
        // so the fallback constant should apply and leave this session ambiguous.
        List<TasScanRecord> scans = List.of(
            scan("EMP1", LocalDateTime.of(2026, 3, 26, 19, 19))
        );

        List<TasSession> sessions = grouper.group(scans, shiftsWithNonNumberNoche, assignNoche("EMP1"));

        assertThat(sessions).hasSize(1);
        TasSession session = sessions.get(0);
        assertThat(session.getMatchedShiftId()).isNull();
        assertThat(session.getFlags()).contains(TasFlag.AMBIGUOUS_SHIFT);
    }

    @Test
    void openSession_noMismatch_assignedAndMatchedShiftNamesMatch() {
        List<TasScanRecord> scans = List.of(
                scan("E1", LocalDateTime.of(2026, 3, 10, 7, 3)),
                scan("E1", LocalDateTime.of(2026, 3, 10, 14, 55))
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

    @Test
    void group_manana_normalExitWithinEndTolerance_producesOneCleanSession() {
        // Repro: employee 242 (Donis Reyes), Mar 3 2026 — 06:58 in, 15:05 out.
        // 15:05 falls inside Tarde's detection window [14:00, 15:10] which previously
        // caused a false Tarde opener. After the fix, 15:05 is within Mañana's own
        // end-time tolerance [15:00, 15:10] and must be treated as the exit scan.
        List<TasScanRecord> scans = List.of(
            scan("242", LocalDateTime.of(2026, 3, 3, 6, 58)),
            scan("242", LocalDateTime.of(2026, 3, 3, 15, 5))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("242"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getMatchedShiftId()).isEqualTo(MANANA_ID);
        assertThat(s.getScans()).hasSize(2);
        assertThat(s.getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE, TasFlag.SHIFT_MISMATCH);
    }

    @Test
    void group_manana_exitAtExactEndTolerance_producesOneSession() {
        // 15:10 is the last second of Mañana's end-time tolerance (detectionAfterMinutes=10).
        // Must be treated as exit, not new opener.
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 15, 10))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(0).getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE, TasFlag.SHIFT_MISMATCH);
    }
}
