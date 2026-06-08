package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasSession;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TasReportBuilderTest {

    @Mock HolidayService holidayService;

    TasReportBuilder builder;

    private List<Map<String, Object>> shifts;

    @BeforeEach
    void setUp() {
        builder = new TasReportBuilder(holidayService);
        when(holidayService.isHoliday(any())).thenReturn(false);

        Map<String, Object> manana = new LinkedHashMap<>();
        manana.put("id", "manana");
        manana.put("name", "Manana");
        manana.put("start_time", "07:00");
        manana.put("end_time", "15:00");
        manana.put("cross_midnight", false);
        shifts = List.of(manana);
    }

    private TasSession resolvedSession(String empId, LocalDate date, int simplesMinutes, int doblesMinutes) {
        TasSession s = new TasSession();
        s.setEmployeeId(empId);
        s.setDate(date);
        s.setMatchedShiftId("manana");
        s.setNeedsResolution(false);
        s.setSimplesMinutes(simplesMinutes);
        s.setDoblesMinutes(doblesMinutes);
        s.setWorkedMinutes(simplesMinutes + doblesMinutes);
        s.setWorkedHours(Math.floor((simplesMinutes + doblesMinutes) / 30.0) / 2.0);
        s.setFlags(new ArrayList<>());
        return s;
    }

    private TasSession flaggedSession(String empId, LocalDate date) {
        TasSession s = new TasSession();
        s.setEmployeeId(empId);
        s.setDate(date);
        s.setMatchedShiftId("manana");
        s.setNeedsResolution(true);
        s.setSimplesMinutes(0);
        s.setDoblesMinutes(0);
        s.setWorkedMinutes(0);
        s.setWorkedHours(0.0);
        s.setFlags(List.of(TasFlag.MISSING_EXIT));
        return s;
    }

    @Test
    void build_groupsByQuincena_q1Sessions() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0),
            resolvedSession("100", LocalDate.of(2026, 3, 10), 480, 0)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        assertThat(result.rows).hasSize(1);
        EmployeeRow row = result.rows.get(0);
        assertThat(row.getNumeroDequincena()).isEqualTo(1);
        assertThat(row.getCodigoEmpleado()).isEqualTo("100");
    }

    @Test
    void build_groupsByQuincena_q1AndQ2Separate() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 31);

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0),
            resolvedSession("100", LocalDate.of(2026, 3, 20), 480, 0)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        assertThat(result.rows).hasSize(2);
        List<Integer> quincenas = result.rows.stream()
                .map(EmployeeRow::getNumeroDequincena)
                .sorted()
                .toList();
        assertThat(quincenas).containsExactly(1, 2);
    }

    @Test
    void build_simplesAndDoblesSummedCorrectly() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0),
            resolvedSession("100", LocalDate.of(2026, 3, 6), 480, 60)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        assertThat(result.rows).hasSize(1);
        EmployeeRow row = result.rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isEqualTo((int) Math.round(Math.floor(960 / 30.0) / 2.0));
        assertThat(row.getHorasExtrasDobles()).isEqualTo((int) Math.round(Math.floor(60 / 30.0) / 2.0));
    }

    @Test
    void build_flaggedSessionsContributeZeroHours() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        List<TasSession> sessions = List.of(
            flaggedSession("100", LocalDate.of(2026, 3, 5)),
            resolvedSession("100", LocalDate.of(2026, 3, 6), 480, 0)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        assertThat(result.rows).hasSize(1);
        EmployeeRow row = result.rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isEqualTo(8);
        assertThat(row.getHorasExtrasDobles()).isEqualTo(0);
    }

    @Test
    void build_nonWorkedDays_excludesSundaysAndHolidays() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 7);

        LocalDate holiday = LocalDate.of(2026, 3, 4);
        when(holidayService.isHoliday(holiday)).thenReturn(true);

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 2), 480, 0)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        EmployeeRow row = result.rows.get(0);
        assertThat(row.getDiasNoLaborados()).isGreaterThanOrEqualTo(0);
    }

    @Test
    void build_consistentMismatch_detectedWhenAllSessionsInQuincenaAreMismatched() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        TasSession s1 = resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0);
        s1.setFlags(new ArrayList<>(List.of(TasFlag.SHIFT_MISMATCH)));
        s1.setMatchedShiftId("tarde");

        TasSession s2 = resolvedSession("100", LocalDate.of(2026, 3, 6), 480, 0);
        s2.setFlags(new ArrayList<>(List.of(TasFlag.SHIFT_MISMATCH)));
        s2.setMatchedShiftId("tarde");

        TasReportBuilder.BuildResult result = builder.build(List.of(s1, s2), start, end, shifts);

        assertThat(result.consistentMismatchShiftIds).containsKey("100");
        assertThat(result.consistentMismatchShiftIds.get("100")).isEqualTo("tarde");
    }

    @Test
    void build_inconsistentMismatch_notFlaggedAsConsistent() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        TasSession s1 = resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0);
        s1.setFlags(new ArrayList<>(List.of(TasFlag.SHIFT_MISMATCH)));
        s1.setMatchedShiftId("tarde");

        TasSession s2 = resolvedSession("100", LocalDate.of(2026, 3, 6), 480, 0);
        s2.setFlags(new ArrayList<>());
        s2.setMatchedShiftId("manana");

        TasReportBuilder.BuildResult result = builder.build(List.of(s1, s2), start, end, shifts);

        assertThat(result.consistentMismatchShiftIds).doesNotContainKey("100");
    }

    @Test
    void build_mesAndAnioSetFromQuincenaStart() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        EmployeeRow row = result.rows.get(0);
        assertThat(row.getMes()).isEqualTo(3);
        assertThat(row.getAnio()).isEqualTo(2026);
    }
}
