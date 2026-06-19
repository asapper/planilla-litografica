package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

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
    private final Executor asyncExecutor = Executors.newCachedThreadPool();

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
                    rowState.error = "Error al procesar el registro.";
                    if (firstError == null) firstError = "Error al procesar el registro.";
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

    public <T> void processJobAsync(String jobId, String uploadToken, Map<String, T> stateStore) {
        CompletableFuture.runAsync(() -> {
            processJob(jobId);
            JobState job = jobs.get(jobId);
            if (job != null && "DONE".equals(job.status.get())) {
                stateStore.remove(uploadToken);
            }
        }, asyncExecutor);
    }

    public record JobStatusDto(
        String jobId,
        String status,
        int totalRows,
        int submitted,
        int skipped,
        int failed,
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
            failedRows
        );
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
