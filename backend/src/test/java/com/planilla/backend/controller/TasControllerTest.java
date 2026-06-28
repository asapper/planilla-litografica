package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasPeriod;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasUploadResult;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.JobNotFoundException;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.tas.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(TasController.class)
class TasControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired TasController tasController;

    @MockBean TasParserService        parserService;
    @MockBean TasUploadService        uploadService;
    @MockBean TasHoursCalculator      hoursCalculator;
    @MockBean TasReportBuilder        reportBuilder;
    @MockBean EmployeeRegistryService registryService;
    @MockBean JobService              jobService;
    @MockBean ShiftConfigService      shiftConfigService;
    @MockBean DatabaseService         databaseService;

    @AfterEach
    void clearStateStore() { tasController.stateStore.clear(); }

    private String json(Object o) throws Exception { return mapper.writeValueAsString(o); }

    private TasParserService.ParseResult emptyParseResult() {
        return new TasParserService.ParseResult(new ArrayList<TasScanRecord>(), new ArrayList<>());
    }

    private TasUploadResult emptyResult() {
        TasUploadResult r = new TasUploadResult();
        r.setResolvedRows(new ArrayList<>());
        r.setFlaggedSessions(new ArrayList<>());
        r.setWarnings(new ArrayList<>());
        r.setUsedFallbackHolidays(false);
        r.setInactiveEmployeesFound(new ArrayList<>());
        r.setAbsentActiveEmployees(new ArrayList<>());
        return r;
    }

    // ── POST /api/tas/upload ──────────────────────────────────────────────────

    @Test
    void upload_validFile_returns200WithToken() throws Exception {
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(emptyResult());

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.uploadToken").isNotEmpty())
           .andExpect(jsonPath("$.inactiveEmployeesFound").isArray())
           .andExpect(jsonPath("$.inactiveEmployeesFound").isEmpty());
    }

    @Test
    void upload_inactiveEmployeesFound_returns200WithInactiveEmployees() throws Exception {
        TasUploadResult result = new TasUploadResult();
        com.planilla.backend.model.tas.TasInactiveEmployee inactive = new com.planilla.backend.model.tas.TasInactiveEmployee();
        inactive.setEmployeeId("100");
        inactive.setName("Test");
        result.setInactiveEmployeesFound(List.of(inactive));
        result.setWarnings(new ArrayList<>());

        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.inactiveEmployeesFound").isArray())
           .andExpect(jsonPath("$.inactiveEmployeesFound").isNotEmpty())
           .andExpect(jsonPath("$.uploadToken").isNotEmpty());
    }

    @Test
    void upload_withParseWarnings_returnsWarningsInResponse() throws Exception {
        List<String> parseWarnings = List.of("Columnas adicionales ignoradas: [Departamento, Cargo].");
        TasParserService.ParseResult parseResult =
                new TasParserService.ParseResult(new ArrayList<>(), parseWarnings);

        TasUploadResult uploadResult = emptyResult();
        uploadResult.setWarnings(parseWarnings);

        when(parserService.parse(any())).thenReturn(parseResult);
        when(uploadService.processScans(any(), eq(parseWarnings), any())).thenReturn(uploadResult);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.warnings").isArray())
           .andExpect(jsonPath("$.warnings[0]").value("Columnas adicionales ignoradas: [Departamento, Cargo]."));
    }

    @Test
    void upload_missingColumns_returns400WithSpecificMessage() throws Exception {
        when(parserService.parse(any()))
                .thenThrow(new Exception("Columnas requeridas no encontradas: [Fecha y hora, ID de usuario]."));

        MockMultipartFile file = new MockMultipartFile("file", "bad.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("UPLOAD_FAILED"))
           .andExpect(jsonPath("$.message").value("Columnas requeridas no encontradas: [Fecha y hora, ID de usuario]."));
    }

    @Test
    void upload_parseException_returns400() throws Exception {
        when(parserService.parse(any())).thenThrow(new Exception("No se encontraron registros"));

        MockMultipartFile file = new MockMultipartFile("file", "bad.csv", "text/csv", "".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("UPLOAD_FAILED"));
    }

    @Test
    void upload_includesAvailableShiftsField() throws Exception {
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(emptyResult());

        Map<String, Object> manana = new LinkedHashMap<>();
        manana.put("id", "manana");
        manana.put("name", "Manana");
        manana.put("startTime", "07:00");
        manana.put("endTime", "15:00");
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(manana));

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.availableShifts[0].id").value("manana"))
           .andExpect(jsonPath("$.availableShifts[0].name").value("Manana"))
           .andExpect(jsonPath("$.availableShifts[0].startTime").value("07:00"))
           .andExpect(jsonPath("$.availableShifts[0].endTime").value("15:00"));
    }

    @Test
    void resolve_includesAvailableShiftsField() throws Exception {
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(emptyResult());

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        Map<String, Object> manana = new LinkedHashMap<>();
        manana.put("id", "manana");
        manana.put("name", "Manana");
        manana.put("startTime", "07:00");
        manana.put("endTime", "15:00");
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(manana));
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of());

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.availableShifts[0].id").value("manana"))
           .andExpect(jsonPath("$.availableShifts[0].name").value("Manana"));
    }

    // ── POST /api/tas/resolve ─────────────────────────────────────────────────

    @Test
    void resolve_invalidToken_returns400() throws Exception {
        Map<String, Object> body = Map.of("uploadToken", "nonexistent", "resolutions", List.of());

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
    }

    @Test
    void resolve_validResolution_returns200WithUpdatedRows() throws Exception {
        TasSession flagged = new TasSession();
        flagged.setSessionId(42);
        flagged.setEmployeeId("100");
        flagged.setNeedsResolution(true);
        flagged.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.MISSING_EXIT)));

        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(List.of(flagged));
        result.setAllSessions(List.of(flagged));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        TasReportBuilder.BuildResult buildResult = new TasReportBuilder.BuildResult(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any())).thenReturn(buildResult);

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("sessionId", 42);
        resolution.put("resolvedStart", "2026-03-10 07:00");
        resolution.put("resolvedEnd", "2026-03-10 15:00");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of(resolution));

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions").isArray())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

        verify(hoursCalculator).classifyHours(any(), any());
    }

    @Test
    void resolve_acceptedShiftId_updatesMatchedShiftAndRecomputesHours() throws Exception {
        TasSession flagged = new TasSession();
        flagged.setSessionId(42);
        flagged.setEmployeeId("100");
        flagged.setDate(java.time.LocalDate.of(2026, 3, 10));
        flagged.setMatchedShiftId("manana");
        flagged.setMatchedShiftName("Manana");
        flagged.setAssignedShiftId("manana");
        flagged.setAssignedShiftName("Manana");
        flagged.setScans(List.of(
                java.time.LocalDateTime.of(2026, 3, 10, 15, 3),
                java.time.LocalDateTime.of(2026, 3, 10, 23, 5)));
        flagged.setNeedsResolution(true);
        flagged.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.SHIFT_MISMATCH)));

        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(List.of(flagged));
        result.setAllSessions(List.of(flagged));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        TasReportBuilder.BuildResult buildResult = new TasReportBuilder.BuildResult(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any())).thenReturn(buildResult);

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("sessionId", 42);
        resolution.put("acceptedShiftId", "tarde");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of(resolution));

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

        assertThat(flagged.getMatchedShiftId()).isEqualTo("tarde");
        assertThat(flagged.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SHIFT_MISMATCH);
        assertThat(flagged.isNeedsResolution()).isFalse();
        verify(hoursCalculator).recompute(eq(flagged), any());
    }

    @Test
    void resolve_acceptedShiftId_withRemainingBlockingFlag_keepsNeedsResolutionTrue() throws Exception {
        TasSession flagged = new TasSession();
        flagged.setSessionId(43);
        flagged.setEmployeeId("100");
        flagged.setDate(java.time.LocalDate.of(2026, 3, 10));
        flagged.setMatchedShiftId("manana");
        flagged.setMatchedShiftName("Manana");
        flagged.setAssignedShiftId("manana");
        flagged.setAssignedShiftName("Manana");
        flagged.setScans(List.of(
                java.time.LocalDateTime.of(2026, 3, 10, 15, 3),
                java.time.LocalDateTime.of(2026, 3, 10, 23, 5)));
        flagged.setNeedsResolution(true);
        flagged.setFlags(new ArrayList<>(List.of(
                com.planilla.backend.model.tas.TasFlag.SHIFT_MISMATCH,
                com.planilla.backend.model.tas.TasFlag.MISSING_ENTRY)));

        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(List.of(flagged));
        result.setAllSessions(List.of(flagged));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        TasReportBuilder.BuildResult buildResult = new TasReportBuilder.BuildResult(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any())).thenReturn(buildResult);

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("sessionId", 43);
        resolution.put("acceptedShiftId", "tarde");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of(resolution));

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(1));

        assertThat(flagged.getMatchedShiftId()).isEqualTo("tarde");
        assertThat(flagged.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SHIFT_MISMATCH);
        assertThat(flagged.getFlags()).contains(com.planilla.backend.model.tas.TasFlag.MISSING_ENTRY);
        assertThat(flagged.isNeedsResolution()).isTrue();
        verify(hoursCalculator, never()).recompute(eq(flagged), any());
    }

    @Test
    void upload_includesAvailablePeriodsField() throws Exception {
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(emptyResult());

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.availablePeriods").isArray());
    }

    @Test
    void resolve_withPeriod_passesPeriodFilterToReportBuilder() throws Exception {
        TasSession flagged = new TasSession();
        flagged.setSessionId(42);
        flagged.setEmployeeId("100");
        flagged.setNeedsResolution(true);
        flagged.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.MISSING_EXIT)));

        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(List.of(flagged));
        result.setAllSessions(List.of(flagged));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        TasReportBuilder.BuildResult buildResult = new TasReportBuilder.BuildResult(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any())).thenReturn(buildResult);

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("sessionId", 42);
        resolution.put("resolvedStart", "2026-03-10 07:00");
        resolution.put("resolvedEnd", "2026-03-10 15:00");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of(resolution));
        body.put("anio", 2026);
        body.put("mes", 3);
        body.put("numeroDequincena", 1);

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.availablePeriods").isArray());

        verify(reportBuilder).build(any(), any(), any(), any(), eq(new TasPeriod(2026, 3, 1)));
    }

    @Test
    void resolve_responseIncludesSessionSummaries() throws Exception {
        TasSession resolved = new TasSession();
        resolved.setSessionId(42);
        resolved.setEmployeeId("E1");
        resolved.setEmployeeName("Ana");
        resolved.setDate(java.time.LocalDate.of(2026, 6, 2));
        resolved.setMatchedShiftName("Mañana");
        resolved.setEffectiveStart(java.time.LocalDateTime.of(2026, 6, 2, 7, 0));
        resolved.setLastScan(java.time.LocalDateTime.of(2026, 6, 2, 15, 0));
        resolved.setWorkedHours(8.0);
        resolved.setSimplesMinutes(30);
        resolved.setDoblesMinutes(0);
        resolved.setNeedsResolution(false);
        resolved.setFlags(new ArrayList<>());

        TasUploadResult result = emptyResult();
        result.setAllSessions(List.of(resolved));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of());

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.sessionSummaries.E1").isArray())
           .andExpect(jsonPath("$.sessionSummaries.E1[0].date").value("2026-06-02"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].shiftName").value("Mañana"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].workedHours").value(8.0));
    }

    @Test
    void resolve_sessionSummariesIncludeRawScans() throws Exception {
        TasSession session = new TasSession();
        session.setSessionId(1);
        session.setEmployeeId("E1");
        session.setEmployeeName("Ana");
        session.setDate(java.time.LocalDate.of(2026, 6, 2));
        session.setMatchedShiftName("Mañana");
        session.setEffectiveStart(java.time.LocalDateTime.of(2026, 6, 2, 7, 2));
        session.setLastScan(java.time.LocalDateTime.of(2026, 6, 2, 15, 5));
        session.setScans(List.of(
            java.time.LocalDateTime.of(2026, 6, 2, 7, 2),
            java.time.LocalDateTime.of(2026, 6, 2, 12, 31),
            java.time.LocalDateTime.of(2026, 6, 2, 13, 5),
            java.time.LocalDateTime.of(2026, 6, 2, 15, 5)
        ));
        session.setWorkedHours(8.0);
        session.setSimplesMinutes(30);
        session.setDoblesMinutes(0);
        session.setNeedsResolution(false);
        session.setFlags(new ArrayList<>());

        TasUploadResult result = emptyResult();
        result.setAllSessions(List.of(session));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of());

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.sessionSummaries.E1[0].scans").isArray())
           .andExpect(jsonPath("$.sessionSummaries.E1[0].scans.length()").value(4))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].scans[0]").value("2026-06-02T07:02"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].scans[1]").value("2026-06-02T12:31"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].scans[3]").value("2026-06-02T15:05"));
    }

    @Test
    void resolve_sessionSummariesFilteredByPeriod() throws Exception {
        TasSession q1Session = new TasSession();
        q1Session.setSessionId(1);
        q1Session.setEmployeeId("E1");
        q1Session.setEmployeeName("Ana");
        q1Session.setDate(java.time.LocalDate.of(2026, 3, 5));
        q1Session.setMatchedShiftName("Mañana");
        q1Session.setEffectiveStart(java.time.LocalDateTime.of(2026, 3, 5, 7, 0));
        q1Session.setLastScan(java.time.LocalDateTime.of(2026, 3, 5, 15, 0));
        q1Session.setWorkedHours(8.0);
        q1Session.setSimplesMinutes(0);
        q1Session.setDoblesMinutes(0);
        q1Session.setNeedsResolution(false);
        q1Session.setFlags(new ArrayList<>());

        TasSession q2Session = new TasSession();
        q2Session.setSessionId(2);
        q2Session.setEmployeeId("E1");
        q2Session.setEmployeeName("Ana");
        q2Session.setDate(java.time.LocalDate.of(2026, 3, 20));
        q2Session.setMatchedShiftName("Tarde");
        q2Session.setEffectiveStart(java.time.LocalDateTime.of(2026, 3, 20, 14, 0));
        q2Session.setLastScan(java.time.LocalDateTime.of(2026, 3, 20, 22, 0));
        q2Session.setWorkedHours(8.0);
        q2Session.setSimplesMinutes(0);
        q2Session.setDoblesMinutes(0);
        q2Session.setNeedsResolution(false);
        q2Session.setFlags(new ArrayList<>());

        TasUploadResult result = emptyResult();
        result.setAllSessions(List.of(q1Session, q2Session));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of());
        body.put("anio", 2026);
        body.put("mes", 3);
        body.put("numeroDequincena", 1);

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.sessionSummaries.E1").isArray())
           .andExpect(jsonPath("$.sessionSummaries.E1.length()").value(1))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].date").value("2026-03-05"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].shiftName").value("Mañana"));
    }

    @Test
    void recompute_sessionSummariesFilteredByPeriod() throws Exception {
        TasSession q1Session = new TasSession();
        q1Session.setSessionId(1);
        q1Session.setEmployeeId("E1");
        q1Session.setDate(java.time.LocalDate.of(2026, 3, 10));
        q1Session.setMatchedShiftName("Mañana");
        q1Session.setWorkedHours(8.0);
        q1Session.setSimplesMinutes(0);
        q1Session.setDoblesMinutes(0);
        q1Session.setNeedsResolution(false);
        q1Session.setFlags(new ArrayList<>());

        TasSession q2Session = new TasSession();
        q2Session.setSessionId(2);
        q2Session.setEmployeeId("E1");
        q2Session.setDate(java.time.LocalDate.of(2026, 3, 25));
        q2Session.setMatchedShiftName("Tarde");
        q2Session.setWorkedHours(8.0);
        q2Session.setSimplesMinutes(0);
        q2Session.setDoblesMinutes(0);
        q2Session.setNeedsResolution(false);
        q2Session.setFlags(new ArrayList<>());

        TasUploadResult result = emptyResult();
        result.setAllSessions(List.of(q1Session, q2Session));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        Map<String, Object> resolveBody = new LinkedHashMap<>();
        resolveBody.put("uploadToken", token);
        resolveBody.put("resolutions", List.of());
        resolveBody.put("anio", 2026);
        resolveBody.put("mes", 3);
        resolveBody.put("numeroDequincena", 2);
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(resolveBody)))
           .andExpect(status().isOk());

        mvc.perform(post("/api/tas/recompute/" + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.sessionSummaries.E1").isArray())
           .andExpect(jsonPath("$.sessionSummaries.E1.length()").value(1))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].date").value("2026-03-25"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].shiftName").value("Tarde"));
    }

    // ── POST /api/tas/submit ──────────────────────────────────────────────────

    @Test
    void submit_invalidToken_returns400() throws Exception {
        Map<String, Object> body = Map.of("uploadToken", "nonexistent");

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
    }

    // ── GET /api/tas/absent-review/{token} ───────────────────────────────────

    @Test
    void getAbsentReview_invalidToken_returns404() throws Exception {
        mvc.perform(get("/api/tas/absent-review/nonexistent"))
           .andExpect(status().isNotFound());
    }

    // ── POST /api/tas/absent-review/{token}/deactivate ───────────────────────

    @Test
    void deactivateAbsent_validToken_deactivatesEmployee() throws Exception {
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok-deact");
        tasController.stateStore.put("tok-deact", state);

        when(registryService.employeeNotInRegistry("100")).thenReturn(false);

        Map<String, Object> body = Map.of("employeeIds", List.of("100"));

        mvc.perform(post("/api/tas/absent-review/tok-deact/deactivate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.updated").value(1))
           .andExpect(jsonPath("$.notFound").isArray())
           .andExpect(jsonPath("$.notFound").isEmpty());

        verify(registryService).setActive("100", false);
    }

    @Test
    void deactivateAbsent_withActiveTrue_reactivatesEmployee() throws Exception {
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok-react");
        tasController.stateStore.put("tok-react", state);

        when(registryService.employeeNotInRegistry("100")).thenReturn(false);

        Map<String, Object> body = Map.of("employeeIds", List.of("100"), "active", true);

        mvc.perform(post("/api/tas/absent-review/tok-react/deactivate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.updated").value(1))
           .andExpect(jsonPath("$.notFound").isArray())
           .andExpect(jsonPath("$.notFound").isEmpty());

        verify(registryService).setActive("100", true);
    }

    @Test
    void deactivateAbsent_unknownEmployeeId_skipsAndReportsNotFound() throws Exception {
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok-unk");
        tasController.stateStore.put("tok-unk", state);

        when(registryService.employeeNotInRegistry("ghost")).thenReturn(true);

        Map<String, Object> body = Map.of("employeeIds", List.of("ghost"), "active", false);

        mvc.perform(post("/api/tas/absent-review/tok-unk/deactivate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.updated").value(0))
           .andExpect(jsonPath("$.notFound[0]").value("ghost"));

        verify(registryService, never()).setActive(anyString(), anyBoolean());
    }

    @Test
    void deactivateAbsent_mixedKnownAndUnknown_updatesKnownReportsUnknown() throws Exception {
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok-mix");
        tasController.stateStore.put("tok-mix", state);

        when(registryService.employeeNotInRegistry("known")).thenReturn(false);
        when(registryService.employeeNotInRegistry("ghost")).thenReturn(true);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("employeeIds", List.of("known", "ghost"));
        body.put("active", false);

        mvc.perform(post("/api/tas/absent-review/tok-mix/deactivate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.updated").value(1))
           .andExpect(jsonPath("$.notFound[0]").value("ghost"));

        verify(registryService).setActive("known", false);
        verify(registryService, never()).setActive(eq("ghost"), anyBoolean());
    }

    // ── ERR-1: null token in inactiveReview must not NPE ──────────────────────

    @Test
    void inactiveReview_nullToken_returns400WithoutNpe() throws Exception {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("reactivate", List.of());
        body.put("ignore", List.of());
        // deliberately omit "uploadToken"

        mvc.perform(post("/api/tas/inactive-review")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
    }

    // ── SEC-3: deactivateAbsent must validate the upload token ────────────────

    @Test
    void deactivateAbsent_unknownToken_returns404() throws Exception {
        Map<String, Object> body = Map.of("employeeIds", List.of("emp1"), "active", false);

        mvc.perform(post("/api/tas/absent-review/unknown-token/deactivate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isNotFound());

        verify(registryService, never()).setActive(anyString(), anyBoolean());
    }

    @Test
    void deactivateAbsent_validTokenFromStore_deactivatesEmployees() throws Exception {
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok");
        tasController.stateStore.put("tok", state);

        when(registryService.employeeNotInRegistry("emp1")).thenReturn(false);

        Map<String, Object> body = Map.of("employeeIds", List.of("emp1"), "active", false);

        mvc.perform(post("/api/tas/absent-review/tok/deactivate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.updated").value(1))
           .andExpect(jsonPath("$.notFound").isArray());

        verify(registryService).setActive("emp1", false);
    }

    // ── POST /api/tas/inactive-review ────────────────────────────────────────

    @Test
    void inactiveReview_invalidToken_returns400() throws Exception {
        Map<String, Object> body = Map.of(
            "uploadToken", "nonexistent",
            "reactivate", List.of(),
            "ignore", List.of()
        );

        mvc.perform(post("/api/tas/inactive-review")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
    }

    // ── Upload then submit flow ───────────────────────────────────────────────

    @Test
    void upload_thenSubmit_withNoFlaggedSessions_returns200WithJobId() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(0);
        row.setHorasExtrasSimples(8);
        row.setHorasExtrasDobles(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(jobService.createJob(any())).thenReturn("job-123");

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token))))
           .andExpect(status().isAccepted())
           .andExpect(jsonPath("$.jobId").value("job-123"));
    }

    @Test
    void submit_withUnresolvedSessions_returns409() throws Exception {
        TasSession flagged = new TasSession();
        flagged.setEmployeeId("100");
        flagged.setNeedsResolution(true);
        flagged.setFlags(List.of(com.planilla.backend.model.tas.TasFlag.MISSING_EXIT));

        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(List.of(flagged));
        result.setAllSessions(List.of(flagged));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token))))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.code").value("UNRESOLVED_SESSIONS"));
    }

    @Test
    void submit_ignoresUnresolvedSessionsOutsideResolvedPeriod() throws Exception {
        TasSession resolved = new TasSession();
        resolved.setEmployeeId("100");
        resolved.setDate(java.time.LocalDate.of(2026, 3, 20));
        resolved.setNeedsResolution(false);
        resolved.setFlags(List.of());

        TasSession unresolvedOtherPeriod = new TasSession();
        unresolvedOtherPeriod.setEmployeeId("100");
        unresolvedOtherPeriod.setDate(java.time.LocalDate.of(2026, 3, 5));
        unresolvedOtherPeriod.setNeedsResolution(true);
        unresolvedOtherPeriod.setFlags(List.of(com.planilla.backend.model.tas.TasFlag.MISSING_EXIT));

        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(2);

        TasUploadResult result = emptyResult();
        result.setAllSessions(List.of(resolved, unresolvedOtherPeriod));
        result.setFlaggedSessions(List.of(unresolvedOtherPeriod));
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        // Simulate resolve for period 2 (quincena 2, March 16-31)
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
            .thenReturn(new com.planilla.backend.service.tas.TasReportBuilder.BuildResult(List.of(row)));
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of(
                    "uploadToken", token,
                    "resolutions", List.of(),
                    "anio", 2026, "mes", 3, "numeroDequincena", 2))))
           .andExpect(status().isOk());

        when(jobService.createJob(any())).thenReturn("job-456");

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token))))
           .andExpect(status().isAccepted())
           .andExpect(jsonPath("$.jobId").value("job-456"));
    }

    // ── POST /api/tas/recompute/{uploadToken} ───────────────────────────────

    @Test
    void recompute_invalidToken_returns400() throws Exception {
        mvc.perform(post("/api/tas/recompute/does-not-exist"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
    }

    @Test
    void recompute_rebuildsResolvedRowsFromCachedSessions() throws Exception {
        TasUploadResult result = emptyResult();
        result.setAllSessions(new ArrayList<>());
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        EmployeeRow recomputedRow = new EmployeeRow();
        recomputedRow.setCodigoEmpleado("100");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), isNull()))
                .thenReturn(new TasReportBuilder.BuildResult(List.of(recomputedRow)));

        mvc.perform(post("/api/tas/recompute/" + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.uploadToken").value(token))
           .andExpect(jsonPath("$.resolvedRows[0].codigoEmpleado").value("100"));
    }

    @Test
    void recompute_afterResolveWithPeriodFilter_usesSamePeriodFilter() throws Exception {
        TasUploadResult result = emptyResult();
        result.setAllSessions(new ArrayList<>());
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        // /resolve with period filter 2026-Q1-1 — should persist the filter
        Map<String, Object> resolveBody = new LinkedHashMap<>();
        resolveBody.put("uploadToken", token);
        resolveBody.put("resolutions", List.of());
        resolveBody.put("anio", 2026);
        resolveBody.put("mes", 3);
        resolveBody.put("numeroDequincena", 1);
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(resolveBody)))
           .andExpect(status().isOk());

        clearInvocations(reportBuilder);

        EmployeeRow recomputedRow = new EmployeeRow();
        recomputedRow.setCodigoEmpleado("E1");
        when(reportBuilder.build(any(), any(), any(), any(), eq(new TasPeriod(2026, 3, 1))))
                .thenReturn(new TasReportBuilder.BuildResult(List.of(recomputedRow)));

        // /recompute must pass the stored period filter, not null
        mvc.perform(post("/api/tas/recompute/" + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.resolvedRows[0].codigoEmpleado").value("E1"));

        verify(reportBuilder).build(
                any(), any(), any(), any(), eq(new TasPeriod(2026, 3, 1)));
    }

    @Test
    void recompute_afterResolveWithPeriod_thenResolveWithoutPeriod_keepsPeriodFilter() throws Exception {
        TasUploadResult result = emptyResult();
        result.setAllSessions(new ArrayList<>());
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        // First /resolve: with period
        Map<String, Object> resolveWithPeriod = new LinkedHashMap<>();
        resolveWithPeriod.put("uploadToken", token);
        resolveWithPeriod.put("resolutions", List.of());
        resolveWithPeriod.put("anio", 2026);
        resolveWithPeriod.put("mes", 3);
        resolveWithPeriod.put("numeroDequincena", 1);
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(resolveWithPeriod)))
           .andExpect(status().isOk());

        // Second /resolve: without period params (e.g. re-resolving a re-flagged session)
        Map<String, Object> resolveWithoutPeriod = new LinkedHashMap<>();
        resolveWithoutPeriod.put("uploadToken", token);
        resolveWithoutPeriod.put("resolutions", List.of());
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(resolveWithoutPeriod)))
           .andExpect(status().isOk());

        clearInvocations(reportBuilder);

        // /recompute must still use the period from the first /resolve call
        mvc.perform(post("/api/tas/recompute/" + token))
           .andExpect(status().isOk());

        verify(reportBuilder).build(
                any(), any(), any(), any(), eq(new TasPeriod(2026, 3, 1)));
    }

    @Test
    void recompute_nullSessions_treatedAsEmptyList() throws Exception {
        TasUploadResult result = emptyResult();
        result.setAllSessions(new ArrayList<>());
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        tasController.stateStore.get(token).setSessions(null);

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), isNull()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        mvc.perform(post("/api/tas/recompute/" + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.uploadToken").value(token));

        verify(reportBuilder).build(eq(Collections.emptyList()), any(), any(), any(), isNull());
    }

    private TasSession sameDayDoubleSession(int sessionId, String shiftId, String shiftName) {
        TasSession s = new TasSession();
        s.setSessionId(sessionId);
        s.setEmployeeId("100");
        s.setDate(java.time.LocalDate.of(2026, 3, 10));
        s.setMatchedShiftId(shiftId);
        s.setMatchedShiftName(shiftName);
        s.setAssignedShiftId(shiftId);
        s.setAssignedShiftName(shiftName);
        s.setScans(List.of(
                java.time.LocalDateTime.of(2026, 3, 10, 7, 0),
                java.time.LocalDateTime.of(2026, 3, 10, 15, 0)));
        s.setNeedsResolution(true);
        s.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE)));
        return s;
    }

    @Test
    void resolve_keepSessionIdAll_clearsFlagAndRecomputesAllSessions() throws Exception {
        TasSession a = sameDayDoubleSession(10, "manana", "Manana");
        TasSession b = sameDayDoubleSession(11, "tarde", "Tarde");

        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(List.of(a, b));
        result.setAllSessions(List.of(a, b));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("employeeId", "100");
        resolution.put("date", "2026-03-10");
        resolution.put("keepSessionId", "all");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of(resolution));

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

        assertThat(a.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
        assertThat(b.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
        assertThat(a.isNeedsResolution()).isFalse();
        assertThat(b.isNeedsResolution()).isFalse();
        verify(hoursCalculator, times(2)).recompute(any(), any());
    }

    @Test
    void resolve_keepSessionIdNotInGroup_fallsBackToKeepAll() throws Exception {
        TasSession a = sameDayDoubleSession(10, "manana", "Manana");
        TasSession b = sameDayDoubleSession(11, "tarde", "Tarde");

        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(List.of(a, b));
        result.setAllSessions(List.of(a, b));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("employeeId", "100");
        resolution.put("date", "2026-03-10");
        resolution.put("keepSessionId", 999);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of(resolution));

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

        assertThat(a.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
        assertThat(b.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
        assertThat(a.isNeedsResolution()).isFalse();
        assertThat(b.isNeedsResolution()).isFalse();
        verify(hoursCalculator, times(2)).recompute(any(), any());
    }

    @Test
    void resolve_keepSessionIdSpecific_zeroesOutDiscardedSession() throws Exception {
        TasSession a = sameDayDoubleSession(10, "manana", "Manana");
        TasSession b = sameDayDoubleSession(11, "tarde", "Tarde");

        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(List.of(a, b));
        result.setAllSessions(List.of(a, b));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("employeeId", "100");
        resolution.put("date", "2026-03-10");
        resolution.put("keepSessionId", 10);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of(resolution));

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

        assertThat(a.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
        assertThat(a.isNeedsResolution()).isFalse();

        assertThat(b.getFlags()).doesNotContain(com.planilla.backend.model.tas.TasFlag.SAME_DAY_DOUBLE);
        assertThat(b.isNeedsResolution()).isFalse();
        assertThat(b.getWorkedMinutes()).isEqualTo(0);
        assertThat(b.getWorkedHours()).isEqualTo(0.0);
        assertThat(b.getSimplesMinutes()).isEqualTo(0);
        assertThat(b.getDoblesMinutes()).isEqualTo(0);

        verify(hoursCalculator, times(1)).recompute(eq(a), any());
        verify(hoursCalculator, never()).recompute(eq(b), any());
    }

    @Test
    void upload_responseIncludesSessionSummaries() throws Exception {
        TasUploadResult result = emptyResult();

        TasSession s1 = new TasSession();
        s1.setEmployeeId("E1");
        s1.setEmployeeName("Ana");
        s1.setDate(java.time.LocalDate.of(2026, 6, 2));
        s1.setMatchedShiftName("Mañana");
        s1.setEffectiveStart(java.time.LocalDateTime.of(2026, 6, 2, 7, 2));
        s1.setLastScan(java.time.LocalDateTime.of(2026, 6, 2, 15, 5));
        s1.setWorkedHours(8.0);
        s1.setSimplesMinutes(30);
        s1.setDoblesMinutes(0);
        s1.setNeedsResolution(false);

        TasSession s2 = new TasSession();
        s2.setEmployeeId("E2");
        s2.setEmployeeName("Luis");
        s2.setDate(java.time.LocalDate.of(2026, 6, 2));
        s2.setMatchedShiftName("Tarde");
        s2.setEffectiveStart(java.time.LocalDateTime.of(2026, 6, 2, 14, 0));
        s2.setLastScan(java.time.LocalDateTime.of(2026, 6, 2, 22, 0));
        s2.setWorkedHours(8.0);
        s2.setSimplesMinutes(0);
        s2.setDoblesMinutes(0);
        s2.setNeedsResolution(false);

        result.setAllSessions(List.of(s1, s2));

        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.sessionSummaries.E1").isArray())
           .andExpect(jsonPath("$.sessionSummaries.E1[0].date").value("2026-06-02"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].shiftName").value("Mañana"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].entryTime").value("2026-06-02T07:02"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].exitTime").value("2026-06-02T15:05"))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].workedHours").value(8.0))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].simplesMinutes").value(30))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].doblesMinutes").value(0))
           .andExpect(jsonPath("$.sessionSummaries.E2").isArray())
           .andExpect(jsonPath("$.sessionSummaries.E2[0].shiftName").value("Tarde"));
    }

    @Test
    void upload_sessionSummariesExcludesNeedsResolution() throws Exception {
        TasUploadResult result = emptyResult();

        TasSession resolved = new TasSession();
        resolved.setEmployeeId("E1");
        resolved.setEmployeeName("Ana");
        resolved.setDate(java.time.LocalDate.of(2026, 6, 2));
        resolved.setMatchedShiftName("Mañana");
        resolved.setEffectiveStart(java.time.LocalDateTime.of(2026, 6, 2, 7, 0));
        resolved.setLastScan(java.time.LocalDateTime.of(2026, 6, 2, 15, 0));
        resolved.setWorkedHours(8.0);
        resolved.setSimplesMinutes(0);
        resolved.setDoblesMinutes(0);
        resolved.setNeedsResolution(false);

        TasSession unresolved = new TasSession();
        unresolved.setEmployeeId("E1");
        unresolved.setEmployeeName("Ana");
        unresolved.setDate(java.time.LocalDate.of(2026, 6, 3));
        unresolved.setNeedsResolution(true);

        result.setAllSessions(List.of(resolved, unresolved));

        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.sessionSummaries.E1").isArray())
           .andExpect(jsonPath("$.sessionSummaries.E1.length()").value(1))
           .andExpect(jsonPath("$.sessionSummaries.E1[0].date").value("2026-06-02"));
    }

    // ── GET /api/tas/jobs/{jobId} ────────────────────────────────────────

    @Test
    void getJobStatus_unknownJob_returns404() throws Exception {
        when(jobService.getJobStatus("unknown")).thenReturn(null);

        mvc.perform(get("/api/tas/jobs/unknown"))
           .andExpect(status().isNotFound());
    }

    @Test
    void getJobStatus_existingJob_returnsStatus() throws Exception {
        when(jobService.getJobStatus("job-1")).thenReturn(
            new JobService.JobStatusDto("job-1", "IN_PROGRESS", 10, 3, 1, 0, 1, 3, List.of()));

        mvc.perform(get("/api/tas/jobs/job-1"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.jobId").value("job-1"))
           .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
           .andExpect(jsonPath("$.totalRows").value(10))
           .andExpect(jsonPath("$.submitted").value(3))
           .andExpect(jsonPath("$.skipped").value(1))
           .andExpect(jsonPath("$.failed").value(0))
           .andExpect(jsonPath("$.failedRows").isEmpty());
    }

    @Test
    void getJobStatus_withFailedRows_includesDetails() throws Exception {
        when(jobService.getJobStatus("job-2")).thenReturn(
            new JobService.JobStatusDto("job-2", "DONE_WITH_ERRORS", 2, 1, 0, 1, 1, 3,
                List.of(new JobService.FailedRowDto("E1", "Ana", "DB error"))));

        mvc.perform(get("/api/tas/jobs/job-2"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.failedRows[0].codigoEmpleado").value("E1"))
           .andExpect(jsonPath("$.failedRows[0].nombreEmpleado").value("Ana"))
           .andExpect(jsonPath("$.failedRows[0].error").value("DB error"));
    }

    // ── POST /api/tas/jobs/{jobId}/retry ──────────────────────────────────

    @Test
    void retryJob_success_returns200WithRetryJobId() throws Exception {
        when(jobService.createRetryJob("job-1")).thenReturn("retry-id");

        mvc.perform(post("/api/tas/jobs/job-1/retry"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.jobId").value("retry-id"));

        verify(jobService).processRetryJobAsync("retry-id");
    }

    @Test
    void retryJob_notFound_returns404() throws Exception {
        when(jobService.createRetryJob("job-xyz")).thenThrow(
            new JobNotFoundException("job-xyz"));

        mvc.perform(post("/api/tas/jobs/job-xyz/retry"))
           .andExpect(status().isNotFound());
    }

    @Test
    void retryJob_maxRetriesExhausted_returns409WithMaxRetriesCode() throws Exception {
        when(jobService.createRetryJob("job-2")).thenThrow(
            new IllegalArgumentException("Se alcanzó el máximo de reintentos"));

        mvc.perform(post("/api/tas/jobs/job-2/retry"))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.code").value("MAX_RETRIES_EXHAUSTED"))
           .andExpect(jsonPath("$.message").value("Se alcanzó el máximo de reintentos"));
    }

    @Test
    void retryJob_notRetryable_returns409WithNotRetryableCode() throws Exception {
        when(jobService.createRetryJob("job-3")).thenThrow(
            new IllegalStateException("Solo se puede reintentar un job con estado DONE_WITH_ERRORS"));

        mvc.perform(post("/api/tas/jobs/job-3/retry"))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.code").value("NOT_RETRYABLE"))
           .andExpect(jsonPath("$.message").value("Solo se puede reintentar un job con estado DONE_WITH_ERRORS"));
    }

    // ── POST /api/tas/submit — overtime overrides ────────────────────────

    @Test
    void submit_withOvertimeOverrides_appliesOverridesToRows() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(0);
        row.setHorasExtrasSimples(8);
        row.setHorasExtrasDobles(2);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(jobService.createJob(any())).thenReturn("job-override");

        Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", 15, "horasExtrasDobles", 4));
        Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", overrides);

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted())
           .andExpect(jsonPath("$.jobId").value("job-override"));

        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(jobService).createJob(captor.capture());
        List<EmployeeRow> submitted = captor.getValue();
        assertThat(submitted).hasSize(1);
        assertThat(submitted.get(0).getHorasExtrasSimples()).isEqualTo(15);
        assertThat(submitted.get(0).getHorasExtrasDobles()).isEqualTo(4);
    }

    @Test
    void submit_withNegativeOverride_returns400() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setHorasExtrasSimples(0);
        row.setHorasExtrasDobles(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", -5));
        Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", overrides);

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_OVERRIDE"));
    }

    @Test
    void submit_withEmptyOverrides_passesRowsUnchanged() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(0);
        row.setHorasExtrasSimples(8);
        row.setHorasExtrasDobles(2);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(jobService.createJob(any())).thenReturn("job-nochange");

        Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", Map.of());

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted());

        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(jobService).createJob(captor.capture());
        List<EmployeeRow> submitted = captor.getValue();
        assertThat(submitted.get(0).getHorasExtrasSimples()).isEqualTo(8);
        assertThat(submitted.get(0).getHorasExtrasDobles()).isEqualTo(2);
    }

    @Test
    void submit_withPartialOverride_onlyOverridesSpecifiedField() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(0);
        row.setHorasExtrasSimples(8);
        row.setHorasExtrasDobles(2);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(jobService.createJob(any())).thenReturn("job-partial");

        Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", 20));
        Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", overrides);

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted());

        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(jobService).createJob(captor.capture());
        List<EmployeeRow> submitted = captor.getValue();
        assertThat(submitted.get(0).getHorasExtrasSimples()).isEqualTo(20);
        assertThat(submitted.get(0).getHorasExtrasDobles()).isEqualTo(2);
    }

    // ── INT-3 regression: second submit must not see mutated stored rows ──────

    @Test
    void submit_calledTwice_doesNotMutateStoredRows() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("emp1");
        row.setNombreEmpleado("Test");
        row.setHorasExtrasSimples(2.0);
        row.setHorasExtrasDobles(0);
        row.setDiasNoLaborados(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok-int3");
        state.setResolvedRows(new ArrayList<>(List.of(row)));
        tasController.stateStore.put("tok-int3", state);

        when(jobService.createJob(any())).thenReturn("job-int3-1", "job-int3-2");

        Map<String, Object> overrides = Map.of("emp1", Map.of("horasExtrasSimples", 5.0));
        Map<String, Object> body = Map.of("uploadToken", "tok-int3", "overtimeOverrides", overrides);

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted());

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted());

        assertThat(state.getResolvedRows().get(0).getHorasExtrasSimples()).isEqualTo(2.0);
    }

    @Test
    void submit_withMalformedOverrides_stringInsteadOfMap_returns400() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setHorasExtrasSimples(0);
        row.setHorasExtrasDobles(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        String body = "{\"uploadToken\":\"" + token + "\",\"overtimeOverrides\":\"not-a-map\"}";

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_OVERRIDE"));
    }

    @Test
    void submit_withMalformedOverrides_stringValueInsteadOfNumber_returns400() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setHorasExtrasSimples(0);
        row.setHorasExtrasDobles(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", "notanumber"));
        Map<String, Object> reqBody = Map.of("uploadToken", token, "overtimeOverrides", overrides);

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(reqBody)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_OVERRIDE"));
    }

    // ── POST /api/tas/submit — nonWorkedDays overrides ─────────────

    @Test
    void submit_withDiasNoLaboradosOverride_appliesOverrideToRow() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(3);
        row.setHorasExtrasSimples(0);
        row.setHorasExtrasDobles(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(jobService.createJob(any())).thenReturn("job-dias");

        Map<String, Object> body = Map.of(
            "uploadToken", token,
            "overtimeOverrides", Map.of(),
            "nonWorkedDaysOverrides", Map.of("100", 5)
        );

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted());

        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(jobService).createJob(captor.capture());
        List<EmployeeRow> submitted = captor.getValue();
        assertThat(submitted.get(0).getDiasNoLaborados()).isEqualTo(5);
    }

    @Test
    void submit_withNegativeDiasNoLaboradosOverride_returns400() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(0);
        row.setHorasExtrasSimples(0);
        row.setHorasExtrasDobles(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        Map<String, Object> body = Map.of(
            "uploadToken", token,
            "overtimeOverrides", Map.of(),
            "nonWorkedDaysOverrides", Map.of("100", -1)
        );

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_OVERRIDE"));
    }

    @Test
    void submit_withStringDiasNoLaboradosOverride_returns400() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(0);
        row.setHorasExtrasSimples(0);
        row.setHorasExtrasDobles(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        String reqBody = "{\"uploadToken\":\"" + token + "\",\"overtimeOverrides\":{},\"nonWorkedDaysOverrides\":{\"100\":\"notanumber\"}}";

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(reqBody))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_OVERRIDE"));
    }

    @Test
    void submit_withEmptyDiasNoLaboradosOverrides_passesRowUnchanged() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(4);
        row.setHorasExtrasSimples(0);
        row.setHorasExtrasDobles(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(jobService.createJob(any())).thenReturn("job-nochange-dias");

        Map<String, Object> body = Map.of(
            "uploadToken", token,
            "overtimeOverrides", Map.of(),
            "nonWorkedDaysOverrides", Map.of()
        );

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted());

        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(jobService).createJob(captor.capture());
        List<EmployeeRow> submitted = captor.getValue();
        assertThat(submitted.get(0).getDiasNoLaborados()).isEqualTo(4);
    }

    @Test
    void submit_withOverflowDiasNoLaboradosOverride_returns400() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(0);
        row.setHorasExtrasSimples(0);
        row.setHorasExtrasDobles(0);
        row.setMes(3);
        row.setAnio(2026);
        row.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        // 4294967296 = 2^32; would silently truncate to 0 without toIntExact guard
        String reqBody = "{\"uploadToken\":\"" + token + "\",\"overtimeOverrides\":{},\"nonWorkedDaysOverrides\":{\"100\":4294967296}}";

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(reqBody))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_OVERRIDE"));
    }

    @Test
    void recompute_responseIncludesSessionSummaries() throws Exception {
        TasUploadResult result = emptyResult();

        TasSession s = new TasSession();
        s.setEmployeeId("E1");
        s.setEmployeeName("Ana");
        s.setDate(java.time.LocalDate.of(2026, 6, 2));
        s.setMatchedShiftName("Mañana");
        s.setEffectiveStart(java.time.LocalDateTime.of(2026, 6, 2, 7, 0));
        s.setLastScan(java.time.LocalDateTime.of(2026, 6, 2, 15, 0));
        s.setWorkedHours(8.0);
        s.setSimplesMinutes(0);
        s.setDoblesMinutes(0);
        s.setNeedsResolution(false);

        result.setAllSessions(List.of(s));

        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        // Upload first to get a token
        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andReturn().getResponse().getContentAsString();
        String token = mapper.readTree(uploadResponse).get("uploadToken").asText();

        mvc.perform(post("/api/tas/recompute/" + token)
                .contentType(MediaType.APPLICATION_JSON))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.sessionSummaries.E1").isArray())
           .andExpect(jsonPath("$.sessionSummaries.E1[0].date").value("2026-06-02"));
    }

    // ── POST /api/tas/check-duplicates ──────────────────────────────

    @Test
    void checkDuplicates_validToken_returnsDuplicateCodes() throws Exception {
        EmployeeRow row1 = new EmployeeRow();
        row1.setCodigoEmpleado("DUP");
        row1.setNombreEmpleado("Dup Test");
        row1.setMes(3);
        row1.setAnio(2026);
        row1.setNumeroDequincena(1);

        EmployeeRow row2 = new EmployeeRow();
        row2.setCodigoEmpleado("NEW");
        row2.setNombreEmpleado("New Test");
        row2.setMes(3);
        row2.setAnio(2026);
        row2.setNumeroDequincena(1);

        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of(row1, row2));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(databaseService.checkDuplicates(any())).thenReturn(List.of("DUP"));

        mvc.perform(post("/api/tas/check-duplicates")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.duplicates").isArray())
           .andExpect(jsonPath("$.duplicates[0]").value("DUP"))
           .andExpect(jsonPath("$.duplicates.length()").value(1));
    }

    @Test
    void checkDuplicates_noDuplicates_returnsEmptyList() throws Exception {
        TasUploadResult result = emptyResult();
        result.setResolvedRows(List.of());
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(databaseService.checkDuplicates(any())).thenReturn(List.of());

        mvc.perform(post("/api/tas/check-duplicates")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.duplicates").isArray())
           .andExpect(jsonPath("$.duplicates").isEmpty());
    }

    @Test
    void checkDuplicates_invalidToken_returns404() throws Exception {
        mvc.perform(post("/api/tas/check-duplicates")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "nonexistent"))))
           .andExpect(status().isNotFound());
    }

    @Test
    void checkDuplicates_noResolvedRows_returnsEmptyList() throws Exception {
        TasUploadResult result = emptyResult();
        result.setResolvedRows(null);
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String token = (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");

        when(databaseService.checkDuplicates(any())).thenReturn(List.of());

        mvc.perform(post("/api/tas/check-duplicates")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.duplicates").isEmpty());
    }

    // ── Helper: seed stateStore with a minimal flagged session ───────────────

    private String seedResolveState(int sessionId) {
        TasSession session = new TasSession();
        session.setSessionId(sessionId);
        session.setEmployeeId("emp1");
        session.setDate(java.time.LocalDate.of(2026, 1, 1));
        session.setNeedsResolution(true);
        session.setFlags(new java.util.ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.MISSING_EXIT)));

        TasUploadState state = new TasUploadState();
        state.setUploadToken("res-tok");
        state.setSessions(new java.util.ArrayList<>(List.of(session)));
        state.setReportStart(java.time.LocalDate.of(2026, 1, 1));
        state.setReportEnd(java.time.LocalDate.of(2026, 1, 15));
        tasController.stateStore.put("res-tok", state);
        return "res-tok";
    }

    // ── ERR-2: malformed date string → 400, not 500 ──────────────────────────

    @Test
    void resolve_malformedDate_returns400() throws Exception {
        seedResolveState(42);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
            .thenReturn(new TasReportBuilder.BuildResult(List.of()));
        when(reportBuilder.computeAvailablePeriods(any())).thenReturn(List.of());

        Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("sessionId", 42);
        res.put("resolvedStart", "NOT-A-DATE");
        res.put("resolvedEnd",   "ALSO-BAD");

        Map<String, Object> body = Map.of(
            "uploadToken", "res-tok",
            "resolutions", List.of(res)
        );

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TIME_FORMAT"));
    }

    // ── ERR-3: non-string date (integer) → 400, not 500 ─────────────────────

    @Test
    void resolve_dateAsInteger_returns400() throws Exception {
        seedResolveState(44);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());

        Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("employeeId", "emp1");
        res.put("date", 20260101);
        res.put("keepSessionId", 1);

        Map<String, Object> body = Map.of(
            "uploadToken", "res-tok",
            "resolutions", List.of(res)
        );

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TIME_FORMAT"));
    }

    // ── INT-1: end-before-start → 400 ────────────────────────────────────────

    @Test
    void resolve_endBeforeStart_returns400() throws Exception {
        seedResolveState(43);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
            .thenReturn(new TasReportBuilder.BuildResult(List.of()));
        when(reportBuilder.computeAvailablePeriods(any())).thenReturn(List.of());

        Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("sessionId", 43);
        res.put("resolvedStart", "2026-01-01 17:00");
        res.put("resolvedEnd",   "2026-01-01 08:00");

        Map<String, Object> body = Map.of(
            "uploadToken", "res-tok",
            "resolutions", List.of(res)
        );

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TIME_RANGE"));
    }

    // ── SEC-2: stateStore TTL eviction ───────────────────────────────────────

    @Test
    void evictStaleStates_removesEntriesOlderThan30Minutes() {
        TasUploadState stale = new TasUploadState() {
            @Override public java.time.Instant getCreatedAt() {
                return java.time.Instant.now().minusSeconds(1900); // >31 min ago
            }
        };
        stale.setUploadToken("stale-token");
        tasController.stateStore.put("stale-token", stale);

        TasUploadState fresh = new TasUploadState();
        fresh.setUploadToken("fresh-token");
        tasController.stateStore.put("fresh-token", fresh);

        tasController.evictStaleStates();

        assertThat(tasController.stateStore).doesNotContainKey("stale-token");
        assertThat(tasController.stateStore).containsKey("fresh-token");
    }
}
