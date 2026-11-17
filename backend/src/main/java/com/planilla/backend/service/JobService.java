package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.service.tas.TasDraftService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@Service
public class JobService {

    private static final Logger log = LoggerFactory.getLogger(JobService.class);

    private final DatabaseService databaseService;
    private final TasDraftService draftService;

    @Value("${job.max-retries:3}")
    private int maxRetries;

    private final Map<String, JobState> jobs = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> activeJobByToken = new ConcurrentHashMap<>();
    private ExecutorService asyncExecutor = Executors.newFixedThreadPool(4);

    public JobService(DatabaseService databaseService, TasDraftService draftService) {
        this.databaseService = databaseService;
        this.draftService = draftService;
    }

    public String createJob(List<EmployeeRow> rows, String uploadToken) {
        String jobId = UUID.randomUUID().toString();
        claim(uploadToken, jobId);
        List<JobRowState> rowStates = rows.stream().map(JobRowState::new).collect(Collectors.toList());
        jobs.put(jobId, new JobState(jobId, 1, maxRetries, rowStates, uploadToken));
        return jobId;
    }

    public boolean isAnyJobActive() {
        return !activeJobByToken.isEmpty();
    }

    public boolean isJobActive(String uploadToken) {
        return uploadToken != null && activeJobByToken.containsKey(uploadToken);
    }

    // Single-user app: two concurrent jobs, even for different upload tokens (a reload, then a
    // re-upload of the same CSV), could load the same payroll rows into PostgreSQL twice.
    private void claim(String uploadToken, String jobId) {
        if (uploadToken == null) return;
        synchronized (activeJobByToken) {
            if (!activeJobByToken.isEmpty()) {
                throw new JobInProgressException();
            }
            activeJobByToken.put(uploadToken, jobId);
        }
    }

    private void release(String uploadToken, String jobId) {
        if (uploadToken != null) {
            activeJobByToken.remove(uploadToken, jobId);
        }
    }

    public record JobResult(int submitted, int skipped, int failed, String error) {
        public boolean hasFailures() { return failed > 0; }
    }

    public JobResult processJob(String jobId) {
        JobState job = jobs.get(jobId);
        if (job == null) return new JobResult(0, 0, 0, null);
        JobResult result = submitRows(job);
        job.status.set(terminalStatus(job));
        return result;
    }

    private static String terminalStatus(JobState job) {
        return job.failed() > 0 ? "DONE_WITH_ERRORS" : "DONE";
    }

    private JobResult submitRows(JobState job) {
        String jobId = job.jobId;
        job.status.set("IN_PROGRESS");
        log.info("Job {} started — {} rows, attempt {}/{}", jobId, job.totalRows(), job.attemptNumber, job.maxRetries);

        boolean dbUnreachable = false;
        String firstError = null;

        for (JobRowState rowState : job.rows) {
            if (dbUnreachable) {
                rowState.error = "Base de datos remota no disponible.";
                rowState.setStatus("FAILED");
                continue;
            }

            try {
                if (databaseService.isDuplicate(rowState.row)) {
                    rowState.setStatus("SKIPPED");
                    log.info("Job {} — fila duplicada omitida: {}", jobId, rowState.row.getCodigoEmpleado());
                } else {
                    databaseService.submitRow(rowState.row);
                    rowState.setStatus("SUBMITTED");
                    log.info("Job {} — fila enviada: {}", jobId, rowState.row.getCodigoEmpleado());
                }
            } catch (Exception e) {
                if (isConnectionError(e)) {
                    dbUnreachable = true;
                    rowState.error = "Base de datos remota no disponible.";
                    if (firstError == null) firstError = "Base de datos remota no disponible.";
                    log.warn("Job {} — PostgreSQL no disponible, se omiten las filas restantes: {}", jobId, e.getMessage());
                } else {
                    rowState.error = classifyRowError(e);
                    if (firstError == null) firstError = rowState.error;
                    log.error("Job {} — error en fila {}: {}", jobId, rowState.row.getCodigoEmpleado(), e.getMessage());
                }
                rowState.setStatus("FAILED");
            }
        }

        log.info("Job {} finished — status={} submitted={} skipped={} failed={}",
            jobId, terminalStatus(job), job.submitted(), job.skipped(), job.failed());

        return new JobResult(job.submitted(), job.skipped(), job.failed(), firstError);
    }

    public void processJobAsync(String jobId, Map<String, ?> stateStore) {
        runJobAsync(jobId, stateStore);
    }

    private void finishForToken(JobState job, String status, Map<String, ?> stateStore) {
        String token = job.uploadToken;
        if (token == null) return;
        if ("DONE".equals(status)) {
            clearFinishedSession(token, stateStore);
        } else if (job.submitted() > 0 || job.skipped() > 0) {
            draftService.markPartialIfToken(token);
        }
    }

    /**
     * Draft first, then the state, both under the state's lock: a draft PUT re-checks the state's
     * identity under the same lock, so one landing in between gets 409 instead of rewriting the draft
     * of a fully submitted session. With no state in memory, the delete runs inside compute so it is
     * atomic with a concurrent rehydrate of the same token.
     */
    private <V> void clearFinishedSession(String token, Map<String, V> stateStore) {
        V state = stateStore.compute(token, (k, v) -> {
            if (v == null) draftService.deleteIfToken(k);
            return v;
        });
        if (state == null) return;
        synchronized (state) {
            draftService.deleteIfToken(token);
            stateStore.remove(token, state);
        }
    }

