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
        mananaShift.put("startTime", "07:00");
        mananaShift.put("endTime", "15:00");
        mananaShift.put("crossMidnight", false);

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
    void calculate_evenScans_earlyExit_setsShortDayAndComputesHours() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        // 2 scans (even) — employee in at 07:00, out at 13:00 (before the 14:00 threshold)
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 13, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.SHORT_DAY);
        assertThat(s.getFlags()).doesNotContain(TasFlag.MISSING_EXIT);
        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(360);
        assertThat(s.getWorkedHours()).isEqualTo(6.0);
        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 3, 10, 7, 0));
        assertThat(s.getLastScan()).isEqualTo(LocalDateTime.of(2026, 3, 10, 13, 0));
    }

    @Test
    void calculate_missingEntryWithOnlyExitScan_setsLastScanNoEffectiveStart() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );
        s.setLastScan(null);

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.MISSING_ENTRY);
        assertThat(s.getLastScan()).isEqualTo(LocalDateTime.of(2026, 3, 10, 15, 0));
        assertThat(s.getEffectiveStart()).isNull();
    }

    @Test
    void calculate_singleScanWithShiftMismatch_setsEffectiveStartAndLastScanToSameScan() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 10, 0)
        );
        s.setFlags(new ArrayList<>(List.of(TasFlag.SHIFT_MISMATCH)));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isTrue();
        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 3, 10, 10, 0));
        assertThat(s.getLastScan()).isEqualTo(LocalDateTime.of(2026, 3, 10, 10, 0));
    }

    @Test
    void calculate_missingExitWithOnlyEntryScan_setsEffectiveStartNoLastScan() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0)
        );
        s.setLastScan(null);

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.MISSING_EXIT);
        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 3, 10, 7, 0));
        assertThat(s.getLastScan()).isNull();
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
        nocheShift.put("startTime", "19:00");
        nocheShift.put("endTime", "07:00");
        nocheShift.put("crossMidnight", true);
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
        nocheShift.put("startTime", "19:00");
        nocheShift.put("endTime", "07:00");
        nocheShift.put("crossMidnight", true);
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
    void calculate_hoursWithinShiftDuration_noOvertime() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getSimplesMinutes()).isEqualTo(0);
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
    }

    @Test
    void calculate_hoursExceedingShiftDuration_overtimeGoesToSimplesOnly() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 17, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(600);
        assertThat(s.getSimplesMinutes()).isEqualTo(120); // 600 - 480 (shift duration)
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
    }

    @Test
    void calculate_bestFitShiftFlagAlone_doesNotBlockHoursComputation() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 9, 0),
            LocalDateTime.of(2026, 3, 10, 19, 0)
        );
        s.setMatchedShiftId("manana");
        s.setFlags(new ArrayList<>(List.of(TasFlag.BEST_FIT_SHIFT)));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 3, 10, 9, 0));
        assertThat(s.getWorkedMinutes()).isEqualTo(600);
        assertThat(s.getWorkedHours()).isEqualTo(10.0);
        assertThat(s.getSimplesMinutes()).isEqualTo(120);
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
    }

    @Test
    void calculate_bestFitShiftUsesRawScanStart_noGracePeriod() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 5),
            LocalDateTime.of(2026, 3, 10, 15, 5)
        );
        s.setMatchedShiftId("manana");
        s.setFlags(new ArrayList<>(List.of(TasFlag.BEST_FIT_SHIFT)));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 3, 10, 7, 5));
        assertThat(s.getWorkedMinutes()).isEqualTo(480);
    }

    @Test
    void calculate_bestFitShiftSingleScan_doesNotBlockHoursComputation() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date, LocalDateTime.of(2026, 3, 10, 9, 7));
        s.setMatchedShiftId("manana");
        s.setFlags(new ArrayList<>(List.of(TasFlag.BEST_FIT_SHIFT)));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(0);
        assertThat(s.getWorkedHours()).isEqualTo(0.0);
    }

    @Test
    void calculate_bestFitShiftWithOtherFlag_stillNeedsResolution() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 9, 0),
            LocalDateTime.of(2026, 3, 10, 19, 0)
        );
        s.setMatchedShiftId("manana");
        s.setFlags(new ArrayList<>(List.of(TasFlag.BEST_FIT_SHIFT, TasFlag.SAME_DAY_DOUBLE)));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isTrue();
        assertThat(s.getWorkedMinutes()).isEqualTo(0);
    }

    @Test
    void calculate_bestFitShift_skipsMissingScanDetection() {
        // 09:00 entry with Manana (07:00) would normally trigger MISSING_ENTRY
        // but BEST_FIT_SHIFT sessions should skip this check entirely
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 9, 0),
            LocalDateTime.of(2026, 3, 10, 19, 0)
        );
        s.setMatchedShiftId("manana");
        s.setFlags(new ArrayList<>(List.of(TasFlag.BEST_FIT_SHIFT)));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).containsExactly(TasFlag.BEST_FIT_SHIFT);
        assertThat(s.isNeedsResolution()).isFalse();
    }

    @Test
    void calculate_crossMidnight_startsSunday_endsMonday_splitsAtMidnight() {
        // Sunday 2026-03-08 19:00 -> Monday 2026-03-09 07:00 (noche shift, no break)
        LocalDate sunday = LocalDate.of(2026, 3, 8);
        TasSession s = session(sunday,
            LocalDateTime.of(2026, 3, 8, 19, 0),
            LocalDateTime.of(2026, 3, 9, 7, 0)
        );
        s.setCrossMidnight(true);
        s.setMatchedShiftId("noche");

        Map<String, Object> nocheShift = new LinkedHashMap<>();
        nocheShift.put("id", "noche");
        nocheShift.put("name", "Noche");
        nocheShift.put("startTime", "19:00");
        nocheShift.put("endTime", "07:00");
        nocheShift.put("crossMidnight", true);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(nocheShift));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(720); // 12h, no break
        // 5h (19:00-00:00) on Sunday -> dobles; 7h (00:00-07:00) Monday, within 12h shift -> simples 0
        assertThat(s.getDoblesMinutes()).isEqualTo(300);
        assertThat(s.getSimplesMinutes()).isEqualTo(0);
    }

    @Test
    void calculate_crossMidnight_startsSaturday_endsSunday_splitsAtMidnight() {
        // Saturday 2026-03-07 19:00 -> Sunday 2026-03-08 07:00 (noche shift, no break)
        LocalDate saturday = LocalDate.of(2026, 3, 7);
        TasSession s = session(saturday,
            LocalDateTime.of(2026, 3, 7, 19, 0),
            LocalDateTime.of(2026, 3, 8, 7, 0)
        );
        s.setCrossMidnight(true);
        s.setMatchedShiftId("noche");

        Map<String, Object> nocheShift = new LinkedHashMap<>();
        nocheShift.put("id", "noche");
        nocheShift.put("name", "Noche");
        nocheShift.put("startTime", "19:00");
        nocheShift.put("endTime", "07:00");
        nocheShift.put("crossMidnight", true);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(nocheShift));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(720); // 12h, no break
        // 5h (19:00-00:00) Saturday is normal; 7h (00:00-07:00) Sunday -> dobles
        assertThat(s.getDoblesMinutes()).isEqualTo(420);
        assertThat(s.getSimplesMinutes()).isEqualTo(0);
    }

    @Test
    void recompute_computesWorkedHoursAndClassification() {
        TasSession s = session(LocalDate.of(2026, 3, 10),
            LocalDateTime.of(2026, 3, 10, 7, 3),
            LocalDateTime.of(2026, 3, 10, 15, 5)
        );

        calculator.recompute(s, shiftConfigService.getAllShifts());

        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 3, 10, 7, 0));
        assertThat(s.getWorkedMinutes()).isEqualTo(485);
        assertThat(s.getWorkedHours()).isEqualTo(8.0);
        assertThat(s.getSimplesMinutes()).isEqualTo(5);
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
        assertThat(s.getLastScan()).isEqualTo(LocalDateTime.of(2026, 3, 10, 15, 5));
    }

    @Test
    void calculate_evenScans_earlyExit_emitsShortDayInsteadOfMissingExit() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        // 2 scans (even) — employee in at 07:00, out at 11:00 (before the 14:00 MISSING_EXIT threshold)
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 11, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.SHORT_DAY);
        assertThat(s.getFlags()).doesNotContain(TasFlag.MISSING_EXIT);
        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(240);
    }

    @Test
    void calculate_oddScans_earlyExit_emitsMissingExitAndBlocks() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        // 1 scan (odd) — employee in at 07:00, never scanned out
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.MISSING_EXIT);
        assertThat(s.getFlags()).doesNotContain(TasFlag.SHORT_DAY);
        assertThat(s.isNeedsResolution()).isTrue();
    }

    @Test
    void calculate_evenScans_fullDay_noShortDayFlag() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        // 2 scans, exit on time — no SHORT_DAY, no MISSING_EXIT
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 15, 0)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).doesNotContain(TasFlag.SHORT_DAY);
        assertThat(s.getFlags()).doesNotContain(TasFlag.MISSING_EXIT);
        assertThat(s.isNeedsResolution()).isFalse();
    }

    @Test
    void calculate_evenScans_missingEntryAndEarlyExit_blocksOnMissingEntry() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        // 2 scans (even) — employee arrived very late (after MISSING_ENTRY threshold 08:10)
        // AND exited early (before MISSING_EXIT threshold 14:00)
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 9, 30),  // late entry → MISSING_ENTRY
            LocalDateTime.of(2026, 3, 10, 11, 0)   // early exit → SHORT_DAY (even count)
        );

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.MISSING_ENTRY);
        assertThat(s.getFlags()).contains(TasFlag.SHORT_DAY);
        assertThat(s.isNeedsResolution()).isTrue();  // MISSING_ENTRY makes it blocking
    }

    @Test
    void calculate_evenScans_shiftMismatchAndEarlyExit_doesNotEmitShortDay() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0),
            LocalDateTime.of(2026, 3, 10, 11, 0)
        );
        // Simulate SHIFT_MISMATCH already set by TasSessionGrouper
        s.getFlags().add(TasFlag.SHIFT_MISMATCH);

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).doesNotContain(TasFlag.SHORT_DAY);
        assertThat(s.getFlags()).doesNotContain(TasFlag.MISSING_EXIT);
        assertThat(s.getFlags()).contains(TasFlag.SHIFT_MISMATCH);
        assertThat(s.isNeedsResolution()).isTrue();
    }

    @Test
    void calculate_oddScans_shiftMismatchAndEarlyExit_stillEmitsMissingExit() {
        LocalDate date = LocalDate.of(2026, 3, 10);
        TasSession s = session(date,
            LocalDateTime.of(2026, 3, 10, 7, 0)
        );
        s.getFlags().add(TasFlag.SHIFT_MISMATCH);

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.getFlags()).contains(TasFlag.MISSING_EXIT);
        assertThat(s.getFlags()).doesNotContain(TasFlag.SHORT_DAY);
        assertThat(s.isNeedsResolution()).isTrue();
    }

    @Test
    void calculate_crossMidnight_startsFriday_endsSaturday_noSpecialDay_normalSplit() {
        // Friday 2026-03-06 19:00 -> Saturday 2026-03-07 09:00 (noche shift, 14h worked, no break)
        LocalDate friday = LocalDate.of(2026, 3, 6);
        TasSession s = session(friday,
            LocalDateTime.of(2026, 3, 6, 19, 0),
            LocalDateTime.of(2026, 3, 7, 9, 0)
        );
        s.setCrossMidnight(true);
        s.setMatchedShiftId("noche");

        Map<String, Object> nocheShift = new LinkedHashMap<>();
        nocheShift.put("id", "noche");
        nocheShift.put("name", "Noche");
        nocheShift.put("startTime", "19:00");
        nocheShift.put("endTime", "07:00");
        nocheShift.put("crossMidnight", true);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(nocheShift));

        calculator.calculate(List.of(s), REPORT_START, REPORT_END);

        assertThat(s.isNeedsResolution()).isFalse();
        assertThat(s.getWorkedMinutes()).isEqualTo(840); // 14h, no break
        // Neither Friday nor Saturday is special -> normal split: 840 - 720 (12h shift) = 120 simples
        assertThat(s.getSimplesMinutes()).isEqualTo(120);
        assertThat(s.getDoblesMinutes()).isEqualTo(0);
    }
}
