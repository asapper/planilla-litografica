package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

@Service
public class JobService {

    private static final Logger log = LoggerFactory.getLogger(JobService.class);

    private final DatabaseService databaseService;

    @Value("${job.max-retries:3}")
    private int maxRetries;

    private final Map<String, JobState> jobs = new ConcurrentHashMap<>();
    private final Executor asyncExecutor = Executors.newFixedThreadPool(4);

    public JobService(DatabaseService databaseService) {
        this.databaseService = databaseService;
    }

    public String createJob(List<EmployeeRow> rows) {
        String jobId = UUID.randomUUID().toString();
        List<JobRowState> rowStates = rows.stream().map(JobRowState::new).collect(Collectors.toList());
        jobs.put(jobId, new JobState(jobId, 1, maxRetries, rowStates));
        return jobId;
    }

    public record JobResult(int submitted, int skipped, int failed, String error) {
        public boolean hasFailures() { return failed > 0; }
    }

    public JobResult processJob(String jobId) {
        JobState job = jobs.get(jobId);
        if (job == null) return new JobResult(0, 0, 0, null);

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

        String finalStatus = job.failed() > 0 ? "DONE_WITH_ERRORS" : "DONE";
        job.status.set(finalStatus);
        log.info("Job {} finished — status={} submitted={} skipped={} failed={}",
            jobId, finalStatus, job.submitted(), job.skipped(), job.failed());

        return new JobResult(job.submitted(), job.skipped(), job.failed(), firstError);
    }

    public void processJobAsync(String jobId, String uploadToken, Map<String, ?> stateStore) {
        runJobAsync(jobId, () -> {
            processJob(jobId);
            JobState job = jobs.get(jobId);
            if (job != null && "DONE".equals(job.status.get())) {
                stateStore.remove(uploadToken);
            }
        });
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
        jobs.put(retryId, new JobState(retryId, parent.attemptNumber + 1, parent.maxRetries, failedRows));
        return retryId;
    }

    public void processRetryJobAsync(String jobId) {
        runJobAsync(jobId, () -> processJob(jobId));
    }

    private void runJobAsync(String jobId, Runnable task) {
        CompletableFuture.runAsync(task, asyncExecutor).exceptionally(ex -> {
            log.error("Job {} failed unexpectedly: {}", jobId, ex.getMessage(), ex);
            JobState job = jobs.get(jobId);
            if (job != null) {
                job.status.set("DONE_WITH_ERRORS");
            }
            return null;
        });
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
