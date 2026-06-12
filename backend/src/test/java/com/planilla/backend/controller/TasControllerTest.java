package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasPeriod;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasUploadResult;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.tas.*;
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
        manana.put("start_time", "07:00");
        manana.put("end_time", "15:00");
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
        manana.put("start_time", "07:00");
        manana.put("end_time", "15:00");
        when(shiftConfigService.getAllShifts()).thenReturn(List.of(manana));
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>()));

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
        TasReportBuilder.BuildResult buildResult = new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>());
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
        TasReportBuilder.BuildResult buildResult = new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>());
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
        TasReportBuilder.BuildResult buildResult = new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>());
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
        TasReportBuilder.BuildResult buildResult = new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>());
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
    void deactivateAbsent_afterUploadStateRemoved_succeeds() throws Exception {
        // The upload state is removed once /submit completes, but the
        // absent-review modal is shown afterwards on the result screen.
        Map<String, Object> body = Map.of("employeeIds", List.of("100"));

        mvc.perform(post("/api/tas/absent-review/nonexistent/deactivate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk());

        verify(registryService).setActive("100", false);
    }

    @Test
    void deactivateAbsent_withActiveTrue_reactivatesEmployee() throws Exception {
        Map<String, Object> body = Map.of("employeeIds", List.of("100"), "active", true);

        mvc.perform(post("/api/tas/absent-review/nonexistent/deactivate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
           .andExpect(status().isOk());

        verify(registryService).setActive("100", true);
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
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.jobId").value("job-123"));

        verify(jobService).processJob("job-123");
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
                .thenReturn(new TasReportBuilder.BuildResult(List.of(recomputedRow), new LinkedHashMap<>()));

        mvc.perform(post("/api/tas/recompute/" + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.uploadToken").value(token))
           .andExpect(jsonPath("$.resolvedRows[0].codigoEmpleado").value("100"));
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

        java.lang.reflect.Field stateStoreField = TasController.class.getDeclaredField("stateStore");
        stateStoreField.setAccessible(true);
        @SuppressWarnings("unchecked")
        Map<String, TasUploadState> stateStore = (Map<String, TasUploadState>) stateStoreField.get(tasController);
        stateStore.get(token).setSessions(null);

        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), isNull()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>(), new LinkedHashMap<>()));

        mvc.perform(post("/api/tas/recompute/" + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.uploadToken").value(token));

        verify(reportBuilder).build(eq(Collections.emptyList()), any(), any(), any(), isNull());
    }
}
