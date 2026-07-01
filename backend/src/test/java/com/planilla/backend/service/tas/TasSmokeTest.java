package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasUploadResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.quality.Strictness;
import org.mockito.junit.jupiter.MockitoSettings;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * End-to-end smoke tests that feed each CSV from docs/smoke-tests/
 * through the full TAS pipeline (parse → group → calculate → auto-resolve → report)
 * and verify the expected outcomes documented in GUIA-SMOKE-TESTS.md.
 *
 * All tests assume employees are NEW (created with default Mañana shift) unless
 * a specific shift assignment is configured via {@link #withShiftAssignment}.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TasSmokeTest {

    private static final Path SMOKE_DIR = Paths.get("../docs/smoke-tests");

    @Mock private EmployeeRegistryService registryService;
    @Mock private HolidayService holidayService;
    @Mock private ShiftConfigService shiftConfigService;
    @Mock private AppConfigService appConfigService;

    private TasParserService parserService;
    private TasSessionGrouper sessionGrouper;
    private TasHoursCalculator hoursCalculator;
    private TasReportBuilder reportBuilder;
    private TasUploadService uploadService;

    private final Map<String, String> shiftAssignments = new LinkedHashMap<>();

    private static List<Map<String, Object>> seededShifts() {
        List<Map<String, Object>> shifts = new ArrayList<>();

        Map<String, Object> manana = new LinkedHashMap<>();
        manana.put("id", "manana");
        manana.put("name", "Mañana");
        manana.put("startTime", "07:00");
        manana.put("endTime", "15:00");
        manana.put("crossMidnight", false);
        manana.put("detectionBeforeMinutes", 60);
        manana.put("detectionAfterMinutes", 10);
        shifts.add(manana);

        Map<String, Object> tarde = new LinkedHashMap<>();
        tarde.put("id", "tarde");
        tarde.put("name", "Tarde");
        tarde.put("startTime", "15:00");
        tarde.put("endTime", "23:00");
        tarde.put("crossMidnight", false);
        tarde.put("detectionBeforeMinutes", 60);
        tarde.put("detectionAfterMinutes", 10);
        shifts.add(tarde);

        Map<String, Object> noche = new LinkedHashMap<>();
        noche.put("id", "noche");
        noche.put("name", "Noche");
        noche.put("startTime", "19:00");
        noche.put("endTime", "07:00");
        noche.put("crossMidnight", true);
        noche.put("detectionBeforeMinutes", 60);
        noche.put("detectionAfterMinutes", 50);
        shifts.add(noche);

        return shifts;
    }

    @BeforeEach
    void setUp() {
        shiftAssignments.clear();

        when(shiftConfigService.getAllShifts()).thenReturn(seededShifts());
        when(appConfigService.getMaxSessionSpanMinutes()).thenReturn(840);
        when(appConfigService.getLegalBreakAllowanceMinutes()).thenReturn(45);
        when(holidayService.isHoliday(any(LocalDate.class))).thenReturn(false);
        when(holidayService.fetchForDateRange(any(), any())).thenReturn(true);
        when(registryService.getInactiveEmployeesPresent(anySet())).thenReturn(Collections.emptyList());
        when(registryService.getAbsentActiveEmployees(anySet())).thenReturn(Collections.emptyList());
        when(registryService.getAccruesOvertimeFlags(anyCollection()))
                .thenAnswer(inv -> {
                    Collection<String> ids = inv.getArgument(0);
                    Map<String, Boolean> result = new HashMap<>();
                    for (String id : ids) result.put(id, true);
                    return result;
                });
        doAnswer(inv -> {
            String empId = inv.getArgument(0);
            shiftAssignments.putIfAbsent(empId, "manana");
            return null;
        }).when(registryService).upsertEmployee(anyString(), anyString());
        when(registryService.getAll(any(), any(), any())).thenAnswer(inv -> {
            List<Map<String, Object>> employees = new ArrayList<>();
            for (Map.Entry<String, String> entry : shiftAssignments.entrySet()) {
                Map<String, Object> emp = new LinkedHashMap<>();
                emp.put("id", entry.getKey());
                emp.put("shiftId", entry.getValue());
                employees.add(emp);
            }
            return employees;
        });

        parserService = new TasParserService();
        sessionGrouper = new TasSessionGrouper(appConfigService);
        hoursCalculator = new TasHoursCalculator(appConfigService, holidayService, shiftConfigService);
        reportBuilder = new TasReportBuilder(holidayService, registryService);
        uploadService = new TasUploadService(
                parserService, registryService, holidayService,
                sessionGrouper, hoursCalculator, reportBuilder, shiftConfigService);
    }

    private void withShiftAssignment(String employeeId, String shiftId) {
        shiftAssignments.put(employeeId, shiftId);
    }

    private TasUploadResult processFile(String filename) throws Exception {
        Path csvPath = SMOKE_DIR.resolve(filename);
        byte[] content = Files.readAllBytes(csvPath);
        MockMultipartFile file = new MockMultipartFile("file", filename, "text/csv", content);
        return uploadService.process(file, Collections.emptySet());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static List<TasSession> flaggedSessions(TasUploadResult result) {
        return result.getFlaggedSessions();
    }

    private static boolean goesToVerification(TasUploadResult result) {
        return !result.getFlaggedSessions().isEmpty();
    }

    private static List<TasSession> sessionsWithFlag(TasUploadResult result, TasFlag flag) {
        return result.getAllSessions().stream()
                .filter(s -> s.getFlags() != null && s.getFlags().contains(flag))
                .collect(Collectors.toList());
    }

    private static EmployeeRow findEmployee(TasUploadResult result, String employeeId) {
        return result.getResolvedRows().stream()
                .filter(r -> r.getCodigoEmpleado().equals(employeeId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Employee " + employeeId + " not found in resolved rows"));
    }

    private static double totalHours(TasUploadResult result) {
        return result.getAllSessions().stream()
                .mapToDouble(TasSession::getWorkedHours)
                .sum();
    }

    // ── Tests ───────────────────────────────────────────────────────────────

    @Test
    void test01_happyPathManana() throws Exception {
        TasUploadResult result = processFile("01-happy-path-manana.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(13);
        assertThat(flaggedSessions(result)).isEmpty();

        EmployeeRow emp = findEmployee(result, "100");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(0);
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(0);
        assertThat(emp.getHorasExtrasDobles()).isEqualTo(0);
        assertThat(totalHours(result)).isEqualTo(104.0);
    }

    @Test
    void test02_happyPathTarde_defaultManana() throws Exception {
        TasUploadResult result = processFile("02-happy-path-tarde.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(13);
        assertThat(flaggedSessions(result)).isEmpty();

        EmployeeRow emp = findEmployee(result, "101");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(0);
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(0);
        assertThat(emp.getHorasExtrasDobles()).isEqualTo(0);
        assertThat(totalHours(result)).isEqualTo(102.5);
    }

    @Test
    void test03_nocheCrossMidnight_defaultManana() throws Exception {
        TasUploadResult result = processFile("03-noche-cross-midnight.csv");

        // Jul 1 = reportStart, auto-resolved to Noche → START_CUTOFF
        assertThat(goesToVerification(result)).isTrue();
        assertThat(result.getAllSessions()).hasSize(10);
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF).get(0).getDate())
                .isEqualTo(LocalDate.of(2026, 7, 1));

        EmployeeRow emp = findEmployee(result, "102");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(3);
    }

    @Test
    void test03_nocheCrossMidnight_preConfigNoche() throws Exception {
        withShiftAssignment("102", "noche");
        TasUploadResult result = processFile("03-noche-cross-midnight.csv");

        assertThat(goesToVerification(result)).isTrue();
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);
    }

    @Test
    void test04_missingEntryExit() throws Exception {
        TasUploadResult result = processFile("04-missing-entry-exit.csv");

        assertThat(goesToVerification(result)).isTrue();
        assertThat(result.getAllSessions()).hasSize(6);
        assertThat(flaggedSessions(result)).hasSize(3);

        List<TasSession> missingExit = sessionsWithFlag(result, TasFlag.MISSING_EXIT);
        assertThat(missingExit).hasSize(3);

        EmployeeRow emp = findEmployee(result, "103");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(7);
    }

    @Test
    void test05_bestFitEstimated() throws Exception {
        TasUploadResult result = processFile("05-best-fit-estimated-shift.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(4);
        assertThat(sessionsWithFlag(result, TasFlag.BEST_FIT_SHIFT)).hasSize(2);

        EmployeeRow emp = findEmployee(result, "104");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(9);
        assertThat(emp.getDiasTurnoEstimado()).isEqualTo(2);
    }

    @Test
    void test06_shiftMismatch_autoResolve() throws Exception {
        TasUploadResult result = processFile("06-shift-mismatch.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(4);
        assertThat(flaggedSessions(result)).isEmpty();

        EmployeeRow emp = findEmployee(result, "105");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(9);
    }

    @Test
    void test07_overtime() throws Exception {
        when(holidayService.isHoliday(LocalDate.of(2026, 7, 5))).thenReturn(false);

        TasUploadResult result = processFile("07-overtime-simples-dobles.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(5);

        EmployeeRow emp = findEmployee(result, "106");
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(8.5);
        assertThat(emp.getHorasExtrasDobles()).isEqualTo(8.0);
        assertThat(emp.getDiasNoLaborados()).isEqualTo(9);
        assertThat(totalHours(result)).isEqualTo(48.5);
    }

    @Test
    void test08_duplicateScans() throws Exception {
        TasUploadResult result = processFile("08-duplicate-scans.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(2);
        assertThat(flaggedSessions(result)).isEmpty();

        EmployeeRow emp = findEmployee(result, "107");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(11);
        assertThat(totalHours(result)).isEqualTo(16.0);
    }

    @Test
    void test09_shortDay() throws Exception {
        TasUploadResult result = processFile("09-short-day.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(3);
        assertThat(sessionsWithFlag(result, TasFlag.SHORT_DAY)).hasSize(2);

        EmployeeRow emp = findEmployee(result, "108");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(10);
    }

    @Test
    void test10_sundayHoliday() throws Exception {
        TasUploadResult result = processFile("10-sunday-holiday-dobles.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(3);

        EmployeeRow emp = findEmployee(result, "109");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(12);
        assertThat(emp.getHorasExtrasDobles()).isEqualTo(16.0);
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(0);
        assertThat(totalHours(result)).isEqualTo(24.0);
    }

    @Test
    void test11_multiEmployee_defaultManana() throws Exception {
        TasUploadResult result = processFile("11-multi-employee-mixed.csv");

        // Employee 112 (Noche) on Jul 1 = reportStart → START_CUTOFF after auto-resolve
        assertThat(goesToVerification(result)).isTrue();
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);

        Set<String> employeeIds = result.getAllSessions().stream()
                .map(TasSession::getEmployeeId)
                .collect(Collectors.toSet());
        assertThat(employeeIds).containsExactlyInAnyOrder("110", "111", "112");

        for (String empId : employeeIds) {
            EmployeeRow emp = findEmployee(result, empId);
            assertThat(emp.getDiasNoLaborados()).isEqualTo(10);
        }
    }

    @Test
    void test11_multiEmployee_preConfigShifts() throws Exception {
        withShiftAssignment("110", "manana");
        withShiftAssignment("111", "tarde");
        withShiftAssignment("112", "noche");
        TasUploadResult result = processFile("11-multi-employee-mixed.csv");

        assertThat(goesToVerification(result)).isTrue();
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);
    }

    @Test
    void test12_quincenaBoundary() throws Exception {
        TasUploadResult result = processFile("12-quincena-boundary.csv");

        assertThat(result.getAllSessions()).hasSize(4);
        assertThat(flaggedSessions(result)).isEmpty();

        Set<LocalDate> dates = result.getAllSessions().stream()
                .map(TasSession::getDate)
                .collect(Collectors.toSet());
        assertThat(dates).contains(LocalDate.of(2026, 7, 14), LocalDate.of(2026, 7, 16));
    }

    @Test
    void test13_breakScans() throws Exception {
        TasUploadResult result = processFile("13-with-break-scans.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(3);

        List<TasSession> sessions = result.getAllSessions().stream()
                .sorted(Comparator.comparing(s -> s.getDate().toString()))
                .collect(Collectors.toList());

        assertThat(sessions.get(0).getWorkedHours()).isEqualTo(8.0);
        assertThat(sessions.get(0).getBreakDeductionMinutes()).isEqualTo(0);
        assertThat(sessions.get(1).getWorkedHours()).isEqualTo(7.0);
        assertThat(sessions.get(1).getBreakDeductionMinutes()).isEqualTo(45);
        assertThat(sessions.get(2).getWorkedHours()).isEqualTo(6.5);
        assertThat(sessions.get(2).getBreakDeductionMinutes()).isEqualTo(75);

        EmployeeRow emp = findEmployee(result, "114");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(10);
    }

    @Test
    void test14_nocheCutoff_defaultManana() throws Exception {
        TasUploadResult result = processFile("14-noche-cross-midnight-cutoff.csv");

        // Jul 1 = reportStart, auto-resolved to Noche → START_CUTOFF (same as preConfigNoche)
        assertThat(goesToVerification(result)).isTrue();
        assertThat(result.getAllSessions()).hasSize(3);
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);
        // No END_CUTOFF: reportEnd = Jul 16 (max scan date), session date Jul 15 ≠ reportEnd

        EmployeeRow emp = findEmployee(result, "115");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(10);
    }

    @Test
    void test14_nocheCutoff_preConfigNoche() throws Exception {
        withShiftAssignment("115", "noche");
        TasUploadResult result = processFile("14-noche-cross-midnight-cutoff.csv");

        assertThat(goesToVerification(result)).isTrue();
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);
        // No END_CUTOFF: reportEnd = Jul 16 (max scan date), session date Jul 15 ≠ reportEnd
        assertThat(sessionsWithFlag(result, TasFlag.END_CUTOFF)).isEmpty();
    }

    @Test
    void test15_gracePeriod() throws Exception {
        TasUploadResult result = processFile("15-grace-period-edge.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(4);

        List<TasSession> sessions = result.getAllSessions().stream()
                .sorted(Comparator.comparing(s -> s.getDate().toString()))
                .collect(Collectors.toList());

        assertThat(sessions.get(0).getWorkedHours()).isEqualTo(8.0);
        assertThat(sessions.get(1).getWorkedHours()).isEqualTo(8.0);
        assertThat(sessions.get(2).getWorkedHours()).isEqualTo(7.5);
        assertThat(sessions.get(3).getWorkedHours()).isEqualTo(7.5);

        EmployeeRow emp = findEmployee(result, "116");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(9);
    }

    @Test
    void test16_sameDayDouble() throws Exception {
        TasUploadResult result = processFile("16-same-day-double-shift.csv");

        assertThat(goesToVerification(result)).isTrue();
        assertThat(result.getAllSessions()).hasSize(3);
        assertThat(sessionsWithFlag(result, TasFlag.SAME_DAY_DOUBLE)).hasSize(2);
    }

    @Test
    void test17_newEmployee() throws Exception {
        TasUploadResult result = processFile("17-new-employee.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(2);

        EmployeeRow emp = findEmployee(result, "999");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(11);
        assertThat(totalHours(result)).isEqualTo(16.0);
    }

    @Test
    void test18_nocheMissingExit_defaultManana() throws Exception {
        TasUploadResult result = processFile("18-noche-missing-exit.csv");

        assertThat(goesToVerification(result)).isTrue();
        assertThat(result.getAllSessions()).hasSize(3);

        List<TasSession> flagged = flaggedSessions(result);
        assertThat(flagged).hasSize(2);

        // Jul 1 auto-resolved to Noche on reportStart → START_CUTOFF
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF).get(0).getDate())
                .isEqualTo(LocalDate.of(2026, 7, 1));

        // Jul 3 single scan → MISSING_EXIT + SHIFT_MISMATCH (not auto-resolved)
        TasSession missingExit = sessionsWithFlag(result, TasFlag.MISSING_EXIT).get(0);
        assertThat(missingExit.getFlags()).contains(TasFlag.SHIFT_MISMATCH);
        assertThat(missingExit.getDate()).isEqualTo(LocalDate.of(2026, 7, 3));
        assertThat(missingExit.isCrossMidnight()).isTrue();
    }

    @Test
    void test18_nocheMissingExit_preConfigNoche() throws Exception {
        withShiftAssignment("118", "noche");
        TasUploadResult result = processFile("18-noche-missing-exit.csv");

        assertThat(goesToVerification(result)).isTrue();

        List<TasSession> flagged = flaggedSessions(result);
        assertThat(flagged).hasSize(2);
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);
        assertThat(sessionsWithFlag(result, TasFlag.MISSING_EXIT)).hasSize(1);
    }

    // ── Edge / corner case tests ────────────────────────────────────────────

    @Test
    void test19_holidayFeriado() throws Exception {
        when(holidayService.isHoliday(LocalDate.of(2026, 7, 2))).thenReturn(true);

        TasUploadResult result = processFile("19-holiday-feriado.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(3);

        EmployeeRow emp = findEmployee(result, "119");
        assertThat(emp.getHorasExtrasDobles()).isEqualTo(8.0);
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(0);
        assertThat(emp.getDiasNoLaborados()).isEqualTo(10);
    }

    @Test
    void test20_nocheClean_defaultManana() throws Exception {
        TasUploadResult result = processFile("20-noche-clean.csv");

        // Jul 2 = reportStart, auto-resolved to Noche → START_CUTOFF
        assertThat(goesToVerification(result)).isTrue();
        assertThat(result.getAllSessions()).hasSize(2);
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF).get(0).getDate())
                .isEqualTo(LocalDate.of(2026, 7, 2));

        assertThat(totalHours(result)).isEqualTo(24.0);

        EmployeeRow emp = findEmployee(result, "120");
        assertThat(emp.getDiasNoLaborados()).isEqualTo(11);
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(0);
    }

    @Test
    void test21_nocheOvertime() throws Exception {
        TasUploadResult result = processFile("21-noche-overtime.csv");

        // Jul 2 = reportStart, auto-resolved to Noche → START_CUTOFF
        assertThat(goesToVerification(result)).isTrue();
        assertThat(result.getAllSessions()).hasSize(2);
        assertThat(sessionsWithFlag(result, TasFlag.START_CUTOFF)).hasSize(1);

        List<TasSession> sessions = result.getAllSessions().stream()
                .sorted(Comparator.comparing(s -> s.getDate().toString()))
                .collect(Collectors.toList());

        // Jul 2 19:00 → Jul 3 07:30 = 750 min → 12.5h, simples = 30 min
        assertThat(sessions.get(0).getWorkedHours()).isEqualTo(12.5);
        assertThat(sessions.get(0).getSimplesMinutes()).isEqualTo(30);

        // Jul 3 19:00 → Jul 4 08:00 = 780 min → 13.0h, simples = 60 min
        assertThat(sessions.get(1).getWorkedHours()).isEqualTo(13.0);
        assertThat(sessions.get(1).getSimplesMinutes()).isEqualTo(60);

        EmployeeRow emp = findEmployee(result, "121");
        // Jul 2 session is START_CUTOFF (needsResolution=true) → excluded from report
        // Only Jul 3 simples (60 min) counted: floor(60/30)/2 = 1.0
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(1.0);
        assertThat(emp.getDiasNoLaborados()).isEqualTo(11);
    }

    @Test
    void test22_mixedFlags() throws Exception {
        TasUploadResult result = processFile("22-mixed-flags.csv");

        assertThat(goesToVerification(result)).isTrue();
        assertThat(result.getAllSessions()).hasSize(3);

        // Jul 1: 07:00, 13:00 → SHORT_DAY (2 even scans, lastScan < threshold)
        assertThat(sessionsWithFlag(result, TasFlag.SHORT_DAY)).hasSize(1);

        // Jul 2: 07:00 → single scan → MISSING_EXIT
        assertThat(sessionsWithFlag(result, TasFlag.MISSING_EXIT)).hasSize(1);

        // Only MISSING_EXIT needs resolution (SHORT_DAY doesn't block)
        assertThat(flaggedSessions(result)).hasSize(1);
        assertThat(flaggedSessions(result).get(0).getDate()).isEqualTo(LocalDate.of(2026, 7, 2));
    }

    @Test
    void test23_breakOvertime() throws Exception {
        TasUploadResult result = processFile("23-break-overtime.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(2);

        List<TasSession> sessions = result.getAllSessions().stream()
                .sorted(Comparator.comparing(s -> s.getDate().toString()))
                .collect(Collectors.toList());

        // Jul 1: 07:00-12:00-13:30-18:00, break=90min, deductible=45, span=660, worked=615 → 10.0h
        // simples = 615-480 = 135 min
        assertThat(sessions.get(0).getWorkedHours()).isEqualTo(10.0);
        assertThat(sessions.get(0).getBreakDeductionMinutes()).isEqualTo(45);
        assertThat(sessions.get(0).getSimplesMinutes()).isEqualTo(135);

        // Jul 2: 07:00-11:00-14:00-18:00, break=180min, deductible=135, span=660, worked=525 → 8.5h
        // simples = 525-480 = 45 min
        assertThat(sessions.get(1).getWorkedHours()).isEqualTo(8.5);
        assertThat(sessions.get(1).getBreakDeductionMinutes()).isEqualTo(135);
        assertThat(sessions.get(1).getSimplesMinutes()).isEqualTo(45);

        EmployeeRow emp = findEmployee(result, "123");
        // Round each session then sum: floor(135/30)/2=2.0 + floor(45/30)/2=0.5 = 2.5
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(2.5);
    }

    @Test
    void test24_dedupBoundary() throws Exception {
        TasUploadResult result = processFile("24-dedup-boundary.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(2);

        List<TasSession> sessions = result.getAllSessions().stream()
                .sorted(Comparator.comparing(s -> s.getDate().toString()))
                .collect(Collectors.toList());

        // Jul 1: [07:00, 07:04, 15:00, 15:04] → after dedup [07:00, 15:00] (4-min gaps removed)
        assertThat(sessions.get(0).getScans()).hasSize(2);
        assertThat(sessions.get(0).getWorkedHours()).isEqualTo(8.0);

        // Jul 2: [07:00, 07:05, 15:00, 15:05] → after dedup [07:00, 07:05, 15:00, 15:05] (5-min gaps kept)
        assertThat(sessions.get(1).getScans()).hasSize(4);
    }

    @Test
    void test25_noOvertimeAccrual() throws Exception {
        when(registryService.getAccruesOvertimeFlags(anyCollection()))
                .thenAnswer(inv -> {
                    Collection<String> ids = inv.getArgument(0);
                    Map<String, Boolean> result = new HashMap<>();
                    for (String id : ids) {
                        result.put(id, !"125".equals(id));
                    }
                    return result;
                });

        TasUploadResult result = processFile("25-no-overtime-accrual.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(2);

        List<TasSession> sessions = result.getAllSessions().stream()
                .sorted(Comparator.comparing(s -> s.getDate().toString()))
                .collect(Collectors.toList());

        // Jul 1: 07:00-17:00 = 600 min → 10.0h, raw simples = 120 min
        assertThat(sessions.get(0).getWorkedHours()).isEqualTo(10.0);
        assertThat(sessions.get(0).getSimplesMinutes()).isEqualTo(120);

        // But report zeroes overtime because accruesOvertime=false
        EmployeeRow emp = findEmployee(result, "125");
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(0);
        assertThat(emp.getHorasExtrasDobles()).isEqualTo(0);
    }

    @Test
    void test27_decimalOvertime_halfHourProducesPointFive() throws Exception {
        TasUploadResult result = processFile("27-decimal-overtime.csv");

        assertThat(goesToVerification(result)).isFalse();
        assertThat(result.getAllSessions()).hasSize(1);

        // Jul 1: 07:00–15:30 = 510 min, overtime = 30 min → floor(30/30)/2 = 0.5h
        // Previously integer rounding would have produced 0 or 1; decimal must be 0.5.
        EmployeeRow emp = findEmployee(result, "127");
        assertThat(emp.getHorasExtrasSimples()).isEqualTo(0.5);
        assertThat(emp.getHorasExtrasDobles()).isEqualTo(0.0);
        assertThat(emp.getDiasNoLaborados()).isEqualTo(12);
    }

    @Test
    void test26_singleScan() throws Exception {
        TasUploadResult result = processFile("26-single-scan.csv");

        assertThat(goesToVerification(result)).isTrue();
        assertThat(result.getAllSessions()).hasSize(1);
        assertThat(flaggedSessions(result)).hasSize(1);

        TasSession session = result.getAllSessions().get(0);
        assertThat(session.getFlags()).contains(TasFlag.MISSING_EXIT);
        assertThat(session.getWorkedHours()).isEqualTo(0);
    }
}
