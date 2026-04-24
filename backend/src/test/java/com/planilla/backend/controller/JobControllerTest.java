package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.RowValidationResult;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.ValidationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Slice tests for JobController HTTP layer.
 *
 * Business logic (row processing, connection errors, retry rules) is tested
 * in JobServiceTest. These tests focus on HTTP status codes and response shapes.
 */
@WebMvcTest(JobController.class)
class JobControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @MockBean ValidationService validationService;
    @MockBean JobService jobService;

    private EmployeeRow row(String codigo) {
        EmployeeRow r = new EmployeeRow();
        r.setCodigoEmpleado(codigo);
        r.setNombreEmpleado("Test");
        r.setDiasNoLaborados(0);
        r.setHorasExtrasSimples(0);
        r.setHorasExtrasDobles(0);
        r.setNumeroDequincena(1);
        r.setMes(12);
        r.setAnio(2024);
        return r;
    }

    private RowValidationResult valid(String codigo) {
        return new RowValidationResult(codigo);
    }

    private RowValidationResult invalid(String codigo) {
        RowValidationResult r = new RowValidationResult(codigo);
        r.addError("mes", "El valor máximo permitido es 12.");
        return r;
    }

    private String json(Object o) throws Exception { return mapper.writeValueAsString(o); }

    // ── POST /api/submit ──────────────────────────────────────────────────────

    @Test
    void submit_validRows_returns202WithJobId() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1")));
        when(jobService.createJob(any())).thenReturn("job-abc");

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isAccepted())
           .andExpect(jsonPath("$.jobId").value("job-abc"))
           .andExpect(jsonPath("$.status").value("PENDING"));

        verify(jobService).createJob(any());
        verify(jobService).processJob("job-abc");
    }

    @Test
    void submit_invalidRows_returns400WithoutCreatingJob() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(invalid("1")));

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        verifyNoInteractions(jobService);
    }

    @Test
    void submit_mixedValidInvalid_returns400() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1"), invalid("2")));

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1"), row("2")))))
           .andExpect(status().isBadRequest());
    }

    @Test
    void submit_emptyList_returns202() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of());
        when(jobService.createJob(any())).thenReturn("job-xyz");

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of())))
           .andExpect(status().isAccepted())
           .andExpect(jsonPath("$.jobId").value("job-xyz"));
    }

    // ── GET /api/jobs/{jobId} ─────────────────────────────────────────────────

    @Test
    void getJob_existingJob_returns200WithJobState() throws Exception {
        Map<String, Object> mockResp = Map.of(
            "jobId", "job-abc",
            "status", "IN_PROGRESS",
            "totalRows", 5,
            "processed", 2,
            "submitted", 2,
            "skipped", 0,
            "failed", 0
        );
        when(jobService.getJobResponse("job-abc")).thenReturn(Optional.of(mockResp));

        mvc.perform(get("/api/jobs/job-abc"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.jobId").value("job-abc"))
           .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
           .andExpect(jsonPath("$.totalRows").value(5))
           .andExpect(jsonPath("$.processed").value(2));
    }

    @Test
    void getJob_unknownId_returns404() throws Exception {
        when(jobService.getJobResponse("no-such")).thenReturn(Optional.empty());

        mvc.perform(get("/api/jobs/no-such"))
           .andExpect(status().isNotFound());
    }

    // ── POST /api/jobs/{jobId}/retry ──────────────────────────────────────────

    @Test
    void retry_eligibleJob_returns202WithNewJobId() throws Exception {
        when(jobService.retryJob("job-abc")).thenReturn("job-retry-1");

        mvc.perform(post("/api/jobs/job-abc/retry"))
           .andExpect(status().isAccepted())
           .andExpect(jsonPath("$.jobId").value("job-retry-1"))
           .andExpect(jsonPath("$.status").value("PENDING"));

        verify(jobService).processJob("job-retry-1");
    }

    @Test
    void retry_unknownJob_returns404() throws Exception {
        when(jobService.retryJob(anyString())).thenThrow(new NoSuchElementException());

        mvc.perform(post("/api/jobs/no-such/retry"))
           .andExpect(status().isNotFound());
    }

    @Test
    void retry_maxRetriesReached_returns400() throws Exception {
        when(jobService.retryJob(anyString())).thenThrow(new IllegalStateException("Max retries reached"));

        mvc.perform(post("/api/jobs/job-abc/retry"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("RETRY_NOT_ALLOWED"));
    }

    @Test
    void retry_jobNotInRetryableState_returns400() throws Exception {
        when(jobService.retryJob(anyString())).thenThrow(new IllegalStateException("Job is not in a retryable state: DONE"));

        mvc.perform(post("/api/jobs/job-abc/retry"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("RETRY_NOT_ALLOWED"));
    }

    @Test
    void retry_noFailedRows_returns400() throws Exception {
        when(jobService.retryJob(anyString())).thenThrow(new IllegalStateException("No failed rows to retry"));

        mvc.perform(post("/api/jobs/job-abc/retry"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("RETRY_NOT_ALLOWED"));
    }
}
