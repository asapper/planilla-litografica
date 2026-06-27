package com.planilla.backend.controller;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasPeriod;
import com.planilla.backend.model.tas.TasUploadResult;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.JobNotFoundException;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.tas.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/tas")
public class TasController {

    private static final Logger log = LoggerFactory.getLogger(TasController.class);

    private final TasParserService        parserService;
    private final TasUploadService        uploadService;
    private final TasReportBuilder        reportBuilder;
    private final EmployeeRegistryService registryService;
    private final JobService              jobService;
    private final ShiftConfigService      shiftConfigService;
    private final TasHoursCalculator      hoursCalculator;
    private final DatabaseService         databaseService;

    final ConcurrentHashMap<String, TasUploadState> stateStore = new ConcurrentHashMap<>();

    public TasController(
            TasParserService parserService,
            TasUploadService uploadService,
            TasReportBuilder reportBuilder,
            EmployeeRegistryService registryService,
            JobService jobService,
            ShiftConfigService shiftConfigService,
            TasHoursCalculator hoursCalculator,
            DatabaseService databaseService) {
        this.parserService      = parserService;
        this.uploadService      = uploadService;
        this.reportBuilder      = reportBuilder;
        this.registryService    = registryService;
        this.jobService         = jobService;
        this.shiftConfigService = shiftConfigService;
        this.hoursCalculator    = hoursCalculator;
        this.databaseService    = databaseService;
    }

    @Scheduled(fixedRate = 600_000)   // runs every 10 minutes
    void evictStaleStates() {
        Instant cutoff = Instant.now().minusSeconds(1800); // 30-minute TTL
        stateStore.entrySet().removeIf(e -> e.getValue().getCreatedAt().isBefore(cutoff));
        log.debug("stateStore eviction pass complete; entries remaining: {}", stateStore.size());
    }

