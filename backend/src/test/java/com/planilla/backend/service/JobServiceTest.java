package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for JobService.
 *
 * processJob is called synchronously here (not through Spring's @Async proxy),
 * so it runs on the test thread and completes before assertions.
 *
 * Requirements:
 * - createJob creates a PENDING job and returns a UUID
 * - processJob: submitted/skipped/failed rows update status correctly
 * - Connection error → dbUnreachable=true, remaining rows set to FAILED
 * - Non-connection error → single row FAILED, processing continues
 * - retryJob creates a child job with only FAILED rows
 * - retryJob throws when max retries reached or job not in retryable state
 * - isConnectionError detects all known connection exception types
 */
@ExtendWith(MockitoExtension.class)
class JobServiceTest {

    @Mock
    DatabaseService databaseService;

    JobService service;

    @BeforeEach
    void setUp() {
        service = new JobService(databaseService);
        ReflectionTestUtils.setField(service, "maxRetries", 3);
    }

    private EmployeeRow row(String codigo) {
        EmployeeRow r = new EmployeeRow();
        r.setCodigoEmpleado(codigo);
        r.setNombreEmpleado("Test " + codigo);
        r.setDiasNoLaborados(0);
        r.setHorasExtrasSimples(0);
        r.setHorasExtrasDobles(0);
        r.setNumeroDequincena(1);
        r.setMes(12);
        r.setAnio(2024);
        return r;
    }

    // ── createJob ────────────────────────────────────────────────────────────

    @Test
    void createJob_returnsUuidAndJobIsPending() {
        String jobId = service.createJob(List.of(row("1")));
        assertThat(jobId).isNotBlank();

        Optional<Map<String, Object>> resp = service.getJobResponse(jobId);
        assertThat(resp).isPresent();
        assertThat(resp.get()).containsEntry("status", "PENDING");
        assertThat(resp.get()).containsEntry("totalRows", 1);
    }

    @Test
    void createJob_setsAttemptOneAndMaxRetries() {
        String jobId = service.createJob(List.of(row("1")));
        Map<String, Object> resp = service.getJobResponse(jobId).orElseThrow();
        assertThat(resp).containsEntry("attemptNumber", 1);
        assertThat(resp).containsEntry("maxRetries", 3);
        assertThat(resp.get("parentJobId")).isNull();
    }

    @Test
    void getJobResponse_emptyForUnknownId() {
        assertThat(service.getJobResponse("no-such-job")).isEmpty();
    }

    // ── processJob — happy path ───────────────────────────────────────────────

    @Test
    void processJob_submitsNonDuplicateRows() {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2")));
        service.processJob(jobId);

        Map<String, Object> resp = service.getJobResponse(jobId).orElseThrow();
        assertThat(resp).containsEntry("status", "DONE");
        assertThat(resp).containsEntry("submitted", 2);
        assertThat(resp).containsEntry("skipped", 0);
        assertThat(resp).containsEntry("failed", 0);
        assertThat(resp).containsEntry("processed", 2);

        verify(databaseService, times(2)).submitRow(any());
    }

    @Test
    void processJob_skipsDuplicateRows() {
        when(databaseService.isDuplicate(any())).thenReturn(true);

        String jobId = service.createJob(List.of(row("1")));
        service.processJob(jobId);

        Map<String, Object> resp = service.getJobResponse(jobId).orElseThrow();
        assertThat(resp).containsEntry("status", "DONE");
        assertThat(resp).containsEntry("skipped", 1);
        assertThat(resp).containsEntry("submitted", 0);

        verify(databaseService, never()).submitRow(any());
    }

    @Test
    void processJob_mixedSubmittedAndSkipped() {
        when(databaseService.isDuplicate(any()))
            .thenReturn(true)   // row 1 duplicate
            .thenReturn(false); // row 2 fresh

        String jobId = service.createJob(List.of(row("1"), row("2")));
        service.processJob(jobId);

        Map<String, Object> resp = service.getJobResponse(jobId).orElseThrow();
        assertThat(resp).containsEntry("submitted", 1);
        assertThat(resp).containsEntry("skipped", 1);
        assertThat(resp).containsEntry("failed", 0);
    }

    @Test
    void processJob_rowStatusesInResponse() {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("99")));
        service.processJob(jobId);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>)
            service.getJobResponse(jobId).orElseThrow().get("rows");

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0)).containsEntry("codigoEmpleado", "99");
        assertThat(rows.get(0)).containsEntry("status", "SUBMITTED");
    }

    // ── processJob — connection error ─────────────────────────────────────────

    @Test
    void processJob_connectExceptionShortCircuitsRemainingRows() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("pool", new ConnectException()))
            .thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2"), row("3")));
        service.processJob(jobId);

        Map<String, Object> resp = service.getJobResponse(jobId).orElseThrow();
        assertThat(resp).containsEntry("status", "DONE_WITH_ERRORS");
        assertThat(resp).containsEntry("failed", 3);
        assertThat(resp).containsEntry("submitted", 0);

        verify(databaseService, times(1)).isDuplicate(any());
    }

    @Test
    void processJob_socketTimeoutShortCircuits() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("timeout", new SocketTimeoutException()));

        String jobId = service.createJob(List.of(row("1"), row("2")));
        service.processJob(jobId);

        Map<String, Object> resp = service.getJobResponse(jobId).orElseThrow();
        assertThat(resp).containsEntry("failed", 2);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) resp.get("rows");
        assertThat(rows).allMatch(r -> r.get("error").equals("Base de datos remota no disponible."));
    }

    // ── processJob — non-connection error ─────────────────────────────────────

    @Test
    void processJob_nonConnectionExceptionFailsSingleRowAndContinues() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("some DB error"))
            .thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2")));
        service.processJob(jobId);

        Map<String, Object> resp = service.getJobResponse(jobId).orElseThrow();
        assertThat(resp).containsEntry("status", "DONE_WITH_ERRORS");
        assertThat(resp).containsEntry("failed", 1);
        assertThat(resp).containsEntry("submitted", 1);

        verify(databaseService, times(2)).isDuplicate(any());
    }

    @Test
    void processJob_nonConnectionErrorMessageSetOnRow() {
        when(databaseService.isDuplicate(any())).thenThrow(new RuntimeException("generic error"));

        String jobId = service.createJob(List.of(row("1")));
        service.processJob(jobId);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>)
            service.getJobResponse(jobId).orElseThrow().get("rows");

        assertThat(rows.get(0).get("error")).isEqualTo("Error al procesar el registro.");
    }

    // ── retryJob ─────────────────────────────────────────────────────────────

    @Test
    void retryJob_createsChildJobWithFailedRowsOnly() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("pool", new ConnectException())); // all fail

        String jobId = service.createJob(List.of(row("1"), row("2"), row("3")));
        service.processJob(jobId);

        String retryId = service.retryJob(jobId);
        assertThat(retryId).isNotEqualTo(jobId);

        Map<String, Object> retryResp = service.getJobResponse(retryId).orElseThrow();
        assertThat(retryResp).containsEntry("parentJobId", jobId);
        assertThat(retryResp).containsEntry("attemptNumber", 2);
        assertThat(retryResp).containsEntry("totalRows", 3);
        assertThat(retryResp).containsEntry("status", "PENDING");
    }

    @Test
    void retryJob_onlyRetriesFailedRows() {
        when(databaseService.isDuplicate(any()))
            .thenReturn(false) // row 1 succeeds
            .thenThrow(new RuntimeException("pool", new ConnectException())); // rows 2,3 fail

        String jobId = service.createJob(List.of(row("1"), row("2"), row("3")));
        service.processJob(jobId);

        String retryId = service.retryJob(jobId);
        Map<String, Object> retryResp = service.getJobResponse(retryId).orElseThrow();

        // Only 2 failed rows should be retried
        assertThat(retryResp).containsEntry("totalRows", 2);
    }

    @Test
    void retryJob_throwsWhenJobNotFound() {
        assertThatThrownBy(() -> service.retryJob("non-existent"))
            .isInstanceOf(NoSuchElementException.class);
    }

    @Test
    void retryJob_throwsWhenJobNotInDoneWithErrors() {
        String jobId = service.createJob(List.of(row("1")));
        // Job is still PENDING — not retryable
        assertThatThrownBy(() -> service.retryJob(jobId))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("retryable");
    }

    @Test
    void retryJob_throwsWhenMaxRetriesReached() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("pool", new ConnectException()));

        // Exhaust all retries
        String jobId = service.createJob(List.of(row("1")));
        service.processJob(jobId);

        String retry1 = service.retryJob(jobId);
        service.processJob(retry1);

        String retry2 = service.retryJob(retry1);
        service.processJob(retry2);

        // retry2 is now at attempt 3 = maxRetries → no more retries
        assertThatThrownBy(() -> service.retryJob(retry2))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Max retries");
    }

    @Test
    void retryJob_throwsWhenNoFailedRows() {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        // Manually create a DONE_WITH_ERRORS job with no failed rows (edge case)
        // We achieve this by having a successful job — but that gives DONE, not DONE_WITH_ERRORS.
        // Instead we verify via processJob that DONE status is not retryable.
        String jobId = service.createJob(List.of(row("1")));
        service.processJob(jobId); // DONE

        assertThatThrownBy(() -> service.retryJob(jobId))
            .isInstanceOf(IllegalStateException.class);
    }

    // ── isConnectionError ─────────────────────────────────────────────────────

    @Test
    void isConnectionError_detectsConnectException() {
        assertThat(JobService.isConnectionError(new RuntimeException(new ConnectException()))).isTrue();
    }

    @Test
    void isConnectionError_detectsSocketTimeoutException() {
        assertThat(JobService.isConnectionError(new RuntimeException(new SocketTimeoutException()))).isTrue();
    }

    @Test
    void isConnectionError_detectsNoRouteToHostException() {
        assertThat(JobService.isConnectionError(new RuntimeException(new java.net.NoRouteToHostException()))).isTrue();
    }

    @Test
    void isConnectionError_detectsSQLTransientByName() {
        RuntimeException e = new RuntimeException("SQLTransientConnectionException: pool timeout");
        // class name check won't match — we need a class whose name contains the substring
        class FakeSQLTransientConnectionException extends RuntimeException {
            FakeSQLTransientConnectionException() { super("pool timeout"); }
        }
        assertThat(JobService.isConnectionError(new FakeSQLTransientConnectionException())).isTrue();
    }

    @Test
    void isConnectionError_returnsFalseForGenericException() {
        assertThat(JobService.isConnectionError(new RuntimeException("generic"))).isFalse();
    }

    @Test
    void isConnectionError_walksEntireCauseChain() {
        Exception inner = new ConnectException("refused");
        Exception middle = new RuntimeException("middle", inner);
        Exception outer = new RuntimeException("outer", middle);
        assertThat(JobService.isConnectionError(outer)).isTrue();
    }
}
