package com.planilla.backend.service;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

class JobState {

    final String jobId;
    final int attemptNumber;
    final int maxRetries;
    final List<JobRowState> rows;
    final AtomicReference<String> status = new AtomicReference<>("PENDING");

    JobState(String jobId, int attemptNumber, int maxRetries, List<JobRowState> rows) {
        this.jobId = jobId;
        this.attemptNumber = attemptNumber;
        this.maxRetries = maxRetries;
        this.rows = rows;
    }

    int totalRows()  { return rows.size(); }
    int submitted()  { return (int) rows.stream().filter(r -> r.getStatus().equals("SUBMITTED")).count(); }
    int skipped()    { return (int) rows.stream().filter(r -> r.getStatus().equals("SKIPPED")).count(); }
    int failed()     { return (int) rows.stream().filter(r -> r.getStatus().equals("FAILED")).count(); }
}
