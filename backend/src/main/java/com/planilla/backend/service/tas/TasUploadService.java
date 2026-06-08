package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasInactiveEmployee;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasUploadResult;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class TasUploadService {

    private final TasParserService        parserService;
    private final EmployeeRegistryService registryService;
    private final HolidayService          holidayService;
    private final TasSessionGrouper       sessionGrouper;
    private final TasHoursCalculator      hoursCalculator;
    private final TasReportBuilder        reportBuilder;
    private final ShiftConfigService      shiftConfigService;

    public TasUploadService(
            TasParserService parserService,
            EmployeeRegistryService registryService,
            HolidayService holidayService,
            TasSessionGrouper sessionGrouper,
            TasHoursCalculator hoursCalculator,
            TasReportBuilder reportBuilder,
            ShiftConfigService shiftConfigService) {
        this.parserService     = parserService;
        this.registryService   = registryService;
        this.holidayService    = holidayService;
        this.sessionGrouper    = sessionGrouper;
        this.hoursCalculator   = hoursCalculator;
        this.reportBuilder     = reportBuilder;
        this.shiftConfigService = shiftConfigService;
    }

    public TasUploadResult process(MultipartFile file, Set<String> ignoredEmployeeIds) throws Exception {
        TasParserService.ParseResult parseResult = parserService.parse(file);
        return processScans(parseResult.scans, parseResult.warnings, ignoredEmployeeIds);
    }

    public TasUploadResult processScans(
            List<TasScanRecord> allScans,
            List<String> warnings,
            Set<String> ignoredEmployeeIds) {

        Set<String> presentIds = allScans.stream()
                .map(TasScanRecord::getEmployeeId)
                .collect(Collectors.toSet());

        for (TasScanRecord scan : allScans) {
            registryService.upsertEmployee(scan.getEmployeeId(), scan.getEmployeeName());
        }

        List<TasInactiveEmployee> inactiveFound = registryService.getInactiveEmployeesPresent(presentIds);
        List<TasInactiveEmployee> unresolvedInactive = inactiveFound.stream()
                .filter(e -> !ignoredEmployeeIds.contains(e.getEmployeeId()))
                .collect(Collectors.toList());

        if (!unresolvedInactive.isEmpty()) {
            TasUploadResult earlyResult = new TasUploadResult();
            earlyResult.setInactiveEmployeesFound(unresolvedInactive);
            earlyResult.setWarnings(warnings);
            return earlyResult;
        }

        List<TasScanRecord> scans = allScans.stream()
                .filter(s -> !ignoredEmployeeIds.contains(s.getEmployeeId()))
                .collect(Collectors.toList());

        LocalDate reportStart = scans.stream()
                .map(s -> s.getTimestamp().toLocalDate())
                .min(Comparator.naturalOrder())
                .orElse(LocalDate.now());
        LocalDate reportEnd = scans.stream()
                .map(s -> s.getTimestamp().toLocalDate())
                .max(Comparator.naturalOrder())
                .orElse(LocalDate.now());

        boolean apiSuccess = holidayService.fetchForDateRange(reportStart, reportEnd);

        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();
        Map<String, String> employeeShiftAssignments = buildShiftAssignments();

        List<TasSession> sessions = sessionGrouper.group(scans, shifts, employeeShiftAssignments);
        hoursCalculator.calculate(sessions, reportStart, reportEnd);

        TasReportBuilder.BuildResult buildResult = reportBuilder.build(sessions, reportStart, reportEnd, shifts);
        List<EmployeeRow> resolvedRows = buildResult.rows;

        Set<String> sessionEmployeeIds = sessions.stream()
                .map(TasSession::getEmployeeId)
                .collect(Collectors.toSet());
        List<com.planilla.backend.model.tas.TasAbsentEmployee> absentEmployees =
                registryService.getAbsentActiveEmployees(sessionEmployeeIds);

        List<TasSession> flaggedSessions = sessions.stream()
                .filter(TasSession::isNeedsResolution)
                .collect(Collectors.toList());

        TasUploadResult result = new TasUploadResult();
        result.setResolvedRows(resolvedRows);
        result.setFlaggedSessions(flaggedSessions);
        result.setWarnings(warnings);
        result.setUsedFallbackHolidays(!apiSuccess);
        result.setInactiveEmployeesFound(Collections.emptyList());
        result.setAbsentActiveEmployees(absentEmployees);
        return result;
    }

    private Map<String, String> buildShiftAssignments() {
        Map<String, String> assignments = new LinkedHashMap<>();
        List<Map<String, Object>> allEmployees = registryService.getAll(null, null, null);
        for (Map<String, Object> emp : allEmployees) {
            Object id      = emp.get("EMPLOYEE_ID");
            if (id == null) id = emp.get("employee_id");
            Object shiftId = emp.get("SHIFT_ID");
            if (shiftId == null) shiftId = emp.get("shift_id");
            if (id != null) {
                assignments.put(id.toString(), shiftId != null ? shiftId.toString() : null);
            }
        }
        return assignments;
    }
}
