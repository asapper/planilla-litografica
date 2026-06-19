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
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
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
    void createJob_returnsUuid() {
        String jobId = service.createJob(List.of(row("1")));
        assertThat(jobId).isNotBlank();
    }

    @Test
    void createJob_returnsDistinctIds() {
        String jobId1 = service.createJob(List.of(row("1")));
        String jobId2 = service.createJob(List.of(row("2")));
        assertThat(jobId1).isNotEqualTo(jobId2);
    }

    // ── processJob — happy path ───────────────────────────────────────────────

    @Test
    void processJob_submitsNonDuplicateRows() {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2")));
        JobService.JobResult result = service.processJob(jobId);

        verify(databaseService, times(2)).submitRow(any());
        assertThat(result.submitted()).isEqualTo(2);
        assertThat(result.failed()).isEqualTo(0);
        assertThat(result.hasFailures()).isFalse();
    }

    @Test
    void processJob_skipsDuplicateRows() {
        when(databaseService.isDuplicate(any())).thenReturn(true);

        String jobId = service.createJob(List.of(row("1")));
        JobService.JobResult result = service.processJob(jobId);

        verify(databaseService, never()).submitRow(any());
        assertThat(result.skipped()).isEqualTo(1);
        assertThat(result.failed()).isEqualTo(0);
    }

    @Test
    void processJob_mixedSubmittedAndSkipped() {
        when(databaseService.isDuplicate(any()))
            .thenReturn(true)   // row 1 duplicate
            .thenReturn(false); // row 2 fresh

        String jobId = service.createJob(List.of(row("1"), row("2")));
        service.processJob(jobId);

        verify(databaseService, times(1)).submitRow(any());
        verify(databaseService, times(2)).isDuplicate(any());
    }

    @Test
    void processJob_unknownJobIdIsNoOp() {
        JobService.JobResult result = service.processJob("no-such-job");
        assertThat(result.submitted()).isEqualTo(0);
        assertThat(result.failed()).isEqualTo(0);
        assertThat(result.hasFailures()).isFalse();
    }

    // ── processJob — connection error ─────────────────────────────────────────

    @Test
    void processJob_connectExceptionShortCircuitsRemainingRows() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("pool", new ConnectException()))
            .thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2"), row("3")));
        JobService.JobResult result = service.processJob(jobId);

        verify(databaseService, times(1)).isDuplicate(any());
        verify(databaseService, never()).submitRow(any());
        assertThat(result.failed()).isEqualTo(3);
        assertThat(result.hasFailures()).isTrue();
        assertThat(result.error()).isEqualTo("Base de datos remota no disponible.");
    }

    @Test
    void processJob_socketTimeoutShortCircuits() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("timeout", new SocketTimeoutException()));

        String jobId = service.createJob(List.of(row("1"), row("2")));
        JobService.JobResult result = service.processJob(jobId);

        verify(databaseService, times(1)).isDuplicate(any());
        verify(databaseService, never()).submitRow(any());
        assertThat(result.failed()).isEqualTo(2);
        assertThat(result.hasFailures()).isTrue();
    }

    // ── processJob — non-connection error ─────────────────────────────────────

    @Test
    void processJob_nonConnectionExceptionFailsSingleRowAndContinues() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("some DB error"))
            .thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2")));
        service.processJob(jobId);

        verify(databaseService, times(2)).isDuplicate(any());
        verify(databaseService, times(1)).submitRow(any());
    }

    @Test
    void processJob_nonConnectionErrorAllowsSubsequentRowProcessing() {
        when(databaseService.isDuplicate(any())).thenThrow(new RuntimeException("generic error"));

        String jobId = service.createJob(List.of(row("1")));
        assertThatCode(() -> service.processJob(jobId)).doesNotThrowAnyException();
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

    // ── getJobStatus ─────────────────────────────────────────────────────

    @Test
    void getJobStatus_unknownJobId_returnsNull() {
        assertThat(service.getJobStatus("no-such-job")).isNull();
    }

    @Test
    void getJobStatus_pendingJob_returnsPendingStatus() {
        String jobId = service.createJob(List.of(row("1"), row("2")));
        JobService.JobStatusDto status = service.getJobStatus(jobId);

        assertThat(status).isNotNull();
        assertThat(status.jobId()).isEqualTo(jobId);
        assertThat(status.status()).isEqualTo("PENDING");
        assertThat(status.totalRows()).isEqualTo(2);
        assertThat(status.submitted()).isEqualTo(0);
        assertThat(status.skipped()).isEqualTo(0);
        assertThat(status.failed()).isEqualTo(0);
        assertThat(status.failedRows()).isEmpty();
    }

    @Test
    void getJobStatus_afterProcessing_returnsFinalCounts() {
        when(databaseService.isDuplicate(any()))
            .thenReturn(true)
            .thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2")));
        service.processJob(jobId);

        JobService.JobStatusDto status = service.getJobStatus(jobId);
        assertThat(status.status()).isEqualTo("DONE");
        assertThat(status.submitted()).isEqualTo(1);
        assertThat(status.skipped()).isEqualTo(1);
        assertThat(status.failed()).isEqualTo(0);
        assertThat(status.failedRows()).isEmpty();
    }

    @Test
    void getJobStatus_withFailedRows_includesFailedRowDetails() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("some DB error"))
            .thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2")));
        service.processJob(jobId);

        JobService.JobStatusDto status = service.getJobStatus(jobId);
        assertThat(status.status()).isEqualTo("DONE_WITH_ERRORS");
        assertThat(status.failed()).isEqualTo(1);
        assertThat(status.failedRows()).hasSize(1);
        assertThat(status.failedRows().get(0).codigoEmpleado()).isEqualTo("1");
        assertThat(status.failedRows().get(0).nombreEmpleado()).isEqualTo("Test 1");
        assertThat(status.failedRows().get(0).error()).isEqualTo("Error al procesar el registro.");
    }

    // ── processJobAsync ─────────────────────────────────────────────────────

    @Test
    void processJobAsync_processesInBackground() throws Exception {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("1")));
        Map<String, Object> fakeStore = new ConcurrentHashMap<>();
        fakeStore.put("token-1", new Object());

        service.processJobAsync(jobId, "token-1", fakeStore);

        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            JobService.JobStatusDto status = service.getJobStatus(jobId);
            assertThat(status.status()).isEqualTo("DONE");
        });
        verify(databaseService).submitRow(any());
    }

    @Test
    void processJobAsync_removesStateOnSuccess() throws Exception {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("1")));
        Map<String, Object> fakeStore = new ConcurrentHashMap<>();
        fakeStore.put("token-1", new Object());

        service.processJobAsync(jobId, "token-1", fakeStore);

        await().atMost(Duration.ofSeconds(2)).untilAsserted(() ->
            assertThat(fakeStore).doesNotContainKey("token-1")
        );
    }

    @Test
    void processJobAsync_preservesStateOnFailure() throws Exception {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("DB error"));

        String jobId = service.createJob(List.of(row("1")));
        Map<String, Object> fakeStore = new ConcurrentHashMap<>();
        fakeStore.put("token-1", new Object());

        service.processJobAsync(jobId, "token-1", fakeStore);

        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            JobService.JobStatusDto status = service.getJobStatus(jobId);
            assertThat(status.status()).isEqualTo("DONE_WITH_ERRORS");
        });
        assertThat(fakeStore).containsKey("token-1");
    }
}
