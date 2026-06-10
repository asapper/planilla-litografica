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
        service.processJob(jobId);

        verify(databaseService, times(2)).submitRow(any());
    }

    @Test
    void processJob_skipsDuplicateRows() {
        when(databaseService.isDuplicate(any())).thenReturn(true);

        String jobId = service.createJob(List.of(row("1")));
        service.processJob(jobId);

        verify(databaseService, never()).submitRow(any());
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
        assertThatCode(() -> service.processJob("no-such-job")).doesNotThrowAnyException();
    }

    // ── processJob — connection error ─────────────────────────────────────────

    @Test
    void processJob_connectExceptionShortCircuitsRemainingRows() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("pool", new ConnectException()))
            .thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2"), row("3")));
        service.processJob(jobId);

        verify(databaseService, times(1)).isDuplicate(any());
        verify(databaseService, never()).submitRow(any());
    }

    @Test
    void processJob_socketTimeoutShortCircuits() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("timeout", new SocketTimeoutException()));

        String jobId = service.createJob(List.of(row("1"), row("2")));
        service.processJob(jobId);

        verify(databaseService, times(1)).isDuplicate(any());
        verify(databaseService, never()).submitRow(any());
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
}
