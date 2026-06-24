package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TasUploadServiceTest {

    @Mock TasParserService        parserService;
    @Mock EmployeeRegistryService registryService;
    @Mock HolidayService          holidayService;
    @Mock TasSessionGrouper       sessionGrouper;
    @Mock TasHoursCalculator      hoursCalculator;
    @Mock TasReportBuilder        reportBuilder;
    @Mock ShiftConfigService      shiftConfigService;

    TasUploadService service;

    private MockMultipartFile dummyFile;
    private List<Map<String, Object>> shifts;

    @BeforeEach
    void setUp() {
        service = new TasUploadService(
                parserService, registryService, holidayService,
                sessionGrouper, hoursCalculator, reportBuilder, shiftConfigService);

        dummyFile = new MockMultipartFile("file", "test.csv", "text/csv",
                "dummy".getBytes(StandardCharsets.UTF_8));

        shifts = List.of(Map.of("id", "manana", "name", "Manana",
                "startTime", "07:00", "endTime", "15:00", "crossMidnight", false));
    }

    private TasScanRecord scan(String empId, String ts) {
        TasScanRecord r = new TasScanRecord();
        r.setEmployeeId(empId);
        r.setEmployeeName("Employee " + empId);
        r.setTimestamp(LocalDateTime.parse(ts));
        return r;
    }

    @Test
    void process_inactiveEmployeeFound_returnsEarly() throws Exception {
        List<TasScanRecord> scans = List.of(scan("100", "2026-03-10T07:00"));
        when(parserService.parse(any())).thenReturn(new TasParserService.ParseResult(scans, List.of()));

        TasInactiveEmployee inactive = new TasInactiveEmployee();
        inactive.setEmployeeId("100");
        inactive.setName("Test");
        when(registryService.getInactiveEmployeesPresent(any())).thenReturn(List.of(inactive));

        TasUploadResult result = service.process(dummyFile, Collections.emptySet());

        assertThat(result.getInactiveEmployeesFound()).hasSize(1);
        assertThat(result.getResolvedRows()).isNull();
        verify(sessionGrouper, never()).group(any(), any(), any());
    }

    @Test
    void process_inactiveEmployeeInIgnoredSet_proceedsWithPipeline() throws Exception {
        List<TasScanRecord> scans = List.of(scan("100", "2026-03-10T07:00"));
        when(parserService.parse(any())).thenReturn(new TasParserService.ParseResult(scans, List.of()));

        TasInactiveEmployee inactive = new TasInactiveEmployee();
        inactive.setEmployeeId("100");
        inactive.setName("Test");
        when(registryService.getInactiveEmployeesPresent(any())).thenReturn(List.of(inactive));
        when(registryService.getAll(any(), any(), any())).thenReturn(Collections.emptyList());
        when(shiftConfigService.getAllShifts()).thenReturn(shifts);
        when(holidayService.fetchForDateRange(any(), any())).thenReturn(true);
        when(sessionGrouper.group(any(), any(), any())).thenReturn(Collections.emptyList());
        when(reportBuilder.build(any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(Collections.emptyList()));
        when(registryService.getAbsentActiveEmployees(any())).thenReturn(Collections.emptyList());

        TasUploadResult result = service.process(dummyFile, Set.of("100"));

        assertThat(result.getInactiveEmployeesFound()).isEmpty();
        verify(sessionGrouper).group(any(), any(), any());
    }

    @Test
    void process_fullPipeline_returnsResultWithRows() throws Exception {
        List<TasScanRecord> scans = List.of(scan("100", "2026-03-10T07:00"));
        when(parserService.parse(any())).thenReturn(new TasParserService.ParseResult(scans, List.of()));
        when(registryService.getInactiveEmployeesPresent(any())).thenReturn(Collections.emptyList());
        when(registryService.getAll(any(), any(), any())).thenReturn(Collections.emptyList());
        when(shiftConfigService.getAllShifts()).thenReturn(shifts);
        when(holidayService.fetchForDateRange(any(), any())).thenReturn(true);

        TasSession session = new TasSession();
        session.setEmployeeId("100");
        session.setDate(LocalDate.of(2026, 3, 10));
        session.setNeedsResolution(false);
        session.setFlags(Collections.emptyList());
        when(sessionGrouper.group(any(), any(), any())).thenReturn(List.of(session));

        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        when(reportBuilder.build(any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(List.of(row)));
        when(registryService.getAbsentActiveEmployees(any())).thenReturn(Collections.emptyList());

        TasUploadResult result = service.process(dummyFile, Collections.emptySet());

        assertThat(result.getResolvedRows()).hasSize(1);
        assertThat(result.isUsedFallbackHolidays()).isFalse();
        assertThat(result.getInactiveEmployeesFound()).isEmpty();
        verify(hoursCalculator).calculate(any(), any(), any());
    }

    @Test
    void process_apiFails_setsUsedFallbackHolidays() throws Exception {
        List<TasScanRecord> scans = List.of(scan("100", "2026-03-10T07:00"));
        when(parserService.parse(any())).thenReturn(new TasParserService.ParseResult(scans, List.of()));
        when(registryService.getInactiveEmployeesPresent(any())).thenReturn(Collections.emptyList());
        when(registryService.getAll(any(), any(), any())).thenReturn(Collections.emptyList());
        when(shiftConfigService.getAllShifts()).thenReturn(shifts);
        when(holidayService.fetchForDateRange(any(), any())).thenReturn(false);
        when(sessionGrouper.group(any(), any(), any())).thenReturn(Collections.emptyList());
        when(reportBuilder.build(any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(Collections.emptyList()));
        when(registryService.getAbsentActiveEmployees(any())).thenReturn(Collections.emptyList());

        TasUploadResult result = service.process(dummyFile, Collections.emptySet());

        assertThat(result.isUsedFallbackHolidays()).isTrue();
    }

    @Test
    void processScans_allSessionsAndReportDatesPopulated() {
        List<TasScanRecord> scans = List.of(
            scan("100", "2026-03-05T07:00"),
            scan("100", "2026-03-15T15:00")
        );
        when(registryService.getInactiveEmployeesPresent(any())).thenReturn(Collections.emptyList());
        when(registryService.getAll(any(), any(), any())).thenReturn(Collections.emptyList());
        when(shiftConfigService.getAllShifts()).thenReturn(shifts);
        when(holidayService.fetchForDateRange(any(), any())).thenReturn(true);

        TasSession session = new TasSession();
        session.setEmployeeId("100");
        session.setDate(LocalDate.of(2026, 3, 5));
        session.setNeedsResolution(false);
        session.setFlags(Collections.emptyList());
        when(sessionGrouper.group(any(), any(), any())).thenReturn(List.of(session));
        when(reportBuilder.build(any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(Collections.emptyList()));
        when(registryService.getAbsentActiveEmployees(any())).thenReturn(Collections.emptyList());

        TasUploadResult result = service.processScans(scans, Collections.emptyList(), Collections.emptySet());

        assertThat(result.getAllSessions()).containsExactly(session);
        assertThat(result.getReportStart()).isEqualTo(LocalDate.of(2026, 3, 5));
        assertThat(result.getReportEnd()).isEqualTo(LocalDate.of(2026, 3, 15));
    }

    @Test
    void process_upsertCalledForEachEmployee() throws Exception {
        List<TasScanRecord> scans = List.of(
            scan("100", "2026-03-10T07:00"),
            scan("200", "2026-03-10T07:05")
        );
        when(parserService.parse(any())).thenReturn(new TasParserService.ParseResult(scans, List.of()));
        when(registryService.getInactiveEmployeesPresent(any())).thenReturn(Collections.emptyList());
        when(registryService.getAll(any(), any(), any())).thenReturn(Collections.emptyList());
        when(shiftConfigService.getAllShifts()).thenReturn(shifts);
        when(holidayService.fetchForDateRange(any(), any())).thenReturn(true);
        when(sessionGrouper.group(any(), any(), any())).thenReturn(Collections.emptyList());
        when(reportBuilder.build(any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(Collections.emptyList()));
        when(registryService.getAbsentActiveEmployees(any())).thenReturn(Collections.emptyList());

        service.process(dummyFile, Collections.emptySet());

        verify(registryService).upsertEmployee("100", "Employee 100");
        verify(registryService).upsertEmployee("200", "Employee 200");
    }

    @Test
    void process_consistentShiftMismatch_autoResolvesAndRecomputes() throws Exception {
        List<TasScanRecord> scans = List.of(
            scan("100", "2026-03-10T14:55"),
            scan("100", "2026-03-10T23:00"),
            scan("100", "2026-03-11T14:50"),
            scan("100", "2026-03-11T23:05")
        );
        when(parserService.parse(any())).thenReturn(new TasParserService.ParseResult(scans, List.of()));
        when(registryService.getInactiveEmployeesPresent(any())).thenReturn(Collections.emptyList());
        when(registryService.getAll(any(), any(), any())).thenReturn(Collections.emptyList());
        when(shiftConfigService.getAllShifts()).thenReturn(shifts);
        when(holidayService.fetchForDateRange(any(), any())).thenReturn(true);

        TasSession s1 = new TasSession();
        s1.setEmployeeId("100");
        s1.setDate(LocalDate.of(2026, 3, 10));
        s1.setMatchedShiftId("tarde");
        s1.setMatchedShiftName("Tarde");
        s1.setAssignedShiftId("manana");
        s1.setAssignedShiftName("Manana");
        s1.setFlags(new ArrayList<>(List.of(TasFlag.SHIFT_MISMATCH)));
        s1.setNeedsResolution(true);

        TasSession s2 = new TasSession();
        s2.setEmployeeId("100");
        s2.setDate(LocalDate.of(2026, 3, 11));
        s2.setMatchedShiftId("tarde");
        s2.setMatchedShiftName("Tarde");
        s2.setAssignedShiftId("manana");
        s2.setAssignedShiftName("Manana");
        s2.setFlags(new ArrayList<>(List.of(TasFlag.SHIFT_MISMATCH)));
        s2.setNeedsResolution(true);

        when(sessionGrouper.group(any(), any(), any())).thenReturn(new ArrayList<>(List.of(s1, s2)));
        when(reportBuilder.build(any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(Collections.emptyList()));
        when(registryService.getAbsentActiveEmployees(any())).thenReturn(Collections.emptyList());

        TasUploadResult result = service.process(dummyFile, Collections.emptySet());

        assertThat(s1.isNeedsResolution()).isFalse();
        assertThat(s1.getFlags()).isEmpty();
        assertThat(s1.getAssignedShiftId()).isEqualTo("tarde");
        assertThat(s2.isNeedsResolution()).isFalse();
        assertThat(result.getFlaggedSessions()).isEmpty();
        verify(hoursCalculator, times(2)).recompute(any(), any());
    }
}
