package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

import static org.mockito.Mockito.*;

import static org.assertj.core.api.Assertions.*;

@ExtendWith(MockitoExtension.class)
class TasSessionGrouperTest {

    @Mock
    private AppConfigService appConfigService;

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
        when(appConfigService.getMaxSessionSpanMinutes()).thenReturn(780);
        grouper = new TasSessionGrouper(appConfigService);

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
        noche.put("detectionAfterMinutes", 50); // matches production seed-shifts.sql

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
    void group_noche_exitJustOutsideMananaWindow_closesSessionAndStartsNext() {
        // Repro: Francisco Daniel (291), Mar 2→3 2026.
        // Noche endTime=07:00 with detectionAfterMinutes=50 → tolerance [07:00, 07:50].
        // A 07:11 exit falls 1 minute outside Mañana's window [06:00, 07:10], so
        // isNextShiftExitScan's "other shift" loop misses it. The new end-time-tolerance
        // branch must catch it and close the Noche session so the 19:15 scan opens a fresh one.
        List<TasScanRecord> scans = List.of(
            scan("300", LocalDateTime.of(2026, 3, 2, 19, 24)),
            scan("300", LocalDateTime.of(2026, 3, 3, 7, 11)),
            scan("300", LocalDateTime.of(2026, 3, 3, 19, 15)),
            scan("300", LocalDateTime.of(2026, 3, 4, 6, 24))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignNoche("300"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getDate()).isEqualTo(LocalDate.of(2026, 3, 2));
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(1).getDate()).isEqualTo(LocalDate.of(2026, 3, 3));
        assertThat(sessions.get(1).getScans()).hasSize(2);
    }

