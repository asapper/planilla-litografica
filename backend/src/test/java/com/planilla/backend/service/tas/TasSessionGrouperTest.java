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

    @BeforeEach
    void setUp() {
        grouper = new TasSessionGrouper();

        Map<String, Object> manana = new LinkedHashMap<>();
        manana.put("id", MANANA_ID);
        manana.put("name", "Manana");
        manana.put("start_time", "07:00");
        manana.put("end_time", "15:00");
        manana.put("cross_midnight", false);

        Map<String, Object> tarde = new LinkedHashMap<>();
        tarde.put("id", TARDE_ID);
        tarde.put("name", "Tarde");
        tarde.put("start_time", "15:00");
        tarde.put("end_time", "23:00");
        tarde.put("cross_midnight", false);

        Map<String, Object> noche = new LinkedHashMap<>();
        noche.put("id", NOCHE_ID);
        noche.put("name", "Noche");
        noche.put("start_time", "19:00");
        noche.put("end_time", "07:00");
        noche.put("cross_midnight", true);

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
    void group_sameDayDouble_flaggedWhenTwoWindowHitsOnSameDay() {
        List<TasScanRecord> scans = List.of(
            scan("100", LocalDateTime.of(2026, 3, 10, 7, 0)),
            scan("100", LocalDateTime.of(2026, 3, 10, 15, 5))
        );

        Map<String, String> assignments = new LinkedHashMap<>();
        assignments.put("100", MANANA_ID);

        List<TasSession> sessions = grouper.group(scans, shifts, assignments);

        assertThat(sessions).hasSize(2);
        assertThat(sessions.get(0).getFlags()).contains(TasFlag.SAME_DAY_DOUBLE);
        assertThat(sessions.get(1).getFlags()).contains(TasFlag.SAME_DAY_DOUBLE);
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
}
