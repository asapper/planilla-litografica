package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasPeriod;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasUploadResult;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.JobNotFoundException;
import com.planilla.backend.service.JobNotRetryableException;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.MaxRetriesExhaustedException;
import com.planilla.backend.service.tas.*;
import com.planilla.backend.service.tas.ParseValidationException;
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
    @MockBean TasDraftService         draftService;

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
                .thenThrow(new ParseValidationException("Columnas requeridas no encontradas: [Fecha y hora, ID de usuario]."));

        MockMultipartFile file = new MockMultipartFile("file", "bad.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("UPLOAD_FAILED"))
           .andExpect(jsonPath("$.message").value("Columnas requeridas no encontradas: [Fecha y hora, ID de usuario]."));
    }

    @Test
    void upload_parseException_returns400() throws Exception {
        when(parserService.parse(any())).thenThrow(new ParseValidationException("No se encontraron registros"));

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

    private String uploadWithSingleScanSession(String matchedShiftId, java.time.LocalDateTime scan,
                                               com.planilla.backend.model.tas.TasFlag... flags) throws Exception {
        boolean scanIsEntry = List.of(flags).contains(com.planilla.backend.model.tas.TasFlag.MISSING_EXIT);
        TasSession flagged = new TasSession();
        flagged.setSessionId(42);
        flagged.setEmployeeId("156");
        flagged.setDate(scan.toLocalDate());
        flagged.setMatchedShiftId(matchedShiftId);
        flagged.setMatchedShiftName(matchedShiftId);
        flagged.setScans(List.of(scan));
        flagged.setEffectiveStart(scanIsEntry ? scan : null);
        flagged.setLastScan(scan);
        flagged.setNeedsResolution(true);
        flagged.setFlags(new ArrayList<>(List.of(flags)));

        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(List.of(flagged));
        result.setAllSessions(List.of(flagged));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());
        String uploadResponse = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return (String) mapper.readValue(uploadResponse, Map.class).get("uploadToken");
    }

    private List<Map<String, Object>> threeShifts() {
        return new ArrayList<>(List.of(
                new LinkedHashMap<>(Map.of("id", "manana", "name", "Mañana", "startTime", "07:00", "endTime", "15:00", "crossMidnight", false)),
                new LinkedHashMap<>(Map.of("id", "tarde", "name", "Tarde", "startTime", "15:00", "endTime", "23:00", "crossMidnight", false)),
                new LinkedHashMap<>(Map.of("id", "noche", "name", "Noche", "startTime", "19:00", "endTime", "07:00", "crossMidnight", true))));
    }

    private String resolvedShift(String token, String start, String end, List<Map<String, Object>> shifts) throws Exception {
        when(shiftConfigService.getAllShifts()).thenReturn(shifts);
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));
        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("sessionId", 42);
        resolution.put("resolvedStart", start);
        resolution.put("resolvedEnd", end);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("resolutions", List.of(resolution));
        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON).content(json(body)))
           .andExpect(status().isOk());
        return tasController.stateStore.get(token).getSessions().get(0).getMatchedShiftId();
    }

    @Test
    void resolve_swappedEntryToExit_rematchesShiftFromTypedEntry() throws Exception {
        String token = uploadWithSingleScanSession("noche", java.time.LocalDateTime.of(2026, 10, 1, 17, 31),
                com.planilla.backend.model.tas.TasFlag.SHIFT_MISMATCH, com.planilla.backend.model.tas.TasFlag.MISSING_EXIT);

        org.assertj.core.api.Assertions.assertThat(
                resolvedShift(token, "2026-10-01 07:00", "2026-10-01 17:31", threeShifts())).isEqualTo("manana");
        org.assertj.core.api.Assertions.assertThat(
                tasController.stateStore.get(token).getSessions().get(0).getMatchedShiftName()).isEqualTo("Mañana");
    }

    @Test
    void resolve_swappedExitToEntry_rematchesShiftFromRecordedScan() throws Exception {
        String token = uploadWithSingleScanSession("tarde", java.time.LocalDateTime.of(2026, 10, 1, 22, 0),
                com.planilla.backend.model.tas.TasFlag.MISSING_ENTRY);

        org.assertj.core.api.Assertions.assertThat(
                resolvedShift(token, "2026-10-01 22:00", "2026-10-02 06:00", threeShifts())).isEqualTo("noche");
    }

    @Test
    void resolve_guessedShiftWithTypedEntry_rematchesShift() throws Exception {
        String token = uploadWithSingleScanSession("tarde", java.time.LocalDateTime.of(2026, 10, 1, 16, 58),
                com.planilla.backend.model.tas.TasFlag.BEST_FIT_SHIFT, com.planilla.backend.model.tas.TasFlag.MISSING_ENTRY);

        org.assertj.core.api.Assertions.assertThat(
                resolvedShift(token, "2026-10-01 07:00", "2026-10-01 16:58", threeShifts())).isEqualTo("manana");
    }

    @Test
    void resolve_lateArrivalTypedOnMatchedShift_keepsShift() throws Exception {
        String token = uploadWithSingleScanSession("manana", java.time.LocalDateTime.of(2026, 10, 1, 15, 0),
                com.planilla.backend.model.tas.TasFlag.MISSING_ENTRY);

        org.assertj.core.api.Assertions.assertThat(
                resolvedShift(token, "2026-10-01 11:05", "2026-10-01 15:00", threeShifts())).isEqualTo("manana");
    }

    @Test
    void resolve_unchangedEntry_keepsMatchedShift() throws Exception {
        String token = uploadWithSingleScanSession("noche", java.time.LocalDateTime.of(2026, 10, 1, 19, 7),
                com.planilla.backend.model.tas.TasFlag.BEST_FIT_SHIFT, com.planilla.backend.model.tas.TasFlag.MISSING_EXIT);

        org.assertj.core.api.Assertions.assertThat(
                resolvedShift(token, "2026-10-01 19:07", "2026-10-02 07:00", threeShifts())).isEqualTo("noche");
    }

    @Test
    void resolve_swapWithNoConfiguredShifts_keepsMatchedShift() throws Exception {
        String token = uploadWithSingleScanSession("noche", java.time.LocalDateTime.of(2026, 10, 1, 17, 31),
                com.planilla.backend.model.tas.TasFlag.MISSING_EXIT);

        org.assertj.core.api.Assertions.assertThat(
                resolvedShift(token, "2026-10-01 07:00", "2026-10-01 17:31", new ArrayList<>())).isEqualTo("noche");
    }

    @Test
    void isSwappedSingleScan_falseForMultiScanAndUnchangedSides() {
        java.time.LocalDateTime a = java.time.LocalDateTime.of(2026, 10, 1, 10, 0);
        java.time.LocalDateTime b = java.time.LocalDateTime.of(2026, 10, 1, 15, 0);
        TasSession multi = new TasSession();
        multi.setScans(List.of(a, b));
        multi.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.MISSING_ENTRY)));
        org.assertj.core.api.Assertions.assertThat(TasController.isSwappedSingleScan(multi, b, a.plusHours(8))).isFalse();

        TasSession single = new TasSession();
        single.setScans(List.of(b));
        single.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.MISSING_ENTRY)));
        org.assertj.core.api.Assertions.assertThat(TasController.isSwappedSingleScan(single, a, b)).isFalse();
        org.assertj.core.api.Assertions.assertThat(TasController.isSwappedSingleScan(single, b, b.plusHours(8))).isTrue();

        single.setFlags(null);
        org.assertj.core.api.Assertions.assertThat(TasController.isSwappedSingleScan(single, b, b.plusHours(8))).isFalse();
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

    // ── deactivateAbsent works after the upload state is evicted ──────────────
    // The employee registry is the source of truth for active state and persists
    // beyond the in-memory upload token, which is removed once the submit job
    // finishes. The post-submit "mark absent employees inactive" flow must keep
    // working against the registry even though the token is no longer in the store.

    @Test
    void deactivateAbsent_afterStateEvicted_stillDeactivatesViaRegistry() throws Exception {
        // deliberately no state in stateStore for this token
        when(registryService.employeeNotInRegistry("emp1")).thenReturn(false);

        Map<String, Object> body = Map.of("employeeIds", List.of("emp1"), "active", false);

        mvc.perform(post("/api/tas/absent-review/evicted-token/deactivate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.updated").value(1))
           .andExpect(jsonPath("$.notFound").isArray())
           .andExpect(jsonPath("$.notFound").isEmpty());

        verify(registryService).setActive("emp1", false);
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

        when(jobService.createJob(any(), any())).thenReturn("job-123");

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

        when(jobService.createJob(any(), any())).thenReturn("job-456");

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

        verify(jobService).processRetryJobAsync(eq("retry-id"), any());
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
            new MaxRetriesExhaustedException());

        mvc.perform(post("/api/tas/jobs/job-2/retry"))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.code").value("MAX_RETRIES_EXHAUSTED"))
           .andExpect(jsonPath("$.message").value("Se alcanzó el máximo de reintentos"));
    }

    @Test
    void retryJob_notRetryable_returns409WithNotRetryableCode() throws Exception {
        when(jobService.createRetryJob("job-3")).thenThrow(
            new JobNotRetryableException());

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

        when(jobService.createJob(any(), any())).thenReturn("job-override");

        Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", 15, "horasExtrasDobles", 4));
        Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", overrides);

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted())
           .andExpect(jsonPath("$.jobId").value("job-override"));

        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(jobService).createJob(captor.capture(), any());
        List<EmployeeRow> submitted = captor.getValue();
        assertThat(submitted).hasSize(1);
        assertThat(submitted.get(0).getHorasExtrasSimples()).isEqualTo(15);
        assertThat(submitted.get(0).getHorasExtrasDobles()).isEqualTo(4);
    }

    @Test
    void submit_ignoresOvertimeOverrideForNonAccruingEmployee() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Test");
        row.setDiasNoLaborados(0);
        row.setHorasExtrasSimples(0);
        row.setHorasExtrasDobles(0);
        row.setAccruesOvertime(false);
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

        when(jobService.createJob(any(), any())).thenReturn("job-nonaccruing");

        Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", 15, "horasExtrasDobles", 4));
        Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", overrides);

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted());

        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(jobService).createJob(captor.capture(), any());
        List<EmployeeRow> submitted = captor.getValue();
        assertThat(submitted.get(0).getHorasExtrasSimples()).isEqualTo(0);
        assertThat(submitted.get(0).getHorasExtrasDobles()).isEqualTo(0);
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

        when(jobService.createJob(any(), any())).thenReturn("job-nochange");

        Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", Map.of());

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted());

        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(jobService).createJob(captor.capture(), any());
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

        when(jobService.createJob(any(), any())).thenReturn("job-partial");

        Map<String, Object> overrides = Map.of("100", Map.of("horasExtrasSimples", 20));
        Map<String, Object> body = Map.of("uploadToken", token, "overtimeOverrides", overrides);

        mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isAccepted());

        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(jobService).createJob(captor.capture(), any());
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

        when(jobService.createJob(any(), any())).thenReturn("job-int3-1", "job-int3-2");

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

        when(jobService.createJob(any(), any())).thenReturn("job-dias");

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
        verify(jobService).createJob(captor.capture(), any());
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

        when(jobService.createJob(any(), any())).thenReturn("job-nochange-dias");

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
        verify(jobService).createJob(captor.capture(), any());
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

    // ── ERR-4: non-string employeeId (integer) → 400, not 500 ───────────────

    @Test
    void resolve_employeeIdAsInteger_returns400() throws Exception {
        seedResolveState(45);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());

        Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("employeeId", 123);
        res.put("date", "2026-01-01");
        res.put("keepSessionId", 1);

        Map<String, Object> body = Map.of(
            "uploadToken", "res-tok",
            "resolutions", List.of(res)
        );

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_EMPLOYEE_FORMAT"));
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
           .andExpect(jsonPath("$.code").value("INVALID_TIME_RANGE"))
           .andExpect(jsonPath("$.sessionId").value(43));
    }

    @Test
    void resolve_nonStringResolvedStart_namesTheSession() throws Exception {
        seedResolveState(46);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());

        Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("sessionId", 46);
        res.put("resolvedStart", 7);
        res.put("resolvedEnd", "2026-01-01 08:00");

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "res-tok", "resolutions", List.of(res)))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TIME_FORMAT"))
           .andExpect(jsonPath("$.sessionId").value(46));
    }

    @Test
    void resolve_shortDayCorrection_isAppliedAndOtherShortDaysStayListed() throws Exception {
        TasSession corrected = shortDaySession(50, "2026-01-05");
        TasSession untouched = shortDaySession(51, "2026-01-06");
        TasUploadState state = new TasUploadState();
        state.setUploadToken("short-tok");
        state.setSessions(new ArrayList<>(List.of(corrected, untouched)));
        state.setReportStart(java.time.LocalDate.of(2026, 1, 1));
        state.setReportEnd(java.time.LocalDate.of(2026, 1, 15));
        tasController.stateStore.put("short-tok", state);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
            .thenReturn(new TasReportBuilder.BuildResult(List.of()));
        when(reportBuilder.computeAvailablePeriods(any())).thenReturn(List.of());

        Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("sessionId", 50);
        res.put("resolvedStart", "2026-01-05 07:00");
        res.put("resolvedEnd",   "2026-01-05 15:00");

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "short-tok", "resolutions", List.of(res)))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(1))
           .andExpect(jsonPath("$.flaggedSessions[0].sessionId").value(51));

        assertThat(corrected.getLastScan()).isEqualTo(java.time.LocalDateTime.of(2026, 1, 5, 15, 0));
        assertThat(corrected.getWorkedMinutes()).isEqualTo(480);
        assertThat(corrected.getFlags()).isEmpty();
    }

    @Test
    void resolve_shortDay_refusesAShiftChange() throws Exception {
        TasSession s = shortDaySession(52, "2026-01-05");
        TasUploadState state = new TasUploadState();
        state.setUploadToken("short-tok");
        state.setSessions(new ArrayList<>(List.of(s)));
        tasController.stateStore.put("short-tok", state);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());

        Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("sessionId", 52);
        res.put("acceptedShiftId", "cualquiera");

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "short-tok", "resolutions", List.of(res)))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_FIELD_FORMAT"))
           .andExpect(jsonPath("$.sessionId").value(52));
        assertThat(s.getMatchedShiftId()).isNull();
    }

    @Test
    void resolve_discardedHalfOfADouble_isNotListedAsAShortDay() throws Exception {
        TasSession kept = sameDayDoubleSession(10, "manana", "Manana");
        TasSession discarded = sameDayDoubleSession(11, "tarde", "Tarde");
        discarded.getFlags().add(com.planilla.backend.model.tas.TasFlag.SHORT_DAY);
        TasUploadState state = new TasUploadState();
        state.setUploadToken("double-tok");
        state.setSessions(new ArrayList<>(List.of(kept, discarded)));
        tasController.stateStore.put("double-tok", state);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
            .thenReturn(new TasReportBuilder.BuildResult(List.of()));
        when(reportBuilder.computeAvailablePeriods(any())).thenReturn(List.of());

        Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("employeeId", "100");
        res.put("date", "2026-03-10");
        res.put("keepSessionId", 10);

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "double-tok", "resolutions", List.of(res)))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(0));
    }

    private TasSession shortDaySession(int sessionId, String date) {
        TasSession s = new TasSession();
        s.setSessionId(sessionId);
        s.setEmployeeId("emp1");
        s.setDate(java.time.LocalDate.parse(date));
        s.setEffectiveStart(java.time.LocalDate.parse(date).atTime(7, 0));
        s.setLastScan(java.time.LocalDate.parse(date).atTime(11, 0));
        s.setNeedsResolution(false);
        s.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.SHORT_DAY)));
        return s;
    }

    // ── SEC-2: stateStore TTL eviction ───────────────────────────────────────

    @Test
    void evictStaleStates_removesEntriesOlderThan30Minutes() {
        TasUploadState stale = new TasUploadState();
        stale.setLastAccessedAt(java.time.Instant.now().minusSeconds(1900));
        stale.setUploadToken("stale-token");
        tasController.stateStore.put("stale-token", stale);

        TasUploadState fresh = new TasUploadState();
        fresh.setUploadToken("fresh-token");
        tasController.stateStore.put("fresh-token", fresh);

        tasController.evictStaleStates();

        assertThat(tasController.stateStore).doesNotContainKey("stale-token");
        assertThat(tasController.stateStore).containsKey("fresh-token");
    }

    // ── Type-guard: bare casts in /resolve ───────────────────────────────────

    private String uploadAndGetToken(TasSession... sessions) throws Exception {
        TasUploadResult result = emptyResult();
        result.setFlaggedSessions(new ArrayList<>(List.of(sessions)));
        result.setAllSessions(new ArrayList<>(List.of(sessions)));
        when(parserService.parse(any())).thenReturn(emptyParseResult());
        when(uploadService.processScans(any(), any(), any())).thenReturn(result);
        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));

        MockMultipartFile file = new MockMultipartFile("file", "t.csv", "text/csv", "d".getBytes());
        String resp = mvc.perform(multipart("/api/tas/upload").file(file))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return (String) mapper.readValue(resp, Map.class).get("uploadToken");
    }

    private TasSession flaggedSession(int sessionId) {
        TasSession s = new TasSession();
        s.setSessionId(sessionId);
        s.setEmployeeId("100");
        s.setNeedsResolution(true);
        s.setFlags(new ArrayList<>(List.of(com.planilla.backend.model.tas.TasFlag.MISSING_EXIT)));
        return s;
    }

    @Test
    void resolve_nonStringResolvedStart_returns400WithInvalidTimeFormat() throws Exception {
        String token = uploadAndGetToken(flaggedSession(42));

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("sessionId", 42);
        resolution.put("resolvedStart", 20260310);
        resolution.put("resolvedEnd", "2026-03-10 15:00");

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token, "resolutions", List.of(resolution)))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TIME_FORMAT"));
    }

    @Test
    void resolve_nonStringResolvedEnd_returns400WithInvalidTimeFormat() throws Exception {
        String token = uploadAndGetToken(flaggedSession(42));

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("sessionId", 42);
        resolution.put("resolvedStart", "2026-03-10 07:00");
        resolution.put("resolvedEnd", 20260310);

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token, "resolutions", List.of(resolution)))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TIME_FORMAT"));
    }

    @Test
    void resolve_nonStringAcceptedShiftId_returns400WithInvalidFieldFormat() throws Exception {
        String token = uploadAndGetToken(flaggedSession(42));

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("sessionId", 42);
        resolution.put("acceptedShiftId", 99);

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token, "resolutions", List.of(resolution)))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_FIELD_FORMAT"));
    }

    @Test
    void resolve_nonNumberSessionId_returns400WithInvalidSessionFormat() throws Exception {
        String token = uploadAndGetToken(flaggedSession(42));

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("sessionId", "42");
        resolution.put("resolvedStart", "2026-03-10 07:00");
        resolution.put("resolvedEnd", "2026-03-10 15:00");

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token, "resolutions", List.of(resolution)))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_SESSION_FORMAT"));
    }

    @Test
    void upload_serviceThrowsException_doesNotLeakExceptionMessage() throws Exception {
        when(parserService.parse(any())).thenThrow(
            new RuntimeException("internal: SQL error on table CARGA_LOG at /home/user/.planilla")
        );

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("UPLOAD_FAILED"))
           .andExpect(jsonPath("$.message").value("Error al procesar el archivo."));
    }

    @Test
    void upload_parseValidationExceptionWithNullMessage_returnsFallbackMessage() throws Exception {
        when(parserService.parse(any())).thenThrow(new ParseValidationException(null));

        MockMultipartFile file = new MockMultipartFile("file", "test.csv", "text/csv", "data".getBytes());

        mvc.perform(multipart("/api/tas/upload").file(file))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("UPLOAD_FAILED"))
           .andExpect(jsonPath("$.message").value("Error al procesar el archivo."));
    }

    @Test
    void resolve_nonNumberKeepSessionId_returns400WithInvalidSessionFormat() throws Exception {
        TasSession a = sameDayDoubleSession(10, "manana", "Manana");
        TasSession b = sameDayDoubleSession(11, "tarde", "Tarde");
        String token = uploadAndGetToken(a, b);

        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("employeeId", "100");
        resolution.put("date", "2026-03-10");
        resolution.put("keepSessionId", true);

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", token, "resolutions", List.of(resolution)))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_SESSION_FORMAT"));
    }

    // ── GET /api/tas/coverage/{uploadToken} ────────────────────────────────

    private static EmployeeRow periodRow(String code, int anio, int mes, Integer q) {
        EmployeeRow r = new EmployeeRow();
        r.setCodigoEmpleado(code);
        r.setAnio(anio);
        r.setMes(mes);
        r.setNumeroDequincena(q);
        return r;
    }

    @Test
    void coverage_invalidToken_returns400() throws Exception {
        mvc.perform(get("/api/tas/coverage/does-not-exist"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
    }

    @Test
    void coverage_passesFileRangeAndRowPeriods_andSerializesGapsAsIsoDates() throws Exception {
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok-cov");
        state.setReportStart(java.time.LocalDate.of(2026, 9, 28));
        state.setReportEnd(java.time.LocalDate.of(2026, 10, 11));
        state.setResolvedRows(List.of(
                periodRow("100", 2026, 10, 1),
                periodRow("101", 2026, 10, 1),
                periodRow("102", 2026, 10, null)));
        tasController.stateStore.put("tok-cov", state);

        TasPeriod oct1 = new TasPeriod(2026, 10, 1);
        when(reportBuilder.findIncompletePeriods(any(), any(), any())).thenReturn(List.of(
                new TasReportBuilder.PeriodCoverage(oct1,
                        java.time.LocalDate.of(2026, 10, 1), java.time.LocalDate.of(2026, 10, 15),
                        java.time.LocalDate.of(2026, 9, 28), java.time.LocalDate.of(2026, 10, 11),
                        List.of(java.time.LocalDate.of(2026, 10, 12), java.time.LocalDate.of(2026, 10, 15)))));

        mvc.perform(get("/api/tas/coverage/tok-cov"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.uploadToken").value("tok-cov"))
           .andExpect(jsonPath("$.incompletePeriods.length()").value(1))
           .andExpect(jsonPath("$.incompletePeriods[0].anio").value(2026))
           .andExpect(jsonPath("$.incompletePeriods[0].mes").value(10))
           .andExpect(jsonPath("$.incompletePeriods[0].numeroDequincena").value(1))
           .andExpect(jsonPath("$.incompletePeriods[0].periodStart").value("2026-10-01"))
           .andExpect(jsonPath("$.incompletePeriods[0].periodEnd").value("2026-10-15"))
           .andExpect(jsonPath("$.incompletePeriods[0].dataStart").value("2026-09-28"))
           .andExpect(jsonPath("$.incompletePeriods[0].dataEnd").value("2026-10-11"))
           .andExpect(jsonPath("$.incompletePeriods[0].missingWorkingDays[0]").value("2026-10-12"))
           .andExpect(jsonPath("$.incompletePeriods[0].missingWorkingDays[1]").value("2026-10-15"));

        verify(reportBuilder).findIncompletePeriods(
                eq(java.time.LocalDate.of(2026, 9, 28)),
                eq(java.time.LocalDate.of(2026, 10, 11)),
                eq(List.of(oct1, oct1)));
    }

    @Test
    void coverage_noResolvedRowsYet_checksNoPeriods() throws Exception {
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok-cov-empty");
        tasController.stateStore.put("tok-cov-empty", state);
        when(reportBuilder.findIncompletePeriods(any(), any(), any())).thenReturn(List.of());

        mvc.perform(get("/api/tas/coverage/tok-cov-empty"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.incompletePeriods.length()").value(0));

        verify(reportBuilder).findIncompletePeriods(isNull(), isNull(), eq(List.of()));
    }

    private static TasScanRecord scanAt(String employeeId, String timestamp) {
        TasScanRecord r = new TasScanRecord();
        r.setEmployeeId(employeeId);
        r.setTimestamp(java.time.LocalDateTime.parse(timestamp));
        return r;
    }

    @Test
    void coverage_usesTheFileScans_skippingIgnoredEmployees() throws Exception {
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok-cov-sess");
        state.setReportStart(java.time.LocalDate.of(2026, 10, 1));
        state.setReportEnd(java.time.LocalDate.of(2026, 10, 15));
        state.setAllScans(new ArrayList<>(List.of(
                scanAt("100", "2026-10-11T15:00"),
                scanAt("900", "2026-10-15T07:00"),
                scanAt("100", "2026-10-02T07:00"))));
        state.setIgnoredEmployeeIds(new HashSet<>(Set.of("900")));
        state.setResolvedRows(List.of(periodRow("100", 2026, 10, 1)));
        tasController.stateStore.put("tok-cov-sess", state);
        when(reportBuilder.findIncompletePeriods(any(), any(), any())).thenReturn(List.of());

        mvc.perform(get("/api/tas/coverage/tok-cov-sess")).andExpect(status().isOk());

        verify(reportBuilder).findIncompletePeriods(
                eq(java.time.LocalDate.of(2026, 10, 2)),
                eq(java.time.LocalDate.of(2026, 10, 11)),
                eq(List.of(new TasPeriod(2026, 10, 1))));
    }

    @Test
    void coverage_aNightDatedByItsTypedEntry_doesNotHideAMissingFirstDay() throws Exception {
        TasSession night = seedNightState("tok-cov-night", "2026-01-02", TasFlag.MISSING_ENTRY);
        TasUploadState state = tasController.stateStore.get("tok-cov-night");
        state.setAllScans(new ArrayList<>(List.of(
                scanAt("emp1", "2026-01-02T06:00"), scanAt("emp2", "2026-01-15T15:00"))));
        state.setIgnoredEmployeeIds(new HashSet<>());
        resolveTimes("tok-cov-night", "2026-01-01 22:00", "2026-01-02 06:00");
        assertThat(night.getDate()).isEqualTo(java.time.LocalDate.of(2026, 1, 1));
        state.setResolvedRows(List.of(periodRow("emp1", 2026, 1, 1)));
        when(reportBuilder.findIncompletePeriods(any(), any(), any())).thenReturn(List.of());

        mvc.perform(get("/api/tas/coverage/tok-cov-night")).andExpect(status().isOk());

        verify(reportBuilder).findIncompletePeriods(
                eq(java.time.LocalDate.of(2026, 1, 2)), eq(java.time.LocalDate.of(2026, 1, 15)), any());
    }

    @Test
    void coverage_afterEviction_rehydratesFromTheDraft() throws Exception {
        TasUploadState saved = new TasUploadState();
        saved.setUploadToken("tok-cov-draft");
        saved.setReportStart(java.time.LocalDate.of(2026, 10, 1));
        saved.setReportEnd(java.time.LocalDate.of(2026, 10, 11));
        saved.setResolvedRows(List.of(periodRow("100", 2026, 10, 1)));
        when(draftService.loadState("tok-cov-draft")).thenReturn(saved);
        when(reportBuilder.findIncompletePeriods(any(), any(), any())).thenReturn(List.of());

        mvc.perform(get("/api/tas/coverage/tok-cov-draft"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.incompletePeriods.length()").value(0));

        verify(reportBuilder).findIncompletePeriods(
                eq(java.time.LocalDate.of(2026, 10, 1)),
                eq(java.time.LocalDate.of(2026, 10, 11)),
                eq(List.of(new TasPeriod(2026, 10, 1))));
    }

    // ── Night shifts anchored on the exit, and the shift's crossMidnight ──────

    private static Map<String, Object> shift(String id, String name, String start, String end, boolean crossMidnight) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("name", name);
        m.put("startTime", start);
        m.put("endTime", end);
        m.put("crossMidnight", crossMidnight);
        return m;
    }

    private TasSession seedNightState(String token, String date, TasFlag... flags) {
        TasSession s = new TasSession();
        s.setSessionId(70);
        s.setEmployeeId("emp1");
        s.setDate(java.time.LocalDate.parse(date));
        s.setMatchedShiftId("manana");
        s.setMatchedShiftName("Mañana");
        s.setCrossMidnight(false);
        s.setNeedsResolution(true);
        s.setFlags(new ArrayList<>(List.of(flags)));
        TasUploadState state = new TasUploadState();
        state.setUploadToken(token);
        state.setSessions(new ArrayList<>(List.of(s)));
        state.setReportStart(java.time.LocalDate.of(2026, 1, 1));
        state.setReportEnd(java.time.LocalDate.of(2026, 1, 31));
        tasController.stateStore.put(token, state);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(
                shift("manana", "Mañana", "07:00", "15:00", false),
                shift("noche", "Noche", "22:00", "06:00", true)));
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(List.of()));
        when(reportBuilder.computeAvailablePeriods(any())).thenReturn(List.of());
        return s;
    }

    private void resolveTimes(String token, String start, String end) throws Exception {
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("sessionId", 70);
        res.put("resolvedStart", start);
        res.put("resolvedEnd", end);
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", token, "resolutions", List.of(res)))))
           .andExpect(status().isOk());
    }

    @Test
    void resolve_nightAnchoredOnItsExit_isDatedByItsStart() throws Exception {
        TasSession s = seedNightState("night-tok", "2026-01-07", TasFlag.MISSING_ENTRY, TasFlag.BEST_FIT_SHIFT);

        resolveTimes("night-tok", "2026-01-06 22:00", "2026-01-07 06:00");

        assertThat(s.getDate()).isEqualTo(java.time.LocalDate.of(2026, 1, 6));
        assertThat(s.getMatchedShiftId()).isEqualTo("noche");
        assertThat(s.isCrossMidnight()).isTrue();
    }

    @Test
    void resolve_nightAnchoredOnTheSixteenth_staysInItsFortnight() throws Exception {
        TasSession s = seedNightState("night-tok", "2026-01-16", TasFlag.MISSING_ENTRY);

        resolveTimes("night-tok", "2026-01-15 22:00", "2026-01-16 06:00");

        assertThat(s.getDate()).isEqualTo(java.time.LocalDate.of(2026, 1, 16));
        assertThat(s.getEffectiveStart()).isEqualTo(java.time.LocalDateTime.of(2026, 1, 15, 22, 0));
    }

    @Test
    void resolve_sameDayTimes_keepTheDate() throws Exception {
        TasSession s = seedNightState("night-tok", "2026-01-07", TasFlag.MISSING_EXIT);

        resolveTimes("night-tok", "2026-01-07 07:00", "2026-01-07 15:00");

        assertThat(s.getDate()).isEqualTo(java.time.LocalDate.of(2026, 1, 7));
    }

    @Test
    void resolve_acceptedShift_carriesItsNameAndCrossMidnight() throws Exception {
        TasSession s = seedNightState("night-tok", "2026-01-07", TasFlag.SHIFT_MISMATCH);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("sessionId", 70);
        res.put("acceptedShiftId", "noche");
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "night-tok", "resolutions", List.of(res)))))
           .andExpect(status().isOk());

        assertThat(s.getMatchedShiftId()).isEqualTo("noche");
        assertThat(s.getMatchedShiftName()).isEqualTo("Noche");
        assertThat(s.isCrossMidnight()).isTrue();
    }

    @Test
    void resolve_acceptedShiftMissingFromConfig_keepsTheId() throws Exception {
        TasSession s = seedNightState("night-tok", "2026-01-07", TasFlag.SHIFT_MISMATCH);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("sessionId", 70);
        res.put("acceptedShiftId", "borrado");
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "night-tok", "resolutions", List.of(res)))))
           .andExpect(status().isOk());

        assertThat(s.getMatchedShiftId()).isEqualTo("borrado");
        assertThat(s.isCrossMidnight()).isFalse();
    }

    @Test
    void resolve_twoHalvesOfOneNightResolvedAsTheSameNight_isRefusedNamingTheSession() throws Exception {
        TasSession entryHalf = seedNightState("night-tok", "2026-01-06", TasFlag.MISSING_EXIT);
        TasSession exitHalf = new TasSession();
        exitHalf.setSessionId(71);
        exitHalf.setEmployeeId("emp1");
        exitHalf.setDate(java.time.LocalDate.of(2026, 1, 7));
        exitHalf.setNeedsResolution(true);
        exitHalf.setFlags(new ArrayList<>(List.of(TasFlag.MISSING_ENTRY)));
        tasController.stateStore.get("night-tok").getSessions().add(exitHalf);

        Map<String, Object> first = new LinkedHashMap<>();
        first.put("sessionId", 70);
        first.put("resolvedStart", "2026-01-06 22:00");
        first.put("resolvedEnd", "2026-01-07 06:00");
        Map<String, Object> second = new LinkedHashMap<>(first);
        second.put("sessionId", 71);

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "night-tok", "resolutions", List.of(first, second)))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("OVERLAPPING_SESSIONS"))
           .andExpect(jsonPath("$.sessionId").value(70))
           .andExpect(jsonPath("$.message").value("La jornada se cruza con otra del mismo empleado (06/01 22:00 – 07/01 06:00)."));

        assertThat(entryHalf.isNeedsResolution()).isTrue();
        assertThat(entryHalf.getDate()).isEqualTo(java.time.LocalDate.of(2026, 1, 6));
    }

    @Test
    void resolve_overlappingAnAlreadyCountedDay_isRefused() throws Exception {
        seedNightState("night-tok", "2026-01-07", TasFlag.MISSING_EXIT);
        TasSession counted = new TasSession();
        counted.setSessionId(72);
        counted.setEmployeeId("emp1");
        counted.setDate(java.time.LocalDate.of(2026, 1, 7));
        counted.setEffectiveStart(java.time.LocalDateTime.of(2026, 1, 7, 14, 0));
        counted.setLastScan(java.time.LocalDateTime.of(2026, 1, 7, 22, 0));
        counted.setWorkedMinutes(480);
        counted.setFlags(new ArrayList<>());
        tasController.stateStore.get("night-tok").getSessions().add(counted);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("sessionId", 70);
        res.put("resolvedStart", "2026-01-07 07:00");
        res.put("resolvedEnd", "2026-01-07 15:00");
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "night-tok", "resolutions", List.of(res)))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("OVERLAPPING_SESSIONS"));
    }

    @Test
    void resolve_adjacentAndDiscardedDays_doNotCountAsOverlap() throws Exception {
        seedNightState("night-tok", "2026-01-07", TasFlag.MISSING_EXIT);
        TasSession before = new TasSession();
        before.setSessionId(73);
        before.setEmployeeId("emp1");
        before.setDate(java.time.LocalDate.of(2026, 1, 6));
        before.setEffectiveStart(java.time.LocalDateTime.of(2026, 1, 6, 22, 0));
        before.setLastScan(java.time.LocalDateTime.of(2026, 1, 7, 7, 0));
        before.setWorkedMinutes(540);
        before.setFlags(new ArrayList<>());
        TasSession discarded = new TasSession();
        discarded.setSessionId(74);
        discarded.setEmployeeId("emp1");
        discarded.setDate(java.time.LocalDate.of(2026, 1, 7));
        discarded.setEffectiveStart(java.time.LocalDateTime.of(2026, 1, 7, 8, 0));
        discarded.setLastScan(java.time.LocalDateTime.of(2026, 1, 7, 12, 0));
        discarded.setWorkedMinutes(0);
        discarded.setFlags(new ArrayList<>());
        tasController.stateStore.get("night-tok").getSessions().addAll(List.of(before, discarded));

        resolveTimes("night-tok", "2026-01-07 07:00", "2026-01-07 15:00");
    }

    @Test
    void resolve_startLaterThanTheSessionDate_movesTheDateForward() throws Exception {
        TasSession s = seedNightState("night-tok", "2026-01-07", TasFlag.MISSING_EXIT);

        resolveTimes("night-tok", "2026-01-08 07:00", "2026-01-08 15:00");

        assertThat(s.getDate()).isEqualTo(java.time.LocalDate.of(2026, 1, 8));
    }

    @Test
    void resolve_nightDatedByItsEntry_countsTheEntryDayAsWorked() throws Exception {
        seedNightState("night-tok", "2026-01-07", TasFlag.MISSING_ENTRY);
        TasSession nextNight = new TasSession();
        nextNight.setSessionId(75);
        nextNight.setEmployeeId("emp1");
        nextNight.setEmployeeName("Ana");
        nextNight.setDate(java.time.LocalDate.of(2026, 1, 7));
        nextNight.setEffectiveStart(java.time.LocalDateTime.of(2026, 1, 7, 22, 0));
        nextNight.setLastScan(java.time.LocalDateTime.of(2026, 1, 8, 6, 0));
        nextNight.setWorkedMinutes(480);
        nextNight.setFlags(new ArrayList<>());
        tasController.stateStore.get("night-tok").getSessions().add(nextNight);
        tasController.stateStore.get("night-tok").setReportEnd(java.time.LocalDate.of(2026, 1, 15));

        com.planilla.backend.service.tas.HolidayService holidays = org.mockito.Mockito.mock(com.planilla.backend.service.tas.HolidayService.class);
        EmployeeRegistryService registry = org.mockito.Mockito.mock(EmployeeRegistryService.class);
        when(registry.getAccruesOvertimeFlags(any())).thenReturn(Map.of());
        TasReportBuilder real = new TasReportBuilder(holidays, registry);
        when(reportBuilder.build(any(), any(), any(), any(), any())).thenAnswer(inv -> real.build(
                inv.getArgument(0), inv.getArgument(1), inv.getArgument(2), inv.getArgument(3), inv.getArgument(4)));

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("sessionId", 70);
        res.put("resolvedStart", "2026-01-06 22:00");
        res.put("resolvedEnd", "2026-01-07 06:00");
        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of(
                        "uploadToken", "night-tok", "resolutions", List.of(res),
                        "anio", 2026, "mes", 1, "numeroDequincena", 1))))
           .andExpect(status().isOk())
           // 13 working days from Jan 1 to 15 (two Sundays), both nights worked: Jan 6 and Jan 7.
           .andExpect(jsonPath("$.resolvedRows[0].diasNoLaborados").value(11));
    }

    // ── TASK-98: a double made of single scans ───────────────────────────────

    private List<TasSession> seedSingleScanDouble(String token) {
        TasSession morning = new TasSession();
        morning.setSessionId(1);
        morning.setEmployeeId("296");
        morning.setEmployeeName("Molina");
        morning.setDate(java.time.LocalDate.of(2026, 9, 29));
        morning.setEffectiveStart(java.time.LocalDateTime.of(2026, 9, 29, 7, 8));
        morning.setLastScan(java.time.LocalDateTime.of(2026, 9, 29, 7, 8));
        morning.setScans(new ArrayList<>(List.of(java.time.LocalDateTime.of(2026, 9, 29, 7, 8))));
        morning.setMatchedShiftId("manana");
        morning.setNeedsResolution(true);
        morning.setFlags(new ArrayList<>(List.of(TasFlag.SAME_DAY_DOUBLE, TasFlag.MISSING_EXIT)));
        TasSession evening = new TasSession();
        evening.setSessionId(2);
        evening.setEmployeeId("296");
        evening.setEmployeeName("Molina");
        evening.setDate(java.time.LocalDate.of(2026, 9, 29));
        evening.setEffectiveStart(java.time.LocalDateTime.of(2026, 9, 29, 22, 3));
        evening.setLastScan(java.time.LocalDateTime.of(2026, 9, 29, 22, 3));
        evening.setScans(new ArrayList<>(List.of(java.time.LocalDateTime.of(2026, 9, 29, 22, 3))));
        evening.setMatchedShiftId("noche");
        evening.setNeedsResolution(true);
        evening.setFlags(new ArrayList<>(List.of(TasFlag.BEST_FIT_SHIFT, TasFlag.SAME_DAY_DOUBLE, TasFlag.MISSING_EXIT)));
        TasUploadState state = new TasUploadState();
        state.setUploadToken(token);
        state.setSessions(new ArrayList<>(List.of(morning, evening)));
        tasController.stateStore.put(token, state);
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
            .thenReturn(new TasReportBuilder.BuildResult(List.of()));
        when(reportBuilder.computeAvailablePeriods(any())).thenReturn(List.of());
        return List.of(morning, evening);
    }

    private static Map<String, Object> typedTimes(int sessionId, String start, String end) {
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("sessionId", sessionId);
        res.put("resolvedStart", start);
        res.put("resolvedEnd", end);
        return res;
    }

    private static Map<String, Object> keep(Object keepSessionId) {
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("employeeId", "296");
        res.put("date", "2026-09-29");
        res.put("keepSessionId", keepSessionId);
        return res;
    }

    @Test
    void resolve_singleScanDoubleAsOneDay_keepsTheMergedDayAndDropsTheOtherScan() throws Exception {
        List<TasSession> day = seedSingleScanDouble("single-tok");

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "single-tok", "resolutions",
                        List.of(typedTimes(1, "2026-09-29 07:08", "2026-09-29 22:03"), keep(1))))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

        assertThat(day.get(0).getWorkedMinutes()).isEqualTo(895);
        assertThat(day.get(0).isNeedsResolution()).isFalse();
        assertThat(day.get(1).getWorkedMinutes()).isZero();
        assertThat(day.get(1).isNeedsResolution()).isFalse();
    }

    @Test
    void resolve_singleScanDoubleKeptWhole_takesTheTypedTimesOfBothInOnePass() throws Exception {
        List<TasSession> day = seedSingleScanDouble("both-tok");

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "both-tok", "resolutions", List.of(
                        typedTimes(1, "2026-09-29 07:08", "2026-09-29 15:00"),
                        typedTimes(2, "2026-09-29 22:03", "2026-09-30 06:00"),
                        keep("all"))))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.flaggedSessions.length()").value(0));

        assertThat(day.get(0).getWorkedMinutes()).isEqualTo(472);
        assertThat(day.get(1).getWorkedMinutes()).isEqualTo(477);
    }

    @Test
    void resolve_timesForTheDiscardedHalfOfADouble_areRefusedNamingIt() throws Exception {
        List<TasSession> day = seedSingleScanDouble("discard-tok");
        long revision = tasController.stateStore.get("discard-tok").getRevision();

        mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", "discard-tok", "resolutions",
                        List.of(keep(1), typedTimes(2, "2026-09-29 22:03", "2026-09-30 06:00"))))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("DISCARDED_SESSION_WITH_TIMES"))
           .andExpect(jsonPath("$.sessionId").value(2));

        assertThat(day.get(1).isNeedsResolution()).isTrue();
        assertThat(day.get(0).getFlags()).contains(TasFlag.SAME_DAY_DOUBLE);
        assertThat(tasController.stateStore.get("discard-tok").getRevision()).isEqualTo(revision);
    }
}
