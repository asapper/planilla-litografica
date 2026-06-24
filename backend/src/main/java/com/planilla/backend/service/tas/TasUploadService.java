package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
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

        Set<String> upserted = new HashSet<>();
        for (TasScanRecord scan : allScans) {
            if (upserted.add(scan.getEmployeeId())) {
                registryService.upsertEmployee(scan.getEmployeeId(), scan.getEmployeeName());
            }
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

        LocalDate reportStart = allScans.stream()
                .map(s -> s.getTimestamp().toLocalDate())
                .min(Comparator.naturalOrder())
                .orElse(LocalDate.now());
        LocalDate reportEnd = allScans.stream()
                .map(s -> s.getTimestamp().toLocalDate())
                .max(Comparator.naturalOrder())
                .orElse(LocalDate.now());

        List<TasScanRecord> scans = allScans.stream()
                .filter(s -> !ignoredEmployeeIds.contains(s.getEmployeeId()))
                .collect(Collectors.toList());

        boolean apiSuccess = holidayService.fetchForDateRange(reportStart, reportEnd);

        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();
        Map<String, String> employeeShiftAssignments = buildShiftAssignments();

        List<TasSession> sessions = sessionGrouper.group(scans, shifts, employeeShiftAssignments);
        hoursCalculator.calculate(sessions, reportStart, reportEnd);

        autoResolveConsistentMismatches(sessions, shifts);

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
        result.setAllSessions(sessions);
        result.setWarnings(warnings);
        result.setUsedFallbackHolidays(!apiSuccess);
        result.setInactiveEmployeesFound(Collections.emptyList());
        result.setAbsentActiveEmployees(absentEmployees);
        result.setReportStart(reportStart);
        result.setReportEnd(reportEnd);
        return result;
    }

    private void autoResolveConsistentMismatches(
            List<TasSession> sessions,
            List<Map<String, Object>> shifts) {

        Map<String, List<TasSession>> byEmployee = new LinkedHashMap<>();
        for (TasSession s : sessions) {
            byEmployee.computeIfAbsent(s.getEmployeeId(), k -> new ArrayList<>()).add(s);
        }

        for (Map.Entry<String, List<TasSession>> entry : byEmployee.entrySet()) {
            List<TasSession> empSessions = entry.getValue();
            List<TasSession> pureShiftMismatch = empSessions.stream()
                    .filter(s -> s.isNeedsResolution()
                            && s.getFlags() != null
                            && s.getFlags().size() == 1
                            && s.getFlags().get(0) == TasFlag.SHIFT_MISMATCH)
                    .collect(Collectors.toList());
            if (pureShiftMismatch.isEmpty()) continue;

            Set<String> matchedShiftIds = pureShiftMismatch.stream()
                    .map(TasSession::getMatchedShiftId)
                    .filter(java.util.Objects::nonNull)
                    .collect(Collectors.toSet());
            if (matchedShiftIds.size() != 1) continue;

            String newShiftId = matchedShiftIds.iterator().next();
            for (TasSession s : pureShiftMismatch) {
                s.getFlags().clear();
                s.setAssignedShiftId(newShiftId);
                s.setAssignedShiftName(s.getMatchedShiftName());
                s.setNeedsResolution(false);
                hoursCalculator.recompute(s, shifts);
            }
        }
    }

    private Map<String, String> buildShiftAssignments() {
        Map<String, String> assignments = new LinkedHashMap<>();
        List<Map<String, Object>> allEmployees = registryService.getAll(null, null, null);
        for (Map<String, Object> emp : allEmployees) {
            Object id      = emp.get("id");
            Object shiftId = emp.get("shiftId");
            if (id != null) {
                assignments.put(id.toString(), shiftId != null ? shiftId.toString() : null);
            }
        }
        return assignments;
    }
}
