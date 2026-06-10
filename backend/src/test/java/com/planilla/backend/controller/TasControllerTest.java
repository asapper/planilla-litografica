package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasScanRecord;
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

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(TasController.class)
class TasControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

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
    void upload_inactiveEmployeesFound_returns409() throws Exception {
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
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.inactiveEmployeesFound").isArray())
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
        when(reportBuilder.build(any(), any(), any(), any())).thenReturn(buildResult);

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
}
