package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasPeriod;
import com.planilla.backend.model.tas.TasUploadResult;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.JobInProgressException;
import com.planilla.backend.service.JobNotFoundException;
import com.planilla.backend.service.JobNotRetryableException;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.MaxRetriesExhaustedException;
import com.planilla.backend.service.tas.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.time.LocalDate;
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
    private final TasDraftService         draftService;

    final ConcurrentHashMap<String, TasUploadState> stateStore = new ConcurrentHashMap<>();

    private static final Set<String> SAVABLE_VIEWS = Set.of("inactiveReview", "verification", "review");
    private static final int MAX_TOKEN_LENGTH = 64;
    private static final int MAX_FILE_NAME_LENGTH = 255;
    private static final int MAX_PERIOD_LABEL_LENGTH = 64;
    private static final String DRAFT_OUTDATED_MESSAGE =
            "La sesión guardada es de otra versión de la aplicación y no se puede continuar.";

    public TasController(
            TasParserService parserService,
            TasUploadService uploadService,
            TasReportBuilder reportBuilder,
            EmployeeRegistryService registryService,
            JobService jobService,
            ShiftConfigService shiftConfigService,
            TasHoursCalculator hoursCalculator,
            DatabaseService databaseService,
            TasDraftService draftService) {
        this.parserService      = parserService;
        this.uploadService      = uploadService;
        this.reportBuilder      = reportBuilder;
        this.registryService    = registryService;
        this.jobService         = jobService;
        this.shiftConfigService = shiftConfigService;
        this.hoursCalculator    = hoursCalculator;
        this.databaseService    = databaseService;
        this.draftService       = draftService;
    }

    @Scheduled(fixedRate = 600_000)   // runs every 10 minutes
    void evictStaleStates() {
        Instant cutoff = Instant.now().minusSeconds(1800); // 30 idle minutes
        String draftToken = draftService.currentToken();
        stateStore.entrySet().removeIf(e ->
                !e.getKey().equals(draftToken) && e.getValue().getLastAccessedAt().isBefore(cutoff));
        log.debug("stateStore eviction pass complete; entries remaining: {}", stateStore.size());
    }

    TasUploadState getState(String token) {
        if (token == null || token.isEmpty()) return null;
        TasUploadState state = stateStore.computeIfAbsent(token, draftService::loadState);
        if (state != null) state.touch();
        return state;
    }

    private static String tokenOf(Map<String, Object> body) {
        return body.get("uploadToken") instanceof String s ? s : null;
    }

    private static ResponseEntity<Map<String, Object>> error(int status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of("code", code, "message", message));
    }

    private static ResponseEntity<Map<String, Object>> sessionError(String code, String message, int sessionId) {
        return ResponseEntity.status(400).body(Map.of("code", code, "message", message, "sessionId", sessionId));
    }

    /** Call inside {@code synchronized (state)}: false once the state was replaced or removed. */
    private boolean isCurrent(String token, TasUploadState state) {
        return stateStore.get(token) == state;
    }

    private static ResponseEntity<Map<String, Object>> stateChanged() {
        return error(409, "STATE_CHANGED", "La sesión cambió. Intente nuevamente.");
    }

    private static ResponseEntity<Map<String, Object>> invalidToken() {
        return error(400, "INVALID_TOKEN", "Token inválido.");
    }

    private static List<String> stringList(Object raw) {
        if (raw == null) return Collections.emptyList();
        if (!(raw instanceof List<?> list)) return null;
        List<String> out = new ArrayList<>(list.size());
        for (Object o : list) {
            if (!(o instanceof String s)) return null;
            out.add(s);
        }
        return out;
    }

    @PostMapping(value = "/upload", consumes = "multipart/form-data")
    public ResponseEntity<?> upload(@RequestParam("file") MultipartFile file) {
        try {
            TasParserService.ParseResult parseResult = parseFile(file);
            TasUploadResult result = uploadService.processScans(
                    parseResult.scans, parseResult.warnings, Collections.emptySet());

            String token = UUID.randomUUID().toString();

            TasUploadState state;
            if (result.getInactiveEmployeesFound() != null && !result.getInactiveEmployeesFound().isEmpty()) {
                state = new TasUploadState();
                state.setUploadToken(token);
                state.setAllScans(parseResult.scans);
                state.setIgnoredEmployeeIds(new HashSet<>());
            } else {
                state = TasUploadState.from(token, result, parseResult.scans, Collections.emptySet());
            }
            state.setRevision(1);
            stateStore.put(token, state);
            discardDraftForNewUpload();

            return ResponseEntity.ok(buildResponseBody(token, result, state.getRevision()));

        } catch (ParseValidationException e) {
            return ResponseEntity.badRequest().body(Map.of(
                "code", "UPLOAD_FAILED",
                "message", e.getMessage() != null ? e.getMessage() : "Error al procesar el archivo."
            ));
        } catch (Exception e) {
            log.error("TAS upload failed", e);
            return ResponseEntity.badRequest().body(Map.of(
                "code", "UPLOAD_FAILED",
                "message", "Error al procesar el archivo."
            ));
        }
    }

    private void discardDraftForNewUpload() {
        try {
            draftService.delete();
        } catch (Exception e) {
            log.warn("Could not discard the previous TAS draft after a new upload: {}", e.getMessage());
        }
    }

    @PostMapping("/inactive-review")
    public ResponseEntity<?> inactiveReview(@RequestBody Map<String, Object> body) {
        String token = tokenOf(body);
        TasUploadState existing = getState(token);
        if (existing == null) {
            return invalidToken();
        }

        List<String> reactivate = stringList(body.get("reactivate"));
        List<String> ignore = stringList(body.get("ignore"));
        if (reactivate == null || ignore == null) {
            return error(400, "INVALID_FIELD_FORMAT", "Las listas de empleados deben contener textos.");
        }

        synchronized (existing) {
            if (!isCurrent(token, existing)) {
                return stateChanged();
            }

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
            long nextRevision = existing.getRevision() + 1;

            if (result.getInactiveEmployeesFound() != null && !result.getInactiveEmployeesFound().isEmpty()) {
                existing.setIgnoredEmployeeIds(ignoredIds);
                existing.setRevision(nextRevision);
                return ResponseEntity.ok(buildResponseBody(token, result, nextRevision));
            }

            TasUploadState newState = TasUploadState.from(token, result, allScans, ignoredIds);
            newState.setRevision(nextRevision);
            if (!stateStore.replace(token, existing, newState)) {
                return stateChanged();
            }

            return ResponseEntity.ok(buildResponseBody(token, result, nextRevision));
        }
    }

    @PostMapping("/resolve")
    public ResponseEntity<?> resolve(@RequestBody Map<String, Object> body) {
        String token = tokenOf(body);
        TasUploadState state = getState(token);
        if (state == null) {
            return invalidToken();
        }

        Object rawResolutions = body.getOrDefault("resolutions", Collections.emptyList());
        if (!(rawResolutions instanceof List<?> resolutions)) {
            return error(400, "INVALID_FIELD_FORMAT", "Las resoluciones deben ser una lista.");
        }

        TasPeriod periodFilter = null;
        Object anioObj = body.get("anio");
        Object mesObj = body.get("mes");
        Object numeroDequincenaObj = body.get("numeroDequincena");
        if (anioObj != null && mesObj != null && numeroDequincenaObj != null) {
            if (!(anioObj instanceof Number anio) || !(mesObj instanceof Number mes)
                    || !(numeroDequincenaObj instanceof Number numero)) {
                return error(400, "INVALID_FIELD_FORMAT", "El periodo debe indicarse con números.");
            }
            periodFilter = new TasPeriod(anio.intValue(), mes.intValue(), numero.intValue());
        }

        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();

        synchronized (state) {
            if (!isCurrent(token, state)) {
                return stateChanged();
            }
            List<TasSession> sessions = state.getSessions();
            if (sessions == null) sessions = Collections.emptyList();
            final List<TasSession> allSessions = sessions;

            Map<Integer, TasSession> flaggedBySessionId = sessions.stream()
                    .filter(TasSession::shownForVerification)
                    .collect(Collectors.toMap(TasSession::getSessionId, s -> s));

            // Validate the whole batch before touching the state: a 400 halfway through
            // must leave the state and its revision exactly as they were.
            List<Runnable> operations = new ArrayList<>();
            Map<TasSession, LocalDateTime[]> plannedTimes = new LinkedHashMap<>();
            for (Object item : resolutions) {
                if (!(item instanceof Map<?, ?> res)) {
                    return error(400, "INVALID_FIELD_FORMAT", "Cada resolución debe ser un objeto.");
                }
                ResponseEntity<Map<String, Object>> invalid =
                        planResolution(res, flaggedBySessionId, allSessions, shifts, operations, plannedTimes);
                if (invalid != null) return invalid;
            }
            ResponseEntity<Map<String, Object>> overlap = findOverlap(plannedTimes, allSessions);
            if (overlap != null) return overlap;

            // Once applying starts the state may be half-mutated even if a step throws: bump anyway
            // so a pending autosave carrying the old revision is refused instead of pairing it.
            try {
                operations.forEach(Runnable::run);
                if (periodFilter != null) {
                    state.setResolvedPeriod(periodFilter);
                }

                TasReportBuilder.BuildResult buildResult = reportBuilder.build(
                        sessions, state.getReportStart(), state.getReportEnd(), shifts, periodFilter);
                state.setResolvedRows(buildResult.rows);
            } finally {
                state.bumpRevision();
            }

            List<TasSession> remainingFlagged = sessions.stream()
                    .filter(TasSession::shownForVerification)
                    .collect(Collectors.toList());

            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("uploadToken", token);
            resp.put("stateRevision", state.getRevision());
            resp.put("resolvedRows", state.getResolvedRows());
            resp.put("flaggedSessions", remainingFlagged);
            resp.put("usedFallbackHolidays", state.isUsedFallbackHolidays());
            resp.put("availablePeriods", reportBuilder.computeAvailablePeriods(sessions));
            resp.put("availableShifts", mapAvailableShifts(shifts));
            resp.put("sessionSummaries", buildSessionSummaries(sessions, periodFilter));
            return ResponseEntity.ok(resp);
        }
    }

    private ResponseEntity<Map<String, Object>> planResolution(
            Map<?, ?> res,
            Map<Integer, TasSession> flaggedBySessionId,
            List<TasSession> sessions,
            List<Map<String, Object>> shifts,
            List<Runnable> operations,
            Map<TasSession, LocalDateTime[]> plannedTimes) {

        Object employeeIdObj = res.get("employeeId");
        Object dateObj = res.get("date");
        Object keepSessionIdObj = res.get("keepSessionId");
        if (employeeIdObj != null && dateObj != null && keepSessionIdObj != null) {
            if (!(employeeIdObj instanceof String employeeId)) {
                return error(400, "INVALID_EMPLOYEE_FORMAT", "El ID de empleado debe ser un texto.");
            }
            if (!(dateObj instanceof String dateText)) {
                return error(400, "INVALID_TIME_FORMAT", "Formato de fecha inválido. Use yyyy-MM-dd.");
            }
            if (!("all".equals(keepSessionIdObj)) && !(keepSessionIdObj instanceof Number)) {
                return error(400, "INVALID_SESSION_FORMAT", "El ID de sesión debe ser un número o \"all\".");
            }
            java.time.LocalDate resolutionDate;
            try {
                resolutionDate = java.time.LocalDate.parse(dateText);
            } catch (java.time.format.DateTimeParseException e) {
                return error(400, "INVALID_TIME_FORMAT", "Formato de fecha inválido. Use yyyy-MM-dd.");
            }
            operations.add(() -> applySameDayDoubleResolution(
                    sessions, employeeId, resolutionDate, keepSessionIdObj, shifts));
            return null;
        }

        Object sessionIdObj = res.get("sessionId");
        if (sessionIdObj == null) return null;
        if (!(sessionIdObj instanceof Number sessionNumber)) {
            return error(400, "INVALID_SESSION_FORMAT", "El ID de sesión debe ser un número.");
        }
        TasSession session = flaggedBySessionId.get(sessionNumber.intValue());
        if (session == null) return null;

        Object resolvedStartObj   = res.get("resolvedStart");
        Object resolvedEndObj     = res.get("resolvedEnd");
        Object acceptedShiftIdObj = res.get("acceptedShiftId");

        if (resolvedStartObj != null && !(resolvedStartObj instanceof String)) {
            return sessionError("INVALID_TIME_FORMAT", "Formato de hora inválido. Use yyyy-MM-dd HH:mm.", session.getSessionId());
        }
        if (resolvedEndObj != null && !(resolvedEndObj instanceof String)) {
            return sessionError("INVALID_TIME_FORMAT", "Formato de hora inválido. Use yyyy-MM-dd HH:mm.", session.getSessionId());
        }
        if (acceptedShiftIdObj != null && !(acceptedShiftIdObj instanceof String)) {
            return sessionError("INVALID_FIELD_FORMAT", "El ID de turno debe ser un texto.", session.getSessionId());
        }

        if (!session.isNeedsResolution() && acceptedShiftIdObj != null) {
            return sessionError("INVALID_FIELD_FORMAT",
                    "En una jornada corta solo se puede corregir la hora.", session.getSessionId());
        }

        String resolvedStart   = (String) resolvedStartObj;
        String resolvedEnd     = (String) resolvedEndObj;
        String acceptedShiftId = (String) acceptedShiftIdObj;

        if (resolvedStart != null && resolvedEnd != null) {
            DateTimeFormatter dtf = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
            LocalDateTime start;
            LocalDateTime end;
            try {
                start = LocalDateTime.parse(resolvedStart, dtf);
                end   = LocalDateTime.parse(resolvedEnd, dtf);
            } catch (java.time.format.DateTimeParseException e) {
                return sessionError("INVALID_TIME_FORMAT", "Formato de hora inválido. Use yyyy-MM-dd HH:mm.", session.getSessionId());
            }
            if (!end.isAfter(start)) {
                return sessionError("INVALID_TIME_RANGE",
                        "La hora de salida debe ser posterior a la hora de entrada.", session.getSessionId());
            }
            plannedTimes.put(session, new LocalDateTime[] {start, end});
            operations.add(() -> applyResolvedTimes(session, start, end, shifts));
        } else if (acceptedShiftId != null) {
            operations.add(() -> applyAcceptedShift(session, acceptedShiftId, shifts));
        }
        return null;
    }

    /**
     * A typed-in day must not overlap another counted day of the same employee: two halves of one
     * night resolved as the same night would be paid twice.
     */
    private static ResponseEntity<Map<String, Object>> findOverlap(
            Map<TasSession, LocalDateTime[]> plannedTimes, List<TasSession> sessions) {
        DateTimeFormatter shown = DateTimeFormatter.ofPattern("dd/MM HH:mm");
        for (Map.Entry<TasSession, LocalDateTime[]> planned : plannedTimes.entrySet()) {
            TasSession session = planned.getKey();
            LocalDateTime start = planned.getValue()[0];
            LocalDateTime end = planned.getValue()[1];
            for (TasSession other : sessions) {
                if (other == session || !Objects.equals(other.getEmployeeId(), session.getEmployeeId())) continue;
                LocalDateTime[] otherPlanned = plannedTimes.get(other);
                if (otherPlanned == null && (other.isNeedsResolution() || other.getWorkedMinutes() == 0)) continue;
                LocalDateTime otherStart = otherPlanned != null ? otherPlanned[0] : other.getEffectiveStart();
                LocalDateTime otherEnd = otherPlanned != null ? otherPlanned[1] : other.getLastScan();
                if (otherStart == null || otherEnd == null) continue;
                if (start.isBefore(otherEnd) && otherStart.isBefore(end)) {
                    return sessionError("OVERLAPPING_SESSIONS",
                            "La jornada se cruza con otra del mismo empleado (" + otherStart.format(shown)
                                    + " – " + otherEnd.format(shown) + ").",
                            session.getSessionId());
                }
            }
        }
        return null;
    }

    private void applyResolvedTimes(TasSession session, LocalDateTime start, LocalDateTime end,
                                    List<Map<String, Object>> shifts) {
        // When the user swaps a single scan to the other side, or the shift was
        // only a best-fit guess, the shift must follow the resolved entry or
        // overtime is measured against the wrong shift length. A genuinely late
        // arrival on a matched shift keeps its shift.
        boolean shiftWasGuessed = session.getFlags() != null
                && session.getFlags().contains(TasFlag.BEST_FIT_SHIFT);
        if (!start.equals(session.getEffectiveStart())
                && (isSwappedSingleScan(session, start, end) || shiftWasGuessed)) {
            Map<String, Object> bestFit = TasSessionGrouper.findBestFitShift(start, shifts);
            if (bestFit != null) {
                assignShift(session, bestFit);
            }
        }
        // A night is paid on the day it starts, also across the 15th/16th: a night from the 15th into
        // the 16th belongs to the first fortnight, so the second one must not pay its exit half again.
        session.setDate(start.toLocalDate());
        session.setEffectiveStart(start);
        session.setLastScan(end);
        session.setScans(List.of(start, end));
        session.setFlags(Collections.emptyList());
        session.setNeedsResolution(false);

        long workedMinutes = java.time.temporal.ChronoUnit.MINUTES.between(start, end);
        session.setWorkedMinutes((int) workedMinutes);
        session.setWorkedHours(TasHoursCalculator.roundToHalfHour((int) workedMinutes));
        hoursCalculator.classifyHours(session, shifts);
    }

    private static void assignShift(TasSession session, Map<String, Object> shift) {
        session.setMatchedShiftId(TasSessionGrouper.getShiftId(shift));
        session.setMatchedShiftName((String) shift.get("name"));
        session.setCrossMidnight(Boolean.TRUE.equals(shift.get("crossMidnight")));
    }

    private void applyAcceptedShift(TasSession session, String acceptedShiftId,
                                    List<Map<String, Object>> shifts) {
        shifts.stream()
                .filter(shift -> acceptedShiftId.equals(TasSessionGrouper.getShiftId(shift)))
                .findFirst()
                .ifPresentOrElse(shift -> assignShift(session, shift),
                        () -> session.setMatchedShiftId(acceptedShiftId));
        session.getFlags().removeIf(f -> f == TasFlag.SHIFT_MISMATCH);

        boolean hasBlockingFlags = session.getFlags().stream()
                .anyMatch(f -> f != TasFlag.BEST_FIT_SHIFT && f != TasFlag.SHORT_DAY);
        session.setNeedsResolution(hasBlockingFlags);

        if (!hasBlockingFlags) {
            hoursCalculator.recompute(session, shifts);
        }
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
            jobService.processRetryJobAsync(retryJobId, stateStore);
            return ResponseEntity.ok(Map.of("jobId", retryJobId));
        } catch (JobInProgressException e) {
            return jobInProgress(e);
        } catch (JobNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (MaxRetriesExhaustedException e) {
            return ResponseEntity.status(409).body(Map.of(
                "code", "MAX_RETRIES_EXHAUSTED",
                "message", e.getMessage()
            ));
        } catch (JobNotRetryableException e) {
            return ResponseEntity.status(409).body(Map.of(
                "code", "NOT_RETRYABLE",
                "message", e.getMessage()
            ));
        }
    }

    private static ResponseEntity<Map<String, Object>> jobInProgress(JobInProgressException e) {
        return error(409, "JOB_IN_PROGRESS", e.getMessage());
    }

    @PostMapping("/check-duplicates")
    public ResponseEntity<?> checkDuplicates(@RequestBody Map<String, Object> body) {
        TasUploadState state = getState(tokenOf(body));
        if (state == null) {
            return ResponseEntity.notFound().build();
        }

        List<EmployeeRow> rows;
        synchronized (state) {
            rows = state.getResolvedRows();
        }
        if (rows == null) rows = Collections.emptyList();

        List<String> duplicates = databaseService.checkDuplicates(rows);
        return ResponseEntity.ok(Map.of("duplicates", duplicates));
    }

    @PostMapping("/submit")
    public ResponseEntity<?> submit(@RequestBody Map<String, Object> body) {
        String token = tokenOf(body);
        TasUploadState state = getState(token);
        if (state == null) {
            return invalidToken();
        }

        List<EmployeeRow> rows;
        synchronized (state) {
            if (!isCurrent(token, state)) {
                return stateChanged();
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
            rows = storedRows.stream().map(EmployeeRow::new).collect(Collectors.toList());
        }

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
                    if (!r.isAccruesOvertime()) {
                        break;
                    }
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

        String jobId;
        try {
            jobId = jobService.createJob(rows, token);
        } catch (JobInProgressException e) {
            return jobInProgress(e);
        }
        jobService.processJobAsync(jobId, stateStore);
        return ResponseEntity.status(202).body(Map.of("jobId", jobId));
    }

    @PostMapping("/recompute/{uploadToken}")
    public ResponseEntity<?> recompute(@PathVariable String uploadToken) {
        TasUploadState state = getState(uploadToken);
        if (state == null) {
            return invalidToken();
        }

        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();

        synchronized (state) {
            if (!isCurrent(uploadToken, state)) {
                return stateChanged();
            }
            List<TasSession> sessions = state.getSessions();
            if (sessions == null) sessions = Collections.emptyList();

            TasReportBuilder.BuildResult buildResult = reportBuilder.build(
                    sessions, state.getReportStart(), state.getReportEnd(), shifts, state.getResolvedPeriod());
            state.setResolvedRows(buildResult.rows);
            state.bumpRevision();

            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("uploadToken", uploadToken);
            resp.put("stateRevision", state.getRevision());
            resp.put("resolvedRows", state.getResolvedRows());
            resp.put("sessionSummaries", buildSessionSummaries(sessions, state.getResolvedPeriod()));
            return ResponseEntity.ok(resp);
        }
    }

    @GetMapping("/coverage/{uploadToken}")
    public ResponseEntity<?> coverage(@PathVariable String uploadToken) {
        TasUploadState state = getState(uploadToken);
        if (state == null) {
            return invalidToken();
        }

        List<Map<String, Object>> incomplete;
        synchronized (state) {
            List<EmployeeRow> rows = state.getResolvedRows() != null ? state.getResolvedRows() : Collections.emptyList();
            List<TasPeriod> periods = rows.stream()
                    .filter(r -> r.getNumeroDequincena() != null)
                    .map(r -> new TasPeriod(r.getAnio(), r.getMes(), r.getNumeroDequincena()))
                    .collect(Collectors.toList());

            // The file's own scans: session dates move when a night is dated by a typed-in entry, and
            // scans of ignored inactive employees would stretch the range.
            Set<String> ignored = state.getIgnoredEmployeeIds() != null ? state.getIgnoredEmployeeIds() : Set.of();
            List<TasScanRecord> scans = state.getAllScans() != null ? state.getAllScans() : Collections.emptyList();
            List<LocalDate> scanDates = scans.stream()
                    .filter(scan -> scan.getTimestamp() != null && !ignored.contains(scan.getEmployeeId()))
                    .map(scan -> scan.getTimestamp().toLocalDate())
                    .collect(Collectors.toList());
            LocalDate dataStart = scanDates.stream().min(Comparator.naturalOrder()).orElse(state.getReportStart());
            LocalDate dataEnd = scanDates.stream().max(Comparator.naturalOrder()).orElse(state.getReportEnd());

            incomplete = reportBuilder
                    .findIncompletePeriods(dataStart, dataEnd, periods)
                    .stream()
                    .map(c -> {
                        Map<String, Object> entry = new LinkedHashMap<>();
                        entry.put("anio", c.period().anio());
                        entry.put("mes", c.period().mes());
                        entry.put("numeroDequincena", c.period().numeroDequincena());
                        entry.put("periodStart", c.periodStart().toString());
                        entry.put("periodEnd", c.periodEnd().toString());
                        entry.put("dataStart", c.dataStart().toString());
                        entry.put("dataEnd", c.dataEnd().toString());
                        entry.put("missingWorkingDays", c.missingWorkingDays().stream()
                                .map(LocalDate::toString).collect(Collectors.toList()));
                        return entry;
                    })
                    .collect(Collectors.toList());
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("uploadToken", uploadToken);
        resp.put("incompletePeriods", incomplete);
        return ResponseEntity.ok(resp);
    }

    @GetMapping("/absent-review/{uploadToken}")
    public ResponseEntity<?> getAbsentReview(@PathVariable String uploadToken) {
        TasUploadState state = getState(uploadToken);
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

        // The employee registry is the source of truth for active state and
        // persists independently of the in-memory upload state, which is evicted
        // once the submit job finishes. Don't couple this to the upload token, or
        // deactivating an absent employee from the post-submit result screen 404s.
        List<String> employeeIds = stringList(body.get("employeeIds"));
        Object activeObj = body.getOrDefault("active", false);
        if (employeeIds == null || !(activeObj instanceof Boolean active)) {
            return error(400, "INVALID_FIELD_FORMAT", "Formato de empleados inválido.");
        }

        List<String> unknown = new ArrayList<>();
        for (String empId : employeeIds) {
            if (registryService.employeeNotInRegistry(empId)) {
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

    @GetMapping("/draft")
    public ResponseEntity<?> getDraft() {
        Optional<TasDraftService.Summary> summary = draftService.findSummary();
        if (summary.isEmpty()) {
            return ResponseEntity.noContent().build();
        }
        TasDraftService.Summary s = summary.get();
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("fileName", s.fileName());
        resp.put("view", s.view());
        resp.put("periodLabel", s.periodLabel());
        resp.put("savedAt", s.savedAt());
        resp.put("partialSubmit", s.partialSubmit());
        resp.put("resumable", s.resumable());
        resp.put("uiVersion", s.uiVersion());
        resp.put("jobActive", jobService.isAnyJobActive());
        return ResponseEntity.ok(resp);
    }

    @PutMapping("/draft")
    public ResponseEntity<?> saveDraft(@RequestBody JsonNode body) {
        String token = textField(body, "uploadToken", MAX_TOKEN_LENGTH);
        JsonNode revisionNode = body.get("stateRevision");
        String view = textField(body, "view", 32);
        JsonNode ui = body.get("ui");
        if (!body.isObject() || token == null || token.isEmpty()
                || revisionNode == null || !revisionNode.isIntegralNumber() || !revisionNode.canConvertToLong()
                || view == null || !SAVABLE_VIEWS.contains(view)
                || ui == null || !ui.isObject()
                || !optionalText(body, "fileName", MAX_FILE_NAME_LENGTH)
                || !optionalText(body, "periodLabel", MAX_PERIOD_LABEL_LENGTH)) {
            return error(400, "INVALID_DRAFT", "Borrador inválido.");
        }
        String fileName = body.hasNonNull("fileName") ? body.get("fileName").asText() : null;
        String periodLabel = body.hasNonNull("periodLabel") ? body.get("periodLabel").asText() : null;

        TasUploadState state = getState(token);
        if (state == null) {
            return draftStale(null);
        }
        synchronized (state) {
            if (!isCurrent(token, state)) {
                return draftStale(null);
            }
            if (state.getRevision() != revisionNode.asLong()) {
                return draftStale(state.getRevision());
            }
            draftService.save(token, state, ui, fileName, view, periodLabel);
        }
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/draft")
    public ResponseEntity<?> deleteDraft() {
        draftService.delete();
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/draft/resume")
    public ResponseEntity<?> resumeDraft() {
        Optional<TasDraftService.Draft> draft = draftService.load();
        if (draft.isEmpty()) {
            boolean outdated = draftService.findSummary().map(s -> !s.resumable()).orElse(false);
            return outdated
                    ? error(409, "DRAFT_OUTDATED", DRAFT_OUTDATED_MESSAGE)
                    : error(404, "NO_DRAFT", "No hay una sesión guardada.");
        }
        TasDraftService.Draft d = draft.get();
        TasUploadState state = d.state();
        state.setUploadToken(d.uploadToken());
        state.touch();
        // put, not putIfAbsent: the draft's UI half matches the draft's backend half,
        // not a possibly newer in-memory state.
        stateStore.put(d.uploadToken(), state);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("uploadToken", d.uploadToken());
        resp.put("ui", d.ui());
        return ResponseEntity.ok(resp);
    }

    private static ResponseEntity<Map<String, Object>> draftStale(Long currentRevision) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", "DRAFT_STALE");
        body.put("message", "La sesión cambió desde este guardado.");
        body.put("currentRevision", currentRevision);
        return ResponseEntity.status(409).body(body);
    }

    private static String textField(JsonNode body, String field, int maxLength) {
        JsonNode node = body.get(field);
        if (node == null || !node.isTextual() || node.asText().length() > maxLength) return null;
        return node.asText();
    }

    private static boolean optionalText(JsonNode body, String field, int maxLength) {
        JsonNode node = body.get(field);
        return node == null || node.isNull() || (node.isTextual() && node.asText().length() <= maxLength);
    }

    private TasParserService.ParseResult parseFile(MultipartFile file) throws Exception {
        return parserService.parse(file);
    }

    /** True when the user moved a lone scan from the side the backend guessed to the other side. */
    static boolean isSwappedSingleScan(TasSession session, LocalDateTime start, LocalDateTime end) {
        if (session.getScans() == null || session.getScans().size() != 1 || session.getFlags() == null) return false;
        LocalDateTime scan = session.getScans().get(0);
        boolean scanWasExit  = session.getFlags().contains(TasFlag.MISSING_ENTRY);
        boolean scanWasEntry = session.getFlags().contains(TasFlag.MISSING_EXIT);
        if (scanWasExit == scanWasEntry) return false;
        return scanWasExit
                ? start.equals(scan) && !end.equals(scan)
                : end.equals(scan) && !start.equals(scan);
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
                session.getFlags().removeIf(f -> f == TasFlag.SHORT_DAY);
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

    private Map<String, Object> buildResponseBody(String token, TasUploadResult result, long stateRevision) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("stateRevision", stateRevision);
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