    @PostMapping(value = "/upload", consumes = "multipart/form-data")
    public ResponseEntity<?> upload(@RequestParam("file") MultipartFile file) {
        try {
            TasParserService.ParseResult parseResult = parseFile(file);
            TasUploadResult result = uploadService.processScans(
                    parseResult.scans, parseResult.warnings, Collections.emptySet());

            String token = UUID.randomUUID().toString();

            if (result.getInactiveEmployeesFound() != null && !result.getInactiveEmployeesFound().isEmpty()) {
                TasUploadState state = new TasUploadState();
                state.setUploadToken(token);
                state.setAllScans(parseResult.scans);
                state.setIgnoredEmployeeIds(new HashSet<>());
                stateStore.put(token, state);

                return ResponseEntity.ok(buildResponseBody(token, result));
            }

            TasUploadState state = buildState(token, result, parseResult.scans, Collections.emptySet());
            stateStore.put(token, state);

            return ResponseEntity.ok(buildResponseBody(token, result));

        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                "code", "UPLOAD_FAILED",
                "message", e.getMessage() != null ? e.getMessage() : "Error al procesar el archivo."
            ));
        }
    }

    @PostMapping("/inactive-review")
    public ResponseEntity<?> inactiveReview(@RequestBody Map<String, Object> body) {
        String token = (String) body.get("uploadToken");
        if (token == null) {
            return ResponseEntity.badRequest().body(Map.of("code", "INVALID_TOKEN", "message", "Token inválido."));
        }
        TasUploadState existing = stateStore.get(token);
        if (existing == null) {
            return ResponseEntity.badRequest().body(Map.of("code", "INVALID_TOKEN", "message", "Token inválido."));
        }

        @SuppressWarnings("unchecked")
        List<String> reactivate = (List<String>) body.getOrDefault("reactivate", Collections.emptyList());
        @SuppressWarnings("unchecked")
        List<String> ignore = (List<String>) body.getOrDefault("ignore", Collections.emptyList());

        for (String empId : reactivate) {
            registryService.setActive(empId, true);
        }

        Set<String> ignoredIds = existing.getIgnoredEmployeeIds() != null
                ? new HashSet<>(existing.getIgnoredEmployeeIds())
                : new HashSet<>();
        ignoredIds.addAll(ignore);

        List<TasScanRecord> allScans = existing.getAllScans();
        if (allScans == null) allScans = Collections.emptyList();

        TasUploadResult result = uploadService.processScans(allScans, Collections.emptyList(), ignoredIds);

        if (result.getInactiveEmployeesFound() != null && !result.getInactiveEmployeesFound().isEmpty()) {
            existing.setIgnoredEmployeeIds(ignoredIds);
            return ResponseEntity.ok(buildResponseBody(token, result));
        }

        TasUploadState newState = buildState(token, result, allScans, ignoredIds);
        stateStore.put(token, newState);

        return ResponseEntity.ok(buildResponseBody(token, result));
    }

    @PostMapping("/resolve")
    public ResponseEntity<?> resolve(@RequestBody Map<String, Object> body) {
        String token = (String) body.get("uploadToken");
        TasUploadState state = stateStore.get(token);
        if (state == null) {
            return ResponseEntity.badRequest().body(Map.of("code", "INVALID_TOKEN", "message", "Token inválido."));
        }

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> resolutions = (List<Map<String, Object>>) body.getOrDefault("resolutions", Collections.emptyList());

        List<TasSession> sessions = state.getSessions();
        if (sessions == null) sessions = Collections.emptyList();

        Map<Integer, TasSession> flaggedBySessionId = sessions.stream()
                .filter(TasSession::isNeedsResolution)
                .collect(Collectors.toMap(TasSession::getSessionId, s -> s));

        DateTimeFormatter dtf = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();

        for (Map<String, Object> res : resolutions) {
            Object employeeIdObj = res.get("employeeId");
            Object dateObj = res.get("date");
            Object keepSessionIdObj = res.get("keepSessionId");
            if (employeeIdObj != null && dateObj != null && keepSessionIdObj != null) {
                java.time.LocalDate resolutionDate;
                try {
                    resolutionDate = java.time.LocalDate.parse((String) dateObj);
                } catch (java.time.format.DateTimeParseException e) {
                    return ResponseEntity.badRequest().body(Map.of(
                        "code", "INVALID_TIME_FORMAT",
                        "message", "Formato de fecha inválido. Use yyyy-MM-dd."
                    ));
                }
                applySameDayDoubleResolution(sessions, (String) employeeIdObj,
                        resolutionDate, keepSessionIdObj, shifts);
                continue;
            }

            Object sessionIdObj = res.get("sessionId");
            if (sessionIdObj == null) continue;
            int sessionId = ((Number) sessionIdObj).intValue();
            TasSession session = flaggedBySessionId.get(sessionId);
            if (session == null) continue;

            String resolvedStart = (String) res.get("resolvedStart");
            String resolvedEnd   = (String) res.get("resolvedEnd");
            String acceptedShiftId = (String) res.get("acceptedShiftId");

            if (resolvedStart != null && resolvedEnd != null) {
                LocalDateTime start;
                LocalDateTime end;
                try {
                    start = LocalDateTime.parse(resolvedStart, dtf);
                    end   = LocalDateTime.parse(resolvedEnd, dtf);
                } catch (java.time.format.DateTimeParseException e) {
                    return ResponseEntity.badRequest().body(Map.of(
                        "code", "INVALID_TIME_FORMAT",
                        "message", "Formato de hora inválido. Use yyyy-MM-dd HH:mm."
                    ));
                }

                if (!end.isAfter(start)) {
                    return ResponseEntity.badRequest().body(Map.of(
                        "code", "INVALID_TIME_RANGE",
                        "message", "La hora de salida debe ser posterior a la hora de entrada."
                    ));
                }

                session.setEffectiveStart(start);
                session.setLastScan(end);
                session.setScans(List.of(start, end));
                session.setFlags(Collections.emptyList());
                session.setNeedsResolution(false);

                long workedMinutes = java.time.temporal.ChronoUnit.MINUTES.between(start, end);
                session.setWorkedMinutes((int) workedMinutes);
                session.setWorkedHours(TasHoursCalculator.roundToHalfHour((int) workedMinutes));
                hoursCalculator.classifyHours(session, shifts);
            } else if (acceptedShiftId != null) {
                session.setMatchedShiftId(acceptedShiftId);
                session.getFlags().removeIf(f -> f == TasFlag.SHIFT_MISMATCH);

                boolean hasBlockingFlags = session.getFlags().stream()
                        .anyMatch(f -> f != TasFlag.BEST_FIT_SHIFT && f != TasFlag.SHORT_DAY);
                session.setNeedsResolution(hasBlockingFlags);

                if (!hasBlockingFlags) {
                    hoursCalculator.recompute(session, shifts);
                }
            }
        }
        TasPeriod periodFilter = null;
        Object anioObj = body.get("anio");
        Object mesObj = body.get("mes");
        Object numeroDequincenaObj = body.get("numeroDequincena");
        if (anioObj != null && mesObj != null && numeroDequincenaObj != null) {
            periodFilter = new TasPeriod(
                    ((Number) anioObj).intValue(),
                    ((Number) mesObj).intValue(),
                    ((Number) numeroDequincenaObj).intValue());
            state.setResolvedPeriod(periodFilter);
        }

        TasReportBuilder.BuildResult buildResult = reportBuilder.build(
                sessions, state.getReportStart(), state.getReportEnd(), shifts, periodFilter);
        state.setResolvedRows(buildResult.rows);

        List<TasSession> remainingFlagged = sessions.stream()
                .filter(TasSession::isNeedsResolution)
                .collect(Collectors.toList());

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("uploadToken", token);
        resp.put("resolvedRows", state.getResolvedRows());
        resp.put("flaggedSessions", remainingFlagged);
        resp.put("usedFallbackHolidays", state.isUsedFallbackHolidays());
        resp.put("availablePeriods", reportBuilder.computeAvailablePeriods(sessions));
        resp.put("availableShifts", mapAvailableShifts(shifts));
        resp.put("sessionSummaries", buildSessionSummaries(sessions, periodFilter));
        return ResponseEntity.ok(resp);
    }

    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<?> getJobStatus(@PathVariable String jobId) {
        JobService.JobStatusDto status = jobService.getJobStatus(jobId);
        if (status == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(status);
    }

    @PostMapping("/jobs/{jobId}/retry")
    public ResponseEntity<?> retryJob(@PathVariable String jobId) {
        try {
            String retryJobId = jobService.createRetryJob(jobId);
            jobService.processRetryJobAsync(retryJobId);
            return ResponseEntity.ok(Map.of("jobId", retryJobId));
        } catch (JobNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(409).body(Map.of(
                "code", "MAX_RETRIES_EXHAUSTED",
                "message", e.getMessage()
            ));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(Map.of(
                "code", "NOT_RETRYABLE",
                "message", e.getMessage()
            ));
        }
    }

    @PostMapping("/check-duplicates")
    public ResponseEntity<?> checkDuplicates(@RequestBody Map<String, Object> body) {
        String token = (String) body.get("uploadToken");
        TasUploadState state = stateStore.get(token);
        if (state == null) {
            return ResponseEntity.notFound().build();
        }

        List<EmployeeRow> rows = state.getResolvedRows();
        if (rows == null) rows = Collections.emptyList();

        List<String> duplicates = databaseService.checkDuplicates(rows);
        return ResponseEntity.ok(Map.of("duplicates", duplicates));
    }

    @PostMapping("/submit")
    public ResponseEntity<?> submit(@RequestBody Map<String, Object> body) {
        String token = (String) body.get("uploadToken");
        TasUploadState state = stateStore.get(token);
        if (state == null) {
            return ResponseEntity.badRequest().body(Map.of("code", "INVALID_TOKEN", "message", "Token inválido."));
        }

        List<TasSession> sessions = state.getSessions();
        if (sessions == null) sessions = Collections.emptyList();

        TasPeriod resolvedPeriod = state.getResolvedPeriod();
        List<TasSession> unresolved = sessions.stream()
                .filter(TasSession::isNeedsResolution)
                .filter(s -> resolvedPeriod == null || resolvedPeriod.equals(TasPeriod.of(s.getDate())))
                .collect(Collectors.toList());
        if (!unresolved.isEmpty()) {
            return ResponseEntity.status(409).body(Map.of(
                "code", "UNRESOLVED_SESSIONS",
                "message", "Hay sesiones pendientes de resolución.",
                "count", unresolved.size()
            ));
        }

        List<EmployeeRow> storedRows = state.getResolvedRows();
        if (storedRows == null || storedRows.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("code", "NO_ROWS", "message", "No hay filas para enviar."));
        }
        List<EmployeeRow> rows = storedRows.stream().map(EmployeeRow::new).collect(Collectors.toList());

        Object rawOverrides = body.getOrDefault("overtimeOverrides", Collections.emptyMap());
        if (!(rawOverrides instanceof Map)) {
            return ResponseEntity.badRequest().body(Map.of(
                "code", "INVALID_OVERRIDE",
                "message", "Formato de horas extra inválido."));
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> overtimeOverrides = (Map<String, Object>) rawOverrides;

        for (Map.Entry<String, Object> entry : overtimeOverrides.entrySet()) {
            String empId = entry.getKey();
            if (!(entry.getValue() instanceof Map)) {
                return ResponseEntity.badRequest().body(Map.of(
                    "code", "INVALID_OVERRIDE",
                    "message", "Formato de horas extra inválido."));
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> fields = (Map<String, Object>) entry.getValue();
            for (EmployeeRow r : rows) {
                if (r.getCodigoEmpleado().equals(empId)) {
                    if (fields.containsKey("horasExtrasSimples")) {
                        Object raw = fields.get("horasExtrasSimples");
                        if (!(raw instanceof Number)) {
                            return ResponseEntity.badRequest().body(Map.of(
                                "code", "INVALID_OVERRIDE",
                                "message", "Formato de horas extra inválido."));
                        }
                        double val = Math.round(((Number) raw).doubleValue() * 2) / 2.0;
                        if (val < 0) {
                            return ResponseEntity.badRequest().body(Map.of(
                                "code", "INVALID_OVERRIDE",
                                "message", "Los valores de horas extra no pueden ser negativos."));
                        }
                        r.setHorasExtrasSimples(val);
                    }
                    if (fields.containsKey("horasExtrasDobles")) {
                        Object raw = fields.get("horasExtrasDobles");
                        if (!(raw instanceof Number)) {
                            return ResponseEntity.badRequest().body(Map.of(
                                "code", "INVALID_OVERRIDE",
                                "message", "Formato de horas extra inválido."));
                        }
                        double val = Math.round(((Number) raw).doubleValue() * 2) / 2.0;
                        if (val < 0) {
                            return ResponseEntity.badRequest().body(Map.of(
                                "code", "INVALID_OVERRIDE",
                                "message", "Los valores de horas extra no pueden ser negativos."));
                        }
                        r.setHorasExtrasDobles(val);
                    }
                    break;
                }
            }
        }

        Object rawNonWorkedDaysOverrides = body.getOrDefault("nonWorkedDaysOverrides", Collections.emptyMap());
        if (!(rawNonWorkedDaysOverrides instanceof Map)) {
            return ResponseEntity.badRequest().body(Map.of(
                "code", "INVALID_OVERRIDE",
                "message", "Formato de días no laborados inválido."));
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> nonWorkedDaysOverrides = (Map<String, Object>) rawNonWorkedDaysOverrides;

        for (Map.Entry<String, Object> entry : nonWorkedDaysOverrides.entrySet()) {
            String empId = entry.getKey();
            Object raw = entry.getValue();
            if (!(raw instanceof Number)) {
                return ResponseEntity.badRequest().body(Map.of(
                    "code", "INVALID_OVERRIDE",
                    "message", "Formato de días no laborados inválido."));
            }
            int val;
            try {
                val = Math.toIntExact(Math.round(((Number) raw).doubleValue()));
            } catch (ArithmeticException e) {
                return ResponseEntity.badRequest().body(Map.of(
                    "code", "INVALID_OVERRIDE",
                    "message", "Formato de días no laborados inválido."));
            }
            if (val < 0) {
                return ResponseEntity.badRequest().body(Map.of(
                    "code", "INVALID_OVERRIDE",
                    "message", "Los días no laborados no pueden ser negativos."));
            }
            for (EmployeeRow r : rows) {
                if (r.getCodigoEmpleado().equals(empId)) {
                    r.setDiasNoLaborados(val);
                    break;
                }
            }
        }

        String jobId = jobService.createJob(rows);
        jobService.processJobAsync(jobId, token, stateStore);
        return ResponseEntity.status(202).body(Map.of("jobId", jobId));
    }

    @PostMapping("/recompute/{uploadToken}")
    public ResponseEntity<?> recompute(@PathVariable String uploadToken) {
        TasUploadState state = stateStore.get(uploadToken);
        if (state == null) {
            return ResponseEntity.badRequest().body(Map.of("code", "INVALID_TOKEN", "message", "Token inválido."));
        }

        List<TasSession> sessions = state.getSessions();
        if (sessions == null) sessions = Collections.emptyList();

        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();

        TasReportBuilder.BuildResult buildResult = reportBuilder.build(
                sessions, state.getReportStart(), state.getReportEnd(), shifts, state.getResolvedPeriod());
        state.setResolvedRows(buildResult.rows);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("uploadToken", uploadToken);
        resp.put("resolvedRows", state.getResolvedRows());
        resp.put("sessionSummaries", buildSessionSummaries(sessions, state.getResolvedPeriod()));
        return ResponseEntity.ok(resp);
    }

    @GetMapping("/absent-review/{uploadToken}")
    public ResponseEntity<?> getAbsentReview(@PathVariable String uploadToken) {
        TasUploadState state = stateStore.get(uploadToken);
        if (state == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(Map.of(
            "absentEmployees", state.getAbsentEmployees() != null ? state.getAbsentEmployees() : Collections.emptyList()
        ));
    }

    @PostMapping("/absent-review/{uploadToken}/deactivate")
    public ResponseEntity<?> deactivateAbsent(
            @PathVariable String uploadToken,
            @RequestBody Map<String, Object> body) {

        TasUploadState state = stateStore.get(uploadToken);
        if (state == null) {
            return ResponseEntity.notFound().build();
        }

        @SuppressWarnings("unchecked")
        List<String> employeeIds = (List<String>) body.getOrDefault("employeeIds", Collections.emptyList());
        boolean active = (boolean) body.getOrDefault("active", false);

        List<String> unknown = new ArrayList<>();
        for (String empId : employeeIds) {
            if (registryService.isNewEmployee(empId)) {
                unknown.add(empId);
            } else {
                registryService.setActive(empId, active);
            }
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("updated", employeeIds.size() - unknown.size());
        resp.put("notFound", unknown);
        return ResponseEntity.ok(resp);
    }

    private TasParserService.ParseResult parseFile(MultipartFile file) throws Exception {
        return parserService.parse(file);
    }

    private TasUploadState buildState(
            String token,
            TasUploadResult result,
            List<TasScanRecord> allScans,
            Set<String> ignoredEmployeeIds) {

        TasUploadState state = new TasUploadState();
        state.setUploadToken(token);
        state.setAllScans(allScans);
        state.setSessions(result.getAllSessions() != null
                ? result.getAllSessions()
                : Collections.emptyList());
        state.setResolvedRows(result.getResolvedRows());
        state.setUsedFallbackHolidays(result.isUsedFallbackHolidays());
        state.setAbsentEmployees(result.getAbsentActiveEmployees());
        state.setIgnoredEmployeeIds(new HashSet<>(ignoredEmployeeIds));
        state.setReportStart(result.getReportStart());
        state.setReportEnd(result.getReportEnd());
        return state;
    }

    private void applySameDayDoubleResolution(
            List<TasSession> sessions,
            String employeeId,
            java.time.LocalDate date,
            Object keepSessionIdObj,
            List<Map<String, Object>> shifts) {

        boolean keepAll = "all".equals(keepSessionIdObj);
        Integer keepSessionId = keepAll ? null : ((Number) keepSessionIdObj).intValue();

        List<TasSession> group = sessions.stream()
                .filter(s -> employeeId.equals(s.getEmployeeId())
                        && date.equals(s.getDate())
                        && s.getFlags() != null
                        && s.getFlags().contains(TasFlag.SAME_DAY_DOUBLE))
                .collect(Collectors.toList());

        boolean keepSessionIdInGroup = !keepAll && group.stream()
                .anyMatch(s -> s.getSessionId() == keepSessionId);
        if (!keepAll && !keepSessionIdInGroup) {
            keepAll = true;
        }

        for (TasSession session : group) {
            session.getFlags().removeIf(f -> f == TasFlag.SAME_DAY_DOUBLE || f == TasFlag.SHIFT_MISMATCH);

            boolean discard = !keepAll && session.getSessionId() != keepSessionId;
            if (discard) {
                session.setWorkedMinutes(0);
                session.setWorkedHours(0.0);
                session.setSimplesMinutes(0);
                session.setDoblesMinutes(0);
                session.setNeedsResolution(false);
            } else {
                boolean hasBlockingFlags = session.getFlags().stream()
                        .anyMatch(f -> f != TasFlag.BEST_FIT_SHIFT && f != TasFlag.SHORT_DAY);
                session.setNeedsResolution(hasBlockingFlags);
                if (!hasBlockingFlags) {
                    hoursCalculator.recompute(session, shifts);
                }
            }
        }
    }

    private List<Map<String, Object>> mapAvailableShifts(List<Map<String, Object>> shifts) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> shift : shifts) {
            Map<String, Object> dto = new LinkedHashMap<>();
            dto.put("id", shift.get("id"));
            dto.put("name", shift.get("name"));
            dto.put("startTime", shift.get("startTime"));
            dto.put("endTime", shift.get("endTime"));
            dto.put("crossMidnight", Boolean.TRUE.equals(shift.get("crossMidnight")));
            result.add(dto);
        }
        return result;
    }

    private Map<String, List<Map<String, Object>>> buildSessionSummaries(
            List<TasSession> sessions, TasPeriod periodFilter) {
        if (sessions == null) return Collections.emptyMap();

        Map<String, List<Map<String, Object>>> result = new LinkedHashMap<>();

        List<TasSession> filtered = sessions.stream()
                .filter(s -> !s.isNeedsResolution() && s.getDate() != null)
                .filter(s -> periodFilter == null || TasPeriod.of(s.getDate()).equals(periodFilter))
                .sorted(Comparator.comparing(TasSession::getDate))
                .collect(Collectors.toList());

        for (TasSession s : filtered) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("date", s.getDate().toString());
            entry.put("shiftName", s.getMatchedShiftName());
            entry.put("entryTime", s.getEffectiveStart() != null ? s.getEffectiveStart().toString() : null);
            entry.put("exitTime", s.getLastScan() != null ? s.getLastScan().toString() : null);
            entry.put("workedHours", s.getWorkedHours());
            entry.put("simplesMinutes", s.getSimplesMinutes());
            entry.put("doblesMinutes", s.getDoblesMinutes());
            List<String> scanStrings = s.getScans() != null
                ? s.getScans().stream().map(java.time.LocalDateTime::toString).collect(Collectors.toList())
                : Collections.emptyList();
            entry.put("scans", scanStrings);
            entry.put("estimatedShift", s.getFlags() != null && s.getFlags().contains(TasFlag.BEST_FIT_SHIFT));
            entry.put("breakDeductionMinutes", s.getBreakDeductionMinutes());

            result.computeIfAbsent(s.getEmployeeId(), k -> new ArrayList<>()).add(entry);
        }

        return result;
    }

    private Map<String, Object> buildResponseBody(String token, TasUploadResult result) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolvedRows", result.getResolvedRows() != null
                ? result.getResolvedRows()
                : Collections.emptyList());
        body.put("flaggedSessions", result.getFlaggedSessions() != null
                ? result.getFlaggedSessions()
                : Collections.emptyList());
        body.put("inactiveEmployeesFound", result.getInactiveEmployeesFound() != null
                ? result.getInactiveEmployeesFound()
                : Collections.emptyList());
        body.put("warnings", result.getWarnings());
        body.put("usedFallbackHolidays", result.isUsedFallbackHolidays());
        body.put("absentActiveEmployees", result.getAbsentActiveEmployees() != null
                ? result.getAbsentActiveEmployees()
                : Collections.emptyList());
        body.put("availablePeriods", reportBuilder.computeAvailablePeriods(
                result.getAllSessions() != null ? result.getAllSessions() : Collections.emptyList()));
        body.put("availableShifts", mapAvailableShifts(shiftConfigService.getAllShifts()));
        body.put("sessionSummaries", buildSessionSummaries(
                result.getAllSessions() != null ? result.getAllSessions() : Collections.emptyList(), null));
        return body;
    }
}
