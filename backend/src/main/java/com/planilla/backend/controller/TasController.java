package com.planilla.backend.controller;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasUploadResult;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.tas.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/tas")
@CrossOrigin(origins = "*")
public class TasController {

    private final TasParserService        parserService;
    private final TasUploadService        uploadService;
    private final TasReportBuilder        reportBuilder;
    private final EmployeeRegistryService registryService;
    private final JobService              jobService;
    private final ShiftConfigService      shiftConfigService;
    private final TasHoursCalculator      hoursCalculator;

    private final ConcurrentHashMap<String, TasUploadState> stateStore = new ConcurrentHashMap<>();

    public TasController(
            TasParserService parserService,
            TasUploadService uploadService,
            TasReportBuilder reportBuilder,
            EmployeeRegistryService registryService,
            JobService jobService,
            ShiftConfigService shiftConfigService,
            TasHoursCalculator hoursCalculator) {
        this.parserService      = parserService;
        this.uploadService      = uploadService;
        this.reportBuilder      = reportBuilder;
        this.registryService    = registryService;
        this.jobService         = jobService;
        this.shiftConfigService = shiftConfigService;
        this.hoursCalculator    = hoursCalculator;
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

                Map<String, Object> body = new LinkedHashMap<>();
                body.put("uploadToken", token);
                body.put("inactiveEmployeesFound", result.getInactiveEmployeesFound());
                body.put("warnings", result.getWarnings());
                return ResponseEntity.status(409).body(body);
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
        TasUploadState existing = stateStore.get(token);
        if (token == null || existing == null) {
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
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("uploadToken", token);
            resp.put("inactiveEmployeesFound", result.getInactiveEmployeesFound());
            resp.put("warnings", result.getWarnings());
            return ResponseEntity.status(409).body(resp);
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

        for (Map<String, Object> res : resolutions) {
            Object sessionIdObj = res.get("sessionId");
            if (sessionIdObj == null) continue;
            int sessionId = ((Number) sessionIdObj).intValue();
            TasSession session = flaggedBySessionId.get(sessionId);
            if (session == null) continue;

            String resolvedStart = (String) res.get("resolvedStart");
            String resolvedEnd   = (String) res.get("resolvedEnd");

            if (resolvedStart != null && resolvedEnd != null) {
                LocalDateTime start = LocalDateTime.parse(resolvedStart, dtf);
                LocalDateTime end   = LocalDateTime.parse(resolvedEnd, dtf);

                session.setEffectiveStart(start);
                session.setLastScan(end);
                session.setScans(List.of(start, end));
                session.setFlags(Collections.emptyList());
                session.setNeedsResolution(false);

                long workedMinutes = java.time.temporal.ChronoUnit.MINUTES.between(start, end);
                if (workedMinutes < 0) workedMinutes = 0;
                session.setWorkedMinutes((int) workedMinutes);
                double workedHours = Math.floor(workedMinutes / 30.0) / 2.0;
                session.setWorkedHours(workedHours);
                hoursCalculator.classifyHours(session);
            }
        }

        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();
        TasReportBuilder.BuildResult buildResult = reportBuilder.build(
                sessions, state.getReportStart(), state.getReportEnd(), shifts);
        state.setResolvedRows(buildResult.rows);

        List<TasSession> remainingFlagged = sessions.stream()
                .filter(TasSession::isNeedsResolution)
                .collect(Collectors.toList());

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("uploadToken", token);
        resp.put("resolvedRows", state.getResolvedRows());
        resp.put("flaggedSessions", remainingFlagged);
        resp.put("usedFallbackHolidays", state.isUsedFallbackHolidays());
        return ResponseEntity.ok(resp);
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

        List<TasSession> unresolved = sessions.stream()
                .filter(TasSession::isNeedsResolution)
                .collect(Collectors.toList());
        if (!unresolved.isEmpty()) {
            return ResponseEntity.status(409).body(Map.of(
                "code", "UNRESOLVED_SESSIONS",
                "message", "Hay sesiones pendientes de resolución.",
                "count", unresolved.size()
            ));
        }

        List<EmployeeRow> rows = state.getResolvedRows();
        if (rows == null || rows.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("code", "NO_ROWS", "message", "No hay filas para enviar."));
        }

        String jobId = jobService.createJob(rows);
        jobService.processJob(jobId);

        stateStore.remove(token);
        return ResponseEntity.ok(Map.of("jobId", jobId));
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
        for (String empId : employeeIds) {
            registryService.setActive(empId, false);
        }
        return ResponseEntity.ok().build();
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

    private Map<String, Object> buildResponseBody(String token, TasUploadResult result) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolvedRows", result.getResolvedRows());
        body.put("flaggedSessions", result.getFlaggedSessions());
        body.put("warnings", result.getWarnings());
        body.put("usedFallbackHolidays", result.isUsedFallbackHolidays());
        body.put("absentActiveEmployees", result.getAbsentActiveEmployees());
        return body;
    }
}
