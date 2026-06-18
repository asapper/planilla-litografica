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
    @Mock EmployeeRegistryService employeeRegistryService;

    TasSessionGrouper grouper;
    TasHoursCalculator calculator;
    TasReportBuilder reportBuilder;

    private List<Map<String, Object>> shifts;

    @BeforeEach
    void setUp() {
        lenient().when(appConfigService.getMaxSessionSpanMinutes()).thenReturn(780);
        grouper = new TasSessionGrouper(appConfigService);
        calculator = new TasHoursCalculator(appConfigService, holidayService, shiftConfigService);
        reportBuilder = new TasReportBuilder(holidayService, employeeRegistryService);
        lenient().when(employeeRegistryService.getAccruesOvertimeFlags(any())).thenReturn(Map.of());

        Map<String, Object> manana = new LinkedHashMap<>();
        manana.put("id", "manana");
        manana.put("name", "Manana");
        manana.put("startTime", "07:00");
        manana.put("endTime", "15:00");
        manana.put("crossMidnight", false);

        Map<String, Object> tarde = new LinkedHashMap<>();
        tarde.put("id", "tarde");
        tarde.put("name", "Tarde");
        tarde.put("startTime", "15:00");
        tarde.put("endTime", "23:00");
        tarde.put("crossMidnight", false);

        Map<String, Object> noche = new LinkedHashMap<>();
        noche.put("id", "noche");
        noche.put("name", "Noche");
        noche.put("startTime", "19:00");
        noche.put("endTime", "07:00");
        noche.put("crossMidnight", true);

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
        assertThat(sessions).allSatisfy(s -> assertThat(s.getFlags()).contains(TasFlag.BEST_FIT_SHIFT));

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