    @Scheduled(fixedRate = 300_000)
    void evictStaleJobs() {
        Instant cutoff = Instant.now().minusSeconds(600);
        jobs.entrySet().removeIf(e -> {
            JobState job = e.getValue();
            String status = job.status.get();
            return ("DONE".equals(status) || "DONE_WITH_ERRORS".equals(status))
                && job.createdAt.isBefore(cutoff);
        });
    }

    public record JobStatusDto(
        String jobId,
        String status,
        int totalRows,
        int submitted,
        int skipped,
        int failed,
        int attemptNumber,
        int maxRetries,
        List<FailedRowDto> failedRows
    ) {}

    public record FailedRowDto(
        String codigoEmpleado,
        String nombreEmpleado,
        String error
    ) {}

    public JobStatusDto getJobStatus(String jobId) {
        JobState job = jobs.get(jobId);
        if (job == null) return null;

        List<FailedRowDto> failedRows = job.rows.stream()
            .filter(r -> r.getStatus().equals("FAILED"))
            .map(r -> new FailedRowDto(
                r.row.getCodigoEmpleado(),
                r.row.getNombreEmpleado(),
                r.error != null ? r.error : "Error desconocido"))
            .collect(Collectors.toList());

        return new JobStatusDto(
            job.jobId,
            job.status.get(),
            job.totalRows(),
            job.submitted(),
            job.skipped(),
            job.failed(),
            job.attemptNumber,
            job.maxRetries,
            failedRows
        );
    }

    public String createRetryJob(String parentJobId) {
        JobState parent = jobs.get(parentJobId);
        if (parent == null) {
            throw new JobNotFoundException(parentJobId);
        }
        if (!"DONE_WITH_ERRORS".equals(parent.status.get())) {
            throw new JobNotRetryableException();
        }
        if (parent.attemptNumber > parent.maxRetries) {
            throw new MaxRetriesExhaustedException();
        }

        List<JobRowState> failedRows = parent.rows.stream()
            .filter(r -> r.getStatus().equals("FAILED"))
            .map(r -> new JobRowState(r.row))
            .collect(Collectors.toList());

        String retryId = UUID.randomUUID().toString();
        claim(parent.uploadToken, retryId);
        jobs.put(retryId, new JobState(retryId, parent.attemptNumber + 1, parent.maxRetries, failedRows,
                parent.uploadToken));
        return retryId;
    }

    public void processRetryJobAsync(String jobId, Map<String, ?> stateStore) {
        runJobAsync(jobId, stateStore);
    }

    @PreDestroy
    public void shutdown() {
        asyncExecutor.shutdown();
        try {
            if (!asyncExecutor.awaitTermination(30, TimeUnit.SECONDS)) {
                asyncExecutor.shutdownNow();
            }
        } catch (InterruptedException e) {
            asyncExecutor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    private void runJobAsync(String jobId, Map<String, ?> stateStore) {
        JobState job = jobs.get(jobId);
        if (job == null) return;
        try {
            CompletableFuture.runAsync(() -> runJob(job, stateStore), asyncExecutor);
        } catch (RuntimeException e) {
            log.error("Job {} could not be scheduled: {}", jobId, e.getMessage(), e);
            job.status.set("DONE_WITH_ERRORS");
            release(job.uploadToken, jobId);
        }
    }

    // The terminal status is published last: whoever sees it (the polling screen, Reintentar) must
    // find the draft already settled and the marker already released.
    private void runJob(JobState job, Map<String, ?> stateStore) {
        String status = "DONE_WITH_ERRORS";
        try {
            submitRows(job);
            status = terminalStatus(job);
            finishForToken(job, status, stateStore);
        } catch (RuntimeException e) {
            log.error("Job {} failed unexpectedly: {}", job.jobId, e.getMessage(), e);
            status = "DONE_WITH_ERRORS";
            try {
                finishForToken(job, status, stateStore);
            } catch (RuntimeException again) {
                log.error("Job {} could not settle its session: {}", job.jobId, again.getMessage(), again);
            }
        } finally {
            // A leaked marker would lock the user out of the session with "Envío en curso" forever.
            release(job.uploadToken, job.jobId);
            job.status.set(status);
        }
    }

    static String classifyRowError(Exception e) {
        Throwable t = e;
        while (t != null) {
            if (t instanceof org.springframework.dao.DataIntegrityViolationException) {
                return "Datos duplicados o restricción de integridad violada.";
            }
            if (t instanceof org.springframework.dao.QueryTimeoutException) {
                return "Tiempo de espera agotado al procesar el registro.";
            }
            if (t instanceof java.sql.SQLException sqlEx) {
                String state = sqlEx.getSQLState();
                if (state != null) {
                    if (state.startsWith("23")) {
                        return "Datos duplicados o restricción de integridad violada.";
                    }
                    if (state.startsWith("22")) {
                        log.warn("Data error (SQLState {}): {}", state, sqlEx.getMessage());
                        return "Datos inválidos para el procedimiento.";
                    }
                    if ("P0001".equals(state)) {
                        log.warn("Stored procedure error (P0001): {}", sqlEx.getMessage());
                        return "Error en procedimiento almacenado.";
                    }
                }
            }
            t = t.getCause();
        }
        return "Error inesperado al procesar el registro.";
    }

    static boolean isConnectionError(Exception e) {
        Throwable t = e;
        while (t != null) {
            String name = t.getClass().getName();
            if (t instanceof java.net.ConnectException
                    || t instanceof java.net.NoRouteToHostException
                    || t instanceof java.net.SocketTimeoutException
                    || name.contains("SQLTransientConnectionException")
                    || name.contains("CommunicationsException")) {
                return true;
            }
            t = t.getCause();
        }
        return false;
    }
}
