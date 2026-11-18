package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasPeriod;
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
    @Mock EmployeeRegistryService employeeRegistryService;

    TasReportBuilder builder;

    private List<Map<String, Object>> shifts;

    @BeforeEach
    void setUp() {
        builder = new TasReportBuilder(holidayService, employeeRegistryService);
        lenient().when(holidayService.isHoliday(any())).thenReturn(false);
        lenient().when(employeeRegistryService.getAccruesOvertimeFlags(any())).thenReturn(Map.of());

        Map<String, Object> manana = new LinkedHashMap<>();
        manana.put("id", "manana");
        manana.put("name", "Manana");
        manana.put("startTime", "07:00");
        manana.put("endTime", "15:00");
        manana.put("crossMidnight", false);
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
        assertThat(row.getHorasExtrasSimples()).isEqualTo(Math.floor(960 / 30.0) / 2.0);
        assertThat(row.getHorasExtrasDobles()).isEqualTo(Math.floor(60 / 30.0) / 2.0);
    }

    @Test
    void build_roundsEachSessionToTheHalfHourThenSums() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        // 225 min floors to 3.5h per session, so two sessions total 7.0 —
        // not floor(450 / 30) / 2 = 7.5 that a sum-then-floor would give.
        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 5), 225, 0),
            resolvedSession("100", LocalDate.of(2026, 3, 6), 225, 0)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getHorasExtrasSimples()).isEqualTo(7.0);
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
    void build_employeeNamePopulatedFromSession() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        TasSession s = resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0);
        s.setEmployeeName("Juan Perez");

        TasReportBuilder.BuildResult result = builder.build(List.of(s), start, end, shifts);

        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getNombreEmpleado()).isEqualTo("Juan Perez");
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

    @Test
    void build_diasTurnoEstimado_countsDistinctBestFitDaysPerEmployeeQuincena() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        TasSession bestFit = resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 0);
        bestFit.setMatchedShiftId("manana");
        bestFit.setFlags(new ArrayList<>(List.of(TasFlag.BEST_FIT_SHIFT)));

        TasSession normal = resolvedSession("100", LocalDate.of(2026, 3, 6), 480, 0);

        TasReportBuilder.BuildResult result = builder.build(List.of(bestFit, normal), start, end, shifts);

        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getDiasTurnoEstimado()).isEqualTo(1);
    }

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
    void build_employeeDoesNotAccrueOvertime_zeroesSimplesAndDobles() {
        LocalDate start = LocalDate.of(2026, 3, 1);
        LocalDate end   = LocalDate.of(2026, 3, 15);

        when(employeeRegistryService.getAccruesOvertimeFlags(any())).thenReturn(Map.of("100", false));

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

        when(employeeRegistryService.getAccruesOvertimeFlags(any())).thenReturn(Map.of("100", true));

        List<TasSession> sessions = List.of(
            resolvedSession("100", LocalDate.of(2026, 3, 5), 480, 60)
        );

        TasReportBuilder.BuildResult result = builder.build(sessions, start, end, shifts);

        EmployeeRow row = result.rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isEqualTo(8);
        assertThat(row.getHorasExtrasDobles()).isEqualTo(1);
        assertThat(row.isAccruesOvertime()).isTrue();
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

    // ── findIncompletePeriods ──────────────────────────────────────────────

    @Test
    void findIncompletePeriods_fileEndsBeforeQuincena_listsMissingWorkingDaysSkippingSundays() {
        // Live case: data 28 Sep – 11 Oct 2026 (Sunday), Q1 October runs to the 15th.
        List<TasReportBuilder.PeriodCoverage> result = builder.findIncompletePeriods(
                LocalDate.of(2026, 9, 28), LocalDate.of(2026, 10, 11), List.of(new TasPeriod(2026, 10, 1)));

        assertThat(result).hasSize(1);
        TasReportBuilder.PeriodCoverage c = result.get(0);
        assertThat(c.period()).isEqualTo(new TasPeriod(2026, 10, 1));
        assertThat(c.periodStart()).isEqualTo(LocalDate.of(2026, 10, 1));
        assertThat(c.periodEnd()).isEqualTo(LocalDate.of(2026, 10, 15));
        assertThat(c.dataStart()).isEqualTo(LocalDate.of(2026, 9, 28));
        assertThat(c.dataEnd()).isEqualTo(LocalDate.of(2026, 10, 11));
        assertThat(c.missingWorkingDays()).containsExactly(
                LocalDate.of(2026, 10, 12), LocalDate.of(2026, 10, 13),
                LocalDate.of(2026, 10, 14), LocalDate.of(2026, 10, 15));
    }

    @Test
    void findIncompletePeriods_fileStartsLate_listsLeadingDays() {
        // 2026-03-01 is a Sunday.
        List<TasReportBuilder.PeriodCoverage> result = builder.findIncompletePeriods(
                LocalDate.of(2026, 3, 4), LocalDate.of(2026, 3, 15), List.of(new TasPeriod(2026, 3, 1)));

        assertThat(result).singleElement()
                .extracting(TasReportBuilder.PeriodCoverage::missingWorkingDays)
                .isEqualTo(List.of(LocalDate.of(2026, 3, 2), LocalDate.of(2026, 3, 3)));
    }

    @Test
    void findIncompletePeriods_missingDaysAreOnlyHolidaysOrSundays_isComplete() {
        LocalDate holiday = LocalDate.of(2026, 10, 15);
        when(holidayService.isHoliday(holiday)).thenReturn(true);

        // Data ends Wed 14 Oct; the 15th is a holiday, so nothing is lost.
        assertThat(builder.findIncompletePeriods(
                LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 14), List.of(new TasPeriod(2026, 10, 1))))
                .isEmpty();
    }

    @Test
    void findIncompletePeriods_fullCoverage_isEmpty() {
        assertThat(builder.findIncompletePeriods(
                LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 15), List.of(new TasPeriod(2026, 10, 1))))
                .isEmpty();
    }

    @Test
    void findIncompletePeriods_secondQuincenaEndsAtMonthEnd_includingLeapFebruary() {
        // 2028-02-29 is a Tuesday; data stops on the 28th.
        assertThat(builder.findIncompletePeriods(
                LocalDate.of(2028, 2, 16), LocalDate.of(2028, 2, 28), List.of(new TasPeriod(2028, 2, 2))))
                .singleElement()
                .satisfies(c -> {
                    assertThat(c.periodEnd()).isEqualTo(LocalDate.of(2028, 2, 29));
                    assertThat(c.missingWorkingDays()).containsExactly(LocalDate.of(2028, 2, 29));
                });
    }

    @Test
    void findIncompletePeriods_severalPeriods_dedupesAndSortsAndKeepsOnlyIncomplete() {
        TasPeriod oct1 = new TasPeriod(2026, 10, 1);
        TasPeriod sep2 = new TasPeriod(2026, 9, 2);

        List<TasReportBuilder.PeriodCoverage> result = builder.findIncompletePeriods(
                LocalDate.of(2026, 9, 28), LocalDate.of(2026, 10, 15), List.of(oct1, sep2, oct1));

        assertThat(result).extracting(TasReportBuilder.PeriodCoverage::period).containsExactly(sep2);
        // 16–27 Sep 2026 minus Sundays 20 and 27.
        assertThat(result.get(0).missingWorkingDays()).hasSize(10)
                .doesNotContain(LocalDate.of(2026, 9, 20), LocalDate.of(2026, 9, 27));
    }

    @Test
    void findIncompletePeriods_nullInputs_isEmpty() {
        TasPeriod p = new TasPeriod(2026, 10, 1);
        assertThat(builder.findIncompletePeriods(null, LocalDate.of(2026, 10, 15), List.of(p))).isEmpty();
        assertThat(builder.findIncompletePeriods(LocalDate.of(2026, 10, 1), null, List.of(p))).isEmpty();
        assertThat(builder.findIncompletePeriods(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 15), null)).isEmpty();
    }

    @Test
    void findIncompletePeriods_warnedDaysEqualDaysDockedFromFullAttendanceEmployee() {
        LocalDate holiday = LocalDate.of(2026, 10, 14);
        when(holidayService.isHoliday(holiday)).thenReturn(true);
        LocalDate dataStart = LocalDate.of(2026, 10, 1);
        LocalDate dataEnd = LocalDate.of(2026, 10, 11);
        List<TasSession> sessions = new ArrayList<>();
        for (LocalDate d = dataStart; !d.isAfter(dataEnd); d = d.plusDays(1)) {
            sessions.add(resolvedSession("100", d, 0, 0));
        }

        EmployeeRow row = builder.build(sessions, dataStart, dataEnd, shifts, new TasPeriod(2026, 10, 1)).rows.get(0);
        List<TasReportBuilder.PeriodCoverage> gaps =
                builder.findIncompletePeriods(dataStart, dataEnd, List.of(new TasPeriod(2026, 10, 1)));

        assertThat(gaps).singleElement()
                .satisfies(c -> assertThat(c.missingWorkingDays()).hasSize(row.getDiasNoLaborados()));
        assertThat(row.getDiasNoLaborados()).isEqualTo(3);
    }

    private TasSession nightFromTheFifteenth(String empId) {
        TasSession night = resolvedSession(empId, LocalDate.of(2026, 1, 15), 60, 0);
        night.setEmployeeName("Ana");
        night.setEffectiveStart(LocalDate.of(2026, 1, 15).atTime(22, 0));
        night.setLastScan(LocalDate.of(2026, 1, 16).atTime(6, 0));
        night.setScans(List.of(night.getEffectiveStart(), night.getLastScan()));
        return night;
    }

    @Test
    void build_secondFortnight_keepsARowForAnEmployeeWhoseOnlyScanThereIsANightsExit() {
        TasReportBuilder.BuildResult result = builder.build(List.of(nightFromTheFifteenth("E1")),
                LocalDate.of(2026, 1, 16), LocalDate.of(2026, 1, 31), shifts, new TasPeriod(2026, 1, 2));

        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getNombreEmpleado()).isEqualTo("Ana");
        assertThat(result.rows.get(0).getNumeroDequincena()).isEqualTo(2);
        assertThat(result.rows.get(0).getDiasNoLaborados()).isEqualTo(14);
        assertThat(result.rows.get(0).getHorasExtrasSimples()).isZero();
    }

    @Test
    void build_firstFortnight_paysTheNightFromTheFifteenth() {
        TasReportBuilder.BuildResult result = builder.build(List.of(nightFromTheFifteenth("E1")),
                LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 15), shifts, new TasPeriod(2026, 1, 1));

        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getHorasExtrasSimples()).isEqualTo(1.0);
    }

    @Test
    void computeAvailablePeriods_onlyOffersPeriodsTheFileReaches() {
        List<TasSession> sessions = List.of(nightFromTheFifteenth("E1"));
        assertThat(builder.computeAvailablePeriods(sessions, LocalDate.of(2026, 1, 16), LocalDate.of(2026, 1, 31)))
                .containsExactly(new TasPeriod(2026, 1, 2));
        assertThat(builder.computeAvailablePeriods(sessions, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 31)))
                .containsExactly(new TasPeriod(2026, 1, 1), new TasPeriod(2026, 1, 2));
        assertThat(builder.computeAvailablePeriods(sessions, null, null))
                .containsExactly(new TasPeriod(2026, 1, 1), new TasPeriod(2026, 1, 2));
    }
}
