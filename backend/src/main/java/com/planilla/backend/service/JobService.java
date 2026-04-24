package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class JobService {

    private static final Logger log = LoggerFactory.getLogger(JobService.class);

    private final DatabaseService databaseService;

    @Value("${job.max-retries:3}")
    private int maxRetries;

    private final Map<String, JobState> jobs = new ConcurrentHashMap<>();

    public JobService(DatabaseService databaseService) {
        this.databaseService = databaseService;
    }

    public String createJob(List<EmployeeRow> rows) {
        String jobId = UUID.randomUUID().toString();
        List<JobRowState> rowStates = rows.stream().map(JobRowState::new).collect(Collectors.toList());
        jobs.put(jobId, new JobState(jobId, null, 1, maxRetries, rowStates));
        return jobId;
    }

    @Async("jobExecutor")
    public void processJob(String jobId) {
        JobState job = jobs.get(jobId);
        if (job == null) return;

        job.status.set("IN_PROGRESS");
        log.info("Job {} started — {} rows, attempt {}/{}", jobId, job.totalRows(), job.attemptNumber, job.maxRetries);

        boolean dbUnreachable = false;

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
                    log.warn("Job {} — PostgreSQL no disponible, se omiten las filas restantes: {}", jobId, e.getMessage());
                } else {
                    rowState.error = "Error al procesar el registro.";
                    log.error("Job {} — error en fila {}: {}", jobId, rowState.row.getCodigoEmpleado(), e.getMessage());
                }
                rowState.setStatus("FAILED");
            }
        }

        String finalStatus = job.failed() > 0 ? "DONE_WITH_ERRORS" : "DONE";
        job.status.set(finalStatus);
        log.info("Job {} finished — status={} submitted={} skipped={} failed={}",
            jobId, finalStatus, job.submitted(), job.skipped(), job.failed());
    }

    public Optional<Map<String, Object>> getJobResponse(String jobId) {
        JobState job = jobs.get(jobId);
        if (job == null) return Optional.empty();
        return Optional.of(buildResponse(job));
    }

    public String retryJob(String jobId) {
        JobState original = jobs.get(jobId);
        if (original == null) throw new NoSuchElementException("Job not found: " + jobId);

        String currentStatus = original.status.get();
        if (!currentStatus.equals("DONE_WITH_ERRORS")) {
            throw new IllegalStateException("Job is not in a retryable state: " + currentStatus);
        }
        if (original.attemptNumber >= original.maxRetries) {
            throw new IllegalStateException("Max retries reached");
        }

        List<EmployeeRow> failedRows = original.rows.stream()
            .filter(r -> r.getStatus().equals("FAILED"))
            .map(r -> r.row)
            .collect(Collectors.toList());

        if (failedRows.isEmpty()) throw new IllegalStateException("No failed rows to retry");

        String newJobId = UUID.randomUUID().toString();
        List<JobRowState> rowStates = failedRows.stream().map(JobRowState::new).collect(Collectors.toList());
        jobs.put(newJobId, new JobState(newJobId, jobId, original.attemptNumber + 1, original.maxRetries, rowStates));
        return newJobId;
    }

    private Map<String, Object> buildResponse(JobState job) {
        List<Map<String, Object>> rowList = job.rows.stream().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("codigoEmpleado", r.row.getCodigoEmpleado());
            m.put("nombreEmpleado", r.row.getNombreEmpleado());
            m.put("status", r.getStatus());
            if (r.error != null) m.put("error", r.error);
            return m;
        }).collect(Collectors.toList());

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("jobId", job.jobId);
        resp.put("status", job.status.get());
        resp.put("attemptNumber", job.attemptNumber);
        resp.put("maxRetries", job.maxRetries);
        resp.put("parentJobId", job.parentJobId);
        resp.put("totalRows", job.totalRows());
        resp.put("processed", job.processed());
        resp.put("submitted", job.submitted());
        resp.put("skipped", job.skipped());
        resp.put("failed", job.failed());
        resp.put("rows", rowList);
        return resp;
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
