package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.service.tas.TasDraftService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;

import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
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

    @Mock
    TasDraftService draftService;

    JobService service;

    @BeforeEach
    void setUp() {
        service = new JobService(databaseService, draftService);
        ReflectionTestUtils.setField(service, "maxRetries", 3);
    }

    private static String newToken() {
        return UUID.randomUUID().toString();
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
        String jobId = service.createJob(List.of(row("1")), newToken());
        assertThat(jobId).isNotBlank();
    }

    @Test
    void createJob_returnsDistinctIds() {
        String jobId1 = service.createJob(List.of(row("1")), newToken());
        String jobId2 = service.createJob(List.of(row("2")), newToken());
        assertThat(jobId1).isNotEqualTo(jobId2);
    }

    // ── processJob — happy path ───────────────────────────────────────────────

    @Test
    void processJob_submitsNonDuplicateRows() {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2")), newToken());
        JobService.JobResult result = service.processJob(jobId);

        verify(databaseService, times(2)).submitRow(any());
        assertThat(result.submitted()).isEqualTo(2);
        assertThat(result.failed()).isEqualTo(0);
        assertThat(result.hasFailures()).isFalse();
    }

    @Test
    void processJob_skipsDuplicateRows() {
        when(databaseService.isDuplicate(any())).thenReturn(true);

        String jobId = service.createJob(List.of(row("1")), newToken());
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

        String jobId = service.createJob(List.of(row("1"), row("2")), newToken());
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

        String jobId = service.createJob(List.of(row("1"), row("2"), row("3")), newToken());
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

        String jobId = service.createJob(List.of(row("1"), row("2")), newToken());
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

        String jobId = service.createJob(List.of(row("1"), row("2")), newToken());
        service.processJob(jobId);

        verify(databaseService, times(2)).isDuplicate(any());
        verify(databaseService, times(1)).submitRow(any());
    }

    @Test
    void processJob_nonConnectionErrorAllowsSubsequentRowProcessing() {
        when(databaseService.isDuplicate(any())).thenThrow(new RuntimeException("generic error"));

        String jobId = service.createJob(List.of(row("1")), newToken());
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
        String jobId = service.createJob(List.of(row("1"), row("2")), newToken());
        JobService.JobStatusDto status = service.getJobStatus(jobId);

        assertThat(status).isNotNull();
        assertThat(status.jobId()).isEqualTo(jobId);
        assertThat(status.status()).isEqualTo("PENDING");
        assertThat(status.totalRows()).isEqualTo(2);
        assertThat(status.submitted()).isEqualTo(0);
        assertThat(status.skipped()).isEqualTo(0);
        assertThat(status.failed()).isEqualTo(0);
        assertThat(status.attemptNumber()).isEqualTo(1);
        assertThat(status.maxRetries()).isEqualTo(3);
        assertThat(status.failedRows()).isEmpty();
    }

    @Test
    void getJobStatus_afterProcessing_returnsFinalCounts() {
        when(databaseService.isDuplicate(any()))
            .thenReturn(true)
            .thenReturn(false);

        String jobId = service.createJob(List.of(row("1"), row("2")), newToken());
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

        String jobId = service.createJob(List.of(row("1"), row("2")), newToken());
        service.processJob(jobId);

        JobService.JobStatusDto status = service.getJobStatus(jobId);
        assertThat(status.status()).isEqualTo("DONE_WITH_ERRORS");
        assertThat(status.failed()).isEqualTo(1);
        assertThat(status.failedRows()).hasSize(1);
        assertThat(status.failedRows().get(0).codigoEmpleado()).isEqualTo("1");
        assertThat(status.failedRows().get(0).nombreEmpleado()).isEqualTo("Test 1");
        assertThat(status.failedRows().get(0).error()).isEqualTo("Error inesperado al procesar el registro.");
    }

    // ── processJobAsync ─────────────────────────────────────────────────────

    @Test
    void processJobAsync_processesInBackground() throws Exception {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("1")), "token-1");
        Map<String, Object> fakeStore = new ConcurrentHashMap<>();
        fakeStore.put("token-1", new Object());

        service.processJobAsync(jobId, fakeStore);

        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            JobService.JobStatusDto status = service.getJobStatus(jobId);
            assertThat(status.status()).isEqualTo("DONE");
        });
        verify(databaseService).submitRow(any());
    }

    @Test
    void processJobAsync_removesStateOnSuccess() throws Exception {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("1")), "token-1");
        Map<String, Object> fakeStore = new ConcurrentHashMap<>();
        fakeStore.put("token-1", new Object());

        service.processJobAsync(jobId, fakeStore);

        await().atMost(Duration.ofSeconds(2)).untilAsserted(() ->
            assertThat(fakeStore).doesNotContainKey("token-1")
        );
    }

    @Test
    void processJobAsync_setsStatusToDoneWithErrorsOnUnexpectedException() throws Exception {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("unexpected"));

        String jobId = service.createJob(List.of(row("1")), "token-1");
        Map<String, Object> fakeStore = new ConcurrentHashMap<>();
        fakeStore.put("token-1", new Object());

        service.processJobAsync(jobId, fakeStore);

        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            JobService.JobStatusDto status = service.getJobStatus(jobId);
            assertThat(status.status()).isEqualTo("DONE_WITH_ERRORS");
        });
    }

    @Test
    void processJobAsync_preservesStateOnFailure() throws Exception {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("DB error"));

        String jobId = service.createJob(List.of(row("1")), "token-1");
        Map<String, Object> fakeStore = new ConcurrentHashMap<>();
        fakeStore.put("token-1", new Object());

        service.processJobAsync(jobId, fakeStore);

        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            JobService.JobStatusDto status = service.getJobStatus(jobId);
            assertThat(status.status()).isEqualTo("DONE_WITH_ERRORS");
        });
        assertThat(fakeStore).containsKey("token-1");
    }

    // ── createRetryJob ──────────────────────────────────────────────────

    @Test
    void createRetryJob_createsJobWithOnlyFailedRows() {
        when(databaseService.isDuplicate(any()))
            .thenReturn(false)                          // row 1 succeeds
            .thenThrow(new RuntimeException("err"));    // row 2 fails

        String parentId = service.createJob(List.of(row("1"), row("2")), null);
        service.processJob(parentId);

        String retryId = service.createRetryJob(parentId);
        JobService.JobStatusDto status = service.getJobStatus(retryId);

        assertThat(retryId).isNotEqualTo(parentId);
        assertThat(status.totalRows()).isEqualTo(1);
        assertThat(status.attemptNumber()).isEqualTo(2);
        assertThat(status.maxRetries()).isEqualTo(3);
    }

    @Test
    void createRetryJob_rejectsJobNotDoneWithErrors() {
        String jobId = service.createJob(List.of(row("1")), newToken());

        assertThatThrownBy(() -> service.createRetryJob(jobId))
            .isInstanceOf(JobNotRetryableException.class)
            .hasMessageContaining("DONE_WITH_ERRORS");
    }

    @Test
    void createRetryJob_rejectsWhenMaxRetriesReached() {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("err"));

        String id = service.createJob(List.of(row("1")), null);
        service.processJob(id);

        String r2 = service.createRetryJob(id);
        service.processJob(r2);

        String r3 = service.createRetryJob(r2);
        service.processJob(r3);

        String r4 = service.createRetryJob(r3);
        service.processJob(r4);

        assertThatThrownBy(() -> service.createRetryJob(r4))
            .isInstanceOf(MaxRetriesExhaustedException.class)
            .hasMessageContaining("reintentos");
    }

    @Test
    void createRetryJob_rejectsUnknownJobId() {
        assertThatThrownBy(() -> service.createRetryJob("no-such-job"))
            .isInstanceOf(JobNotFoundException.class);
    }

    // ── evictStaleJobs ─────────────────────────────────────────────────────

    @Test
    void evictStaleJobs_removesTerminalJobsOlderThanCutoff() throws Exception {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("1")), newToken());
        service.processJob(jobId);
        assertThat(service.getJobStatus(jobId).status()).isEqualTo("DONE");

        @SuppressWarnings("unchecked")
        Map<String, JobState> jobs = (Map<String, JobState>) ReflectionTestUtils.getField(service, "jobs");
        JobState job = jobs.get(jobId);
        ReflectionTestUtils.setField(job, "createdAt", Instant.now().minusSeconds(700));

        service.evictStaleJobs();

        assertThat(service.getJobStatus(jobId)).isNull();
    }

    @Test
    void evictStaleJobs_keepsRecentTerminalJobs() throws Exception {
        when(databaseService.isDuplicate(any())).thenReturn(false);

        String jobId = service.createJob(List.of(row("1")), newToken());
        service.processJob(jobId);
        assertThat(service.getJobStatus(jobId).status()).isEqualTo("DONE");

        service.evictStaleJobs();

        assertThat(service.getJobStatus(jobId)).isNotNull();
    }

    @Test
    void evictStaleJobs_keepsInProgressJobs() throws Exception {
        String jobId = service.createJob(List.of(row("1")), newToken());
        assertThat(service.getJobStatus(jobId).status()).isEqualTo("PENDING");

        service.evictStaleJobs();

        assertThat(service.getJobStatus(jobId)).isNotNull();
    }

    // ── classifyRowError ─────────────────────────────────────────────────────

    @Test
    void classifyRowError_constraintViolation_returnsConstraintMessage() {
        var ex = new org.springframework.dao.DataIntegrityViolationException("dup key");
        assertThat(JobService.classifyRowError(ex))
            .isEqualTo("Datos duplicados o restricción de integridad violada.");
    }

    @Test
    void classifyRowError_queryTimeout_returnsTimeoutMessage() {
        var ex = new org.springframework.dao.QueryTimeoutException("timeout");
        assertThat(JobService.classifyRowError(ex))
            .isEqualTo("Tiempo de espera agotado al procesar el registro.");
    }

    @Test
    void classifyRowError_sqlStateConstraint_returnsConstraintMessage() {
        var sqlEx = new java.sql.SQLException("constraint", "23505");
        var ex = new RuntimeException(sqlEx);
        assertThat(JobService.classifyRowError(ex))
            .isEqualTo("Datos duplicados o restricción de integridad violada.");
    }

    @Test
    void classifyRowError_sqlStateDataError_returnsDataMessage() {
        var sqlEx = new java.sql.SQLException("invalid input", "22P02");
        var ex = new RuntimeException(sqlEx);
        assertThat(JobService.classifyRowError(ex))
            .isEqualTo("Datos inválidos para el procedimiento.");
    }

    @Test
    void classifyRowError_sqlStateRaiseException_returnsProcMessage() {
        var sqlEx = new java.sql.SQLException("custom error", "P0001");
        var ex = new RuntimeException(sqlEx);
        assertThat(JobService.classifyRowError(ex))
            .isEqualTo("Error en procedimiento almacenado.");
    }

    @Test
    void classifyRowError_unknownException_returnsUnexpectedMessage() {
        var ex = new RuntimeException("something weird");
        assertThat(JobService.classifyRowError(ex))
            .isEqualTo("Error inesperado al procesar el registro.");
    }

    @Test
    void shutdown_doesNotThrow() {
        assertThatCode(() -> service.shutdown()).doesNotThrowAnyException();
    }

    @Test
    void shutdown_forcesShutdownNowWhenDrainTimesOut() throws InterruptedException {
        ExecutorService mockExecutor = mock(ExecutorService.class);
        when(mockExecutor.awaitTermination(anyLong(), any())).thenReturn(false);
        ReflectionTestUtils.setField(service, "asyncExecutor", mockExecutor);

        service.shutdown();

        verify(mockExecutor).shutdown();
        verify(mockExecutor).shutdownNow();
    }

    @Test
    void shutdown_forcesShutdownNowAndReinterruptsWhenInterrupted() throws InterruptedException {
        ExecutorService mockExecutor = mock(ExecutorService.class);
        when(mockExecutor.awaitTermination(anyLong(), any())).thenThrow(new InterruptedException());
        ReflectionTestUtils.setField(service, "asyncExecutor", mockExecutor);

        service.shutdown();

        verify(mockExecutor).shutdownNow();
        assertThat(Thread.interrupted()).isTrue(); // also clears the flag so it doesn't leak to other tests
    }

    // ── per-token claim / release and draft clearing (TASK-88) ──────────────

    private java.util.concurrent.CountDownLatch blockSubmissions() throws Exception {
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        when(databaseService.isDuplicate(any())).thenAnswer(inv -> {
            release.await(5, java.util.concurrent.TimeUnit.SECONDS);
            return false;
        });
        return release;
    }

    @Test
    void createJob_rejectsSecondJobForTheSameTokenWhilePending() {
        service.createJob(List.of(row("1")), "tok");

        assertThatThrownBy(() -> service.createJob(List.of(row("2")), "tok"))
            .isInstanceOf(JobInProgressException.class);
        assertThat(service.isJobActive("tok")).isTrue();
    }

    @Test
    void createJob_allowsJobsForDifferentTokens() {
        service.createJob(List.of(row("1")), "tok-a");
        assertThatCode(() -> service.createJob(List.of(row("1")), "tok-b")).doesNotThrowAnyException();
    }

    @Test
    void createJob_withoutTokenNeverClaims() {
        service.createJob(List.of(row("1")), null);
        service.createJob(List.of(row("1")), null);
        assertThat(service.isJobActive(null)).isFalse();
    }

    @Test
    void jobActive_isTrueWhileRunningAndFalseAfter() throws Exception {
        java.util.concurrent.CountDownLatch release = blockSubmissions();
        String jobId = service.createJob(List.of(row("1")), "tok");
        service.processJobAsync(jobId, new ConcurrentHashMap<String, Object>());

        await().atMost(Duration.ofSeconds(2)).until(() ->
            "IN_PROGRESS".equals(service.getJobStatus(jobId).status()));
        assertThat(service.isJobActive("tok")).isTrue();
        assertThatThrownBy(() -> service.createJob(List.of(row("1")), "tok"))
            .isInstanceOf(JobInProgressException.class);

        release.countDown();
        await().atMost(Duration.ofSeconds(2)).until(() -> !service.isJobActive("tok"));
        assertThat(service.getJobStatus(jobId).status()).isEqualTo("DONE");
    }

    @Test
    void jobThatThrowsInsideItsTaskStillReleasesTheMarker() throws Exception {
        String jobId = service.createJob(List.of(row("1")), "tok");
        Map<String, Object> store = new ConcurrentHashMap<>();
        store.put("tok", new Object());
        doThrow(new RuntimeException("boom")).when(draftService).deleteIfToken("tok");
        when(databaseService.isDuplicate(any())).thenReturn(false);

        service.processJobAsync(jobId, store);

        await().atMost(Duration.ofSeconds(2)).until(() -> !service.isJobActive("tok"));
        assertThat(service.getJobStatus(jobId).status()).isEqualTo("DONE_WITH_ERRORS");
        verify(draftService).markPartialIfToken("tok");
    }

    @Test
    void jobThatCannotBeScheduledReleasesTheMarker() {
        ExecutorService rejecting = mock(ExecutorService.class);
        doThrow(new java.util.concurrent.RejectedExecutionException("shut down"))
            .when(rejecting).execute(any());
        ReflectionTestUtils.setField(service, "asyncExecutor", rejecting);

        String jobId = service.createJob(List.of(row("1")), "tok");
        service.processJobAsync(jobId, new ConcurrentHashMap<String, Object>());

        assertThat(service.isJobActive("tok")).isFalse();
        assertThat(service.getJobStatus(jobId).status()).isEqualTo("DONE_WITH_ERRORS");
    }

    @Test
    void processJobAsync_unknownJobIsIgnored() {
        assertThatCode(() -> service.processJobAsync("nope", new ConcurrentHashMap<String, Object>()))
            .doesNotThrowAnyException();
    }

    @Test
    void staleJobCannotClearANewerJobsMarker() throws Exception {
        java.util.concurrent.CountDownLatch release = blockSubmissions();
        String first = service.createJob(List.of(row("1")), "tok");
        @SuppressWarnings("unchecked")
        Map<String, String> markers = (Map<String, String>) ReflectionTestUtils.getField(service, "activeJobByToken");
        markers.put("tok", "newer-job");

        service.processJobAsync(first, new ConcurrentHashMap<String, Object>());
        release.countDown();
        await().atMost(Duration.ofSeconds(2)).until(() -> "DONE".equals(service.getJobStatus(first).status()));
        Thread.sleep(50);

        assertThat(markers).containsEntry("tok", "newer-job");
    }

    @Test
    void concurrentClaimsForTheSameTokenLetExactlyOneWin() throws Exception {
        int threads = 8;
        ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(threads);
        java.util.concurrent.CountDownLatch start = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicInteger wins = new java.util.concurrent.atomic.AtomicInteger();
        java.util.concurrent.atomic.AtomicInteger conflicts = new java.util.concurrent.atomic.AtomicInteger();
        List<java.util.concurrent.Future<?>> futures = new java.util.ArrayList<>();
        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                start.await();
                try {
                    service.createJob(List.of(row("1")), "tok");
                    wins.incrementAndGet();
                } catch (JobInProgressException e) {
                    conflicts.incrementAndGet();
                }
                return null;
            }));
        }
        start.countDown();
        for (var f : futures) f.get(5, java.util.concurrent.TimeUnit.SECONDS);
        pool.shutdown();

        assertThat(wins.get()).isEqualTo(1);
        assertThat(conflicts.get()).isEqualTo(threads - 1);
    }

    @Test
    void doneDeletesTheDraftBeforeRemovingTheState() throws Exception {
        when(databaseService.isDuplicate(any())).thenReturn(false);
        @SuppressWarnings("unchecked")
        Map<String, Object> store = mock(Map.class);
        String jobId = service.createJob(List.of(row("1")), "tok");

        service.processJobAsync(jobId, store);

        await().atMost(Duration.ofSeconds(2)).until(() -> !service.isJobActive("tok"));
        org.mockito.InOrder order = inOrder(draftService, store);
        order.verify(draftService).deleteIfToken("tok");
        order.verify(store).remove("tok");
        verify(draftService, never()).markPartialIfToken(any());
    }

    @Test
    void doneWithErrorsKeepsStateAndMarksTheDraftPartial() throws Exception {
        when(databaseService.isDuplicate(any())).thenReturn(false);
        doThrow(new RuntimeException("row failed")).when(databaseService).submitRow(any());
        Map<String, Object> store = new ConcurrentHashMap<>();
        store.put("tok", new Object());
        String jobId = service.createJob(List.of(row("1")), "tok");

        service.processJobAsync(jobId, store);

        await().atMost(Duration.ofSeconds(2)).until(() -> !service.isJobActive("tok"));
        assertThat(service.getJobStatus(jobId).status()).isEqualTo("DONE_WITH_ERRORS");
        assertThat(store).containsKey("tok");
        verify(draftService).markPartialIfToken("tok");
        verify(draftService, never()).deleteIfToken(any());
    }

    @Test
    void retryCarriesTheTokenAndCountsAsRunning() throws Exception {
        when(databaseService.isDuplicate(any())).thenThrow(new RuntimeException("err"));
        Map<String, Object> store = new ConcurrentHashMap<>();
        store.put("tok", new Object());
        String parent = service.createJob(List.of(row("1")), "tok");
        service.processJobAsync(parent, store);
        await().atMost(Duration.ofSeconds(2)).until(() -> !service.isJobActive("tok"));

        service.createRetryJob(parent);

        assertThat(service.isJobActive("tok")).isTrue();
        assertThatThrownBy(() -> service.createJob(List.of(row("1")), "tok"))
            .isInstanceOf(JobInProgressException.class);
        assertThatThrownBy(() -> service.createRetryJob(parent))
            .isInstanceOf(JobInProgressException.class);
    }

    @Test
    void retryThatReachesDoneDeletesTheDraftAndRemovesTheState() throws Exception {
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("err"))
            .thenReturn(false);
        Map<String, Object> store = new ConcurrentHashMap<>();
        store.put("tok", new Object());
        String parent = service.createJob(List.of(row("1")), "tok");
        service.processJobAsync(parent, store);
        await().atMost(Duration.ofSeconds(2)).until(() -> !service.isJobActive("tok"));
        assertThat(store).containsKey("tok");

        String retry = service.createRetryJob(parent);
        service.processRetryJobAsync(retry, store);

        await().atMost(Duration.ofSeconds(2)).until(() -> !service.isJobActive("tok"));
        assertThat(service.getJobStatus(retry).status()).isEqualTo("DONE");
        assertThat(store).doesNotContainKey("tok");
        verify(draftService).deleteIfToken("tok");
    }
}