    @Test
    void group_noche_exitAtExactEndTolerance_closesSession() {
        // 07:50 is the last minute of Noche's end-time tolerance (07:00 + 50 min).
        // Must be treated as an exit, closing the session with 2 scans.
        List<TasScanRecord> scans = List.of(
            scan("300", LocalDateTime.of(2026, 3, 2, 19, 0)),
            scan("300", LocalDateTime.of(2026, 3, 3, 7, 50))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignNoche("300"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(0).getLastScan()).isEqualTo(LocalDateTime.of(2026, 3, 3, 7, 50));
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
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.BEST_FIT_SHIFT, TasFlag.SAME_DAY_DOUBLE);
        assertThat(sessions.get(1).getMatchedShiftId()).isEqualTo(TARDE_ID);
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.SAME_DAY_DOUBLE);
    }

    @Test
    void group_twoBestFitSessionsSameDay_notFlaggedSameDayDouble() {
        // Both sessions have BEST_FIT_SHIFT flag. detectSameDayDouble treats them
        // as "ambiguous" (excluded from matchedShiftIds), so two best-fit sessions
        // alone cannot trigger SAME_DAY_DOUBLE — they may just be a split artifact.
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 0, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 12, 30))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.BEST_FIT_SHIFT);
        assertThat(sessions.get(0).getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE);
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.BEST_FIT_SHIFT);
        assertThat(sessions.get(1).getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE);
    }

    @Test
    void group_employeeWithNoScans_producesNoSessions() {
        List<TasScanRecord> scans = Collections.emptyList();

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).isEmpty();
    }

    @Test
    void group_scanOutsideAllWindows_createsBestFitSession() {
        // 11:30 is closest to Tarde (15:00, 3.5h away) vs Manana (07:00, 4.5h away)
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 11, 30))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getMatchedShiftId()).isEqualTo(TARDE_ID);
        assertThat(s.getFlags()).containsExactly(TasFlag.BEST_FIT_SHIFT);
        assertThat(s.getScans()).containsExactly(LocalDateTime.of(2026, 3, 10, 11, 30));
    }

    @Test
    void group_scanOutsideAllWindows_assignsBestFitShift() {
        // 09:00 is closest to Manana (07:00, 2h away) vs Tarde (15:00, 6h away)
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 9, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 19, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getMatchedShiftId()).isEqualTo(MANANA_ID);
        assertThat(s.getFlags()).containsExactly(TasFlag.BEST_FIT_SHIFT);
    }

    @Test
    void group_scanOutsideAllWindows_bestFitHandlesMidnightWrapAround() {
        // 23:30 is closest to Noche (19:00, 4.5h away) not Manana (07:00, 7.5h away)
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 23, 30))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getMatchedShiftId()).isEqualTo(NOCHE_ID);
        assertThat(sessions.get(0).getFlags()).containsExactly(TasFlag.BEST_FIT_SHIFT);
    }

    @Test
    void group_bestFitSession_accumulatesSameDayScans() {
        List<TasScanRecord> scans = List.of(
            scan("134", LocalDateTime.of(2026, 4, 30, 8, 51)),
            scan("134", LocalDateTime.of(2026, 4, 30, 19, 11))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("134"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getMatchedShiftId()).isEqualTo(MANANA_ID);
        assertThat(s.getFlags()).containsExactly(TasFlag.BEST_FIT_SHIFT);
        assertThat(s.getScans()).containsExactly(
            LocalDateTime.of(2026, 4, 30, 8, 51),
            LocalDateTime.of(2026, 4, 30, 19, 11)
        );
    }

    @Test
    void group_bestFitSession_splitsAcrossCalendarDays() {
        List<TasScanRecord> scans = List.of(
            scan("134", LocalDateTime.of(2026, 4, 30, 8, 51)),
            scan("134", LocalDateTime.of(2026, 4, 30, 19, 11)),
            scan("134", LocalDateTime.of(2026, 5, 1, 9, 2))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("134"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getDate()).isEqualTo(LocalDate.of(2026, 4, 30));
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.BEST_FIT_SHIFT);
        assertThat(sessions.get(1).getDate()).isEqualTo(LocalDate.of(2026, 5, 1));
        assertThat(sessions.get(1).getScans()).containsExactly(LocalDateTime.of(2026, 5, 1, 9, 2));
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.BEST_FIT_SHIFT);
    }

    @Test
    void group_bestFitSession_splitsWhenSpanExceeds12Hours() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 8, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 21, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getScans()).containsExactly(LocalDateTime.of(2026, 3, 10, 8, 0));
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.BEST_FIT_SHIFT);
        assertThat(sessions.get(1).getScans()).containsExactly(LocalDateTime.of(2026, 3, 10, 21, 0));
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.BEST_FIT_SHIFT);
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
    void group_bestFitScansAcrossMidnight_splitsAtDayBoundary_knownLimitation() {
        // Known limitation: an overnight stretch of scans that matches no shift window
        // is split into two single-scan best-fit sessions at the calendar-day boundary,
        // instead of one continuous cross-midnight session.
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 23, 0)),
            scan("100", LocalDateTime.of(2026, 3, 11, 1, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getDate()).isEqualTo(LocalDate.of(2026, 3, 10));
        assertThat(sessions.get(0).getScans()).containsExactly(LocalDateTime.of(2026, 3, 10, 23, 0));
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.BEST_FIT_SHIFT);
        assertThat(sessions.get(1).getDate()).isEqualTo(LocalDate.of(2026, 3, 11));
        assertThat(sessions.get(1).getScans()).containsExactly(LocalDateTime.of(2026, 3, 11, 1, 0));
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.BEST_FIT_SHIFT);
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
        assertThat(session.getFlags()).doesNotContain(TasFlag.BEST_FIT_SHIFT);
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
        assertThat(session.getFlags()).doesNotContain(TasFlag.BEST_FIT_SHIFT);
    }

    @Test
    void group_detectionAfterMinutesAsNonNumber_fallsBackToDefault() {
        Map<String, Object> nocheNonNumber = new HashMap<>(noche);
        nocheNonNumber.put("detectionAfterMinutes", "50");

        List<Map<String, Object>> shiftsWithNonNumberNoche = List.of(manana, tarde, nocheNonNumber);

        // 19:19 would be within a 50-min after window (19:00-19:50) if the String
        // were honored, but falls outside the default 10-min window (19:00-19:10),
        // so the fallback constant should apply and use best-fit matching instead.
        List<TasScanRecord> scans = List.of(
            scan("EMP1", LocalDateTime.of(2026, 3, 26, 19, 19))
        );

        List<TasSession> sessions = grouper.group(scans, shiftsWithNonNumberNoche, assignNoche("EMP1"));

        assertThat(sessions).hasSize(1);
        TasSession session = sessions.get(0);
        assertThat(session.getMatchedShiftId()).isEqualTo(NOCHE_ID);
        assertThat(session.getFlags()).contains(TasFlag.BEST_FIT_SHIFT);
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
        // 15:10 is the last minute of Mañana's end-time tolerance (detectionAfterMinutes=10).
        // Must be treated as exit, not new opener.
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 15, 10))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getMatchedShiftId()).isEqualTo(MANANA_ID);
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(0).getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE, TasFlag.SHIFT_MISMATCH);
    }

    @Test
    void group_manana_overtimeExitInNocheWindow_producesOneSession() {
        // Repro: Ajuchan Yos Francisco Daniel (291), Mar 4 2026 — 06:24 in, 19:06 out.
        // 19:06 falls in Noche's detection window [18:00, 19:50]. A day-shift employee's
        // overtime exit must not open a cross-midnight shift session.
        List<TasScanRecord> scans = List.of(
            scan("291", LocalDateTime.of(2026, 3, 4, 6, 24)),
            scan("291", LocalDateTime.of(2026, 3, 4, 19, 6))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("291"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getMatchedShiftId()).isEqualTo(MANANA_ID);
        assertThat(s.getScans()).hasSize(2);
        assertThat(s.getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE, TasFlag.SHIFT_MISMATCH);
    }

    @Test
    void group_manana_firstScanInNocheWindow_matchesNocheAsSubstitution() {
        // A Mañana employee whose only scan of the day falls in Noche's opener window
        // is genuinely substituting on Noche — the opener call must still match Noche
        // and produce SHIFT_MISMATCH (not AMBIGUOUS_SHIFT). Only the split-mode call
        // excludes cross-midnight shifts, not the initial opener call.
        List<TasScanRecord> scans = List.of(
            scan("291", LocalDateTime.of(2026, 3, 4, 19, 6))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("291"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getMatchedShiftId()).isEqualTo(NOCHE_ID);
        assertThat(s.getFlags()).contains(TasFlag.SHIFT_MISMATCH);
        assertThat(s.getFlags()).doesNotContain(TasFlag.BEST_FIT_SHIFT);
    }

    @Test
    void group_unassignedEmployee_firstScanInNocheWindow_matchesNoche() {
        // An employee with no shift assignment scanning at 19:06 should still be
        // matched to Noche by window detection (opener call, excludeCrossMidnight=false).
        List<TasScanRecord> scans = List.of(
            scan("999", LocalDateTime.of(2026, 3, 4, 19, 6))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, Map.of());

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getMatchedShiftId()).isEqualTo(NOCHE_ID);
        assertThat(sessions.get(0).getFlags()).doesNotContain(TasFlag.BEST_FIT_SHIFT);
    }

    @Test
    void group_manana_exitWithinTolerance_nextDayStartsNewSession() {
        // Regression: once a session has entry+exit (size>1), subsequent scans from the
        // next day were absorbed because the size==1 gate was false and no other day-boundary
        // check existed for matched sessions. All of March ended up in the March 3rd session.
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 3, 6, 58)),
            scan("100", LocalDateTime.of(2026, 3, 3, 15, 5)),
            scan("100", LocalDateTime.of(2026, 3, 4, 6, 44)),
            scan("100", LocalDateTime.of(2026, 3, 4, 15, 2))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getDate()).isEqualTo(LocalDate.of(2026, 3, 3));
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(1).getDate()).isEqualTo(LocalDate.of(2026, 3, 4));
        assertThat(sessions.get(1).getScans()).hasSize(2);
    }

    @Test
    void group_longSessionWithinSpan_absorbsExitInsteadOfSplitting() {
        // Repro: 12-hour shift employee. Entry 07:00 (matched Mañana), exit 19:00 (span=720 min)
        // falls inside a custom non-cross-midnight "evening" shift's opener window [18:00-19:10].
        // With default maxSessionSpanMinutes=780, 720 ≤ 780 so the span guard blocks the split.
        // Result: 1 session with 2 scans, no SAME_DAY_DOUBLE.
        Map<String, Object> evening = new LinkedHashMap<>();
        evening.put("id", "evening");
        evening.put("name", "Evening");
        evening.put("startTime", "19:00");
        evening.put("endTime", "03:00");
        evening.put("crossMidnight", false); // non-cross-midnight so excludeCrossMidnight won't skip it

        List<Map<String, Object>> shiftsWithEvening = List.of(manana, tarde, noche, evening);

        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 19, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shiftsWithEvening, assignManana("100"));

        assertThat(sessions).hasSize(1);
        TasSession s = sessions.get(0);
        assertThat(s.getMatchedShiftId()).isEqualTo(MANANA_ID);
        assertThat(s.getScans()).hasSize(2);
        assertThat(s.getFlags()).doesNotContain(TasFlag.SAME_DAY_DOUBLE);
    }

    @Test
    void group_spanExceedsMax_splitsIntoTwoSessions() {
        // Same setup as above but maxSessionSpanMinutes set to 600 (10h).
        // Span of 720 min exceeds 600, so the exit scan opens a new evening session.
        when(appConfigService.getMaxSessionSpanMinutes()).thenReturn(600);
        grouper = new TasSessionGrouper(appConfigService);

        Map<String, Object> evening = new LinkedHashMap<>();
        evening.put("id", "evening");
        evening.put("name", "Evening");
        evening.put("startTime", "19:00");
        evening.put("endTime", "03:00");
        evening.put("crossMidnight", false);

        List<Map<String, Object>> shiftsWithEvening = List.of(manana, tarde, noche, evening);

        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 19, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shiftsWithEvening, assignManana("100"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getScans()).hasSize(1);
        assertThat(sessions.get(1).getScans()).hasSize(1);
    }

    @Test
    void group_noche_loneScanFollowedByMultiDayGap_splitsInsteadOfAbsorbing() {
        // Repro: Daniel Morales (134), Noche employee — lone entry at 19:20 on April 1,
        // no exit scan, then next scans 6 days later on April 7. Without the max-span
        // guard, all subsequent scans were absorbed into the April 1 session, producing
        // workedHours=133.5 and doblesMinutes=7741.
        List<TasScanRecord> scans = List.of(
            scan("134", LocalDateTime.of(2026, 4, 1, 19, 20)),
            scan("134", LocalDateTime.of(2026, 4, 7, 9, 1)),
            scan("134", LocalDateTime.of(2026, 4, 7, 19, 26))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignNoche("134"));

        assertThat(sessions).hasSize(2);
        TasSession first = sessions.get(0);
        assertThat(first.getDate()).isEqualTo(LocalDate.of(2026, 4, 1));
        assertThat(first.getScans()).hasSize(1);

        TasSession second = sessions.get(1);
        assertThat(second.getDate()).isEqualTo(LocalDate.of(2026, 4, 7));
        assertThat(second.getScans()).hasSize(2);
    }

    @Test
    void group_noche_multiDayGap_eachScanGetsOwnSession() {
        // Two scans separated by a multi-day gap must produce two single-scan
        // sessions, preventing the downstream hours calculator from computing
        // a span of thousands of minutes.
        List<TasScanRecord> scans = List.of(
            scan("134", LocalDateTime.of(2026, 4, 1, 19, 20)),
            scan("134", LocalDateTime.of(2026, 4, 7, 9, 1))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignNoche("134"));

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getScans()).hasSize(1);
        assertThat(sessions.get(0).getDate()).isEqualTo(LocalDate.of(2026, 4, 1));
        assertThat(sessions.get(1).getScans()).hasSize(1);
        assertThat(sessions.get(1).getDate()).isEqualTo(LocalDate.of(2026, 4, 7));
    }

    @Test
    void group_noche_spanAtExactMax_doesNotSplit() {
        // A session spanning exactly maxSessionSpanMinutes (780) must NOT be
        // split — the guard uses strict greater-than.
        // 780 min = 13h: entry at 19:00, exit 13h later at 08:00 next day.
        List<TasScanRecord> scans = List.of(
            scan("300", LocalDateTime.of(2026, 3, 10, 19, 0)),
            scan("300", LocalDateTime.of(2026, 3, 11, 8, 0))
        );

        List<TasSession> sessions = grouper.group(scans, shifts, assignNoche("300"));

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).getScans()).hasSize(2);
    }

}
