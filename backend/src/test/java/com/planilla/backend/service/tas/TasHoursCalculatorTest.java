package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasFlag;
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
import java.util.*;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TasHoursCalculatorTest {

    @Mock AppConfigService appConfigService;
    @Mock HolidayService holidayService;
    @Mock ShiftConfigService shiftConfigService;

    TasHoursCalculator calculator;

    private static final LocalDate REPORT_START = LocalDate.of(2026, 3, 1);
    private static final LocalDate REPORT_END   = LocalDate.of(2026, 3, 15);

    private Map<String, Object> mananaShift;

    @BeforeEach
    void setUp() {
        calculator = new TasHoursCalculator(appConfigService, holidayService, shiftConfigService);

        mananaShift = new LinkedHashMap<>();
        mananaShift.put("id", "manana");
        mananaShift.put("name", "Manana");
        mananaShift.put("start_time", "07:00");
        mananaShift.put("end_time", "15:00");
        mananaShift.put("cross_midnight", false);

        when(appConfigService.getLegalBreakAllowanceMinutes()).thenReturn(45);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(mananaShift));
        when(holidayService.isHoliday(any())).thenReturn(false);
    }

    private TasSession session(LocalDate date, LocalDateTime... scanTimes) {
        TasSession s = new TasSession();
        s.setEmployeeId("100");
        s.setDate(date);
        s.setMatchedShiftId("manana");
        s.setCrossMidnight(false);
        s.setFlags(new ArrayList<>());
        List<LocalDateTime> scans = new ArrayList<>(Arrays.asList(scanTimes));
        s.setScans(scans);
        s.setLastScan(scans.get(scans.size() - 1));
        return s;
    }

    @Test
    void calculate_specExample1_40minBreak_8hours() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 12, 0),
            LocalDateTime.of(2026, 3, 10, 12, 40),
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(480);
        assertThat(s.getWorkedHours()).isEqualTo(8.0);
    }

    @Test
    void calculate_specExample2_90minBreak_435minutes_floorsTo7hours() {
        // 07:00-15:00 with 90min break, deductible=45min → 435 worked minutes
        // floor(435/30)/2.0 = floor(14.5)/2.0 = 14/2.0 = 7.0h (floor always rounds down at half-hour)
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 12, 0),
            LocalDateTime.of(2026, 3, 10, 13, 30),
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(435);
        assertThat(s.getWorkedHours()).isEqualTo(7.0);
    }

    @Test
    void calculate_specExample3_multipleBreaks_8hours() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 10, 0),
            LocalDateTime.of(2026, 3, 10, 10, 20),
            LocalDateTime.of(2026, 3, 10, 12, 0),
            LocalDateTime.of(2026, 3, 10, 12, 40),
            LocalDateTime.of(2026, 3, 10, 15, 30)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(495);
        assertThat(s.getWorkedHours()).isEqualTo(8.0);
    }

    @Test
    void calculate_lateEntry_effectiveStartIsFirstScan() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 25),
            LocalDateTime.of(2026, 3, 10, 15, 25)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 3, 10, 7, 25));
        assertThat(s.getWorkedMinutes()).isEqualTo(480);
    }

    @Test
    void calculate_onTimeEntry_effectiveStartIsShiftStart() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 5),
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 3, 10, 7, 0));
    }

    @Test
    void calculate_missingExitFlag_setsNeedsResolution() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 13, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.MISSING_EXIT);
        assertThat(s.isNeedsResolution()).isTrue();
        assertThat(s.getWorkedMinutes()).isEqualTo(0);
        assertThat(s.getWorkedHours()).isEqualTo(0.0);
    }

    @Test
    void calculate_missingEntryFlag_setsNeedsResolution() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 9, 30),
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.MISSING_ENTRY);
        assertThat(s.isNeedsResolution()).isTrue();
    }

    @Test
    void calculate_startCutoffFlag_onFirstDayForCrossMidnightEmployee() {
        LocalDate date = REPORT_START;
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 1, 2, 0),
            LocalDateTime.of(2026, 3, 1, 7, 0)
        );
        s.setCrossMidnight(true);

        Map<String, Object> nocheShift = new LinkedHashMap<>();
        nocheShift.put("id", "noche");
        nocheShift.put("name", "Noche");
        nocheShift.put("start_time", "19:00");
        nocheShift.put("end_time", "07:00");
        nocheShift.put("cross_midnight", true);
        s.setMatchedShiftId("noche");

        when(shiftConfigService.getAllShifts()).thenReturn(List.of(nocheShift));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.START_CUTOFF);
        assertThat(s.isNeedsResolution()).isTrue();
    }

    @Test
    void calculate_endCutoffFlag_onlyForCrossMidnightSessionOnLastDay() {
        LocalDate date = REPORT_END;
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 15, 7, 0),
            LocalDateTime.of(2026, 3, 15, 15, 0)
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

        assertThat(s.getFlags()).contains(TasFlag.END_CUTOFF);
        assertThat(s.isNeedsResolution()).isTrue();
    }

    @Test
    void calculate_nonCrossMidnightSession_onLastDay_noEndCutoff() {
        LocalDate date = REPORT_END;
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 15, 7, 0),
            LocalDateTime.of(2026, 3, 15, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).doesNotContain(TasFlag.END_CUTOFF);
        assertThat(s.isNeedsResolution()).isFalse();
    }

    @Test
    void calculate_sundaySession_allHoursAreDobles() {
        LocalDate sunday = LocalDate.of(2026, 3, 8);
        TasSession s = session(sunday,
            LocalDateTime.of(2026, 3, 8, 7, 0),
            LocalDateTime.of(2026, 3, 8, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getSimplesMinutes()).isEqualTo(0);
        assertThat(s.getDoblesMinutes()).isEqualTo(s.getWorkedMinutes());
    }

    @Test
    void calculate_holidaySession_allHoursAreDobles() {
        LocalDate holiday = LocalDate.of(2026, 3, 10);
        when(holidayService.isHoliday(holiday)).thenReturn(true);

        TasSession s = session(holiday,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getSimplesMinutes()).isEqualTo(0);
        assertThat(s.getDoblesMinutes()).isEqualTo(s.getWorkedMinutes());
    }

    @Test
    void calculate_hoursWithinShiftDuration_allSimples() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
        assertThat(s.getSimplesMinutes()).isEqualTo(s.getWorkedMinutes());
    }

    @Test
    void calculate_hoursExceedingShiftDuration_splitSimplesDobles() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 17, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getSimplesMinutes()).isGreaterThan(0);
        assertThat(s.getDoblesMinutes()).isGreaterThan(0);
        assertThat(s.getSimplesMinutes() + s.getDoblesMinutes()).isEqualTo(s.getWorkedMinutes());
    }
}
