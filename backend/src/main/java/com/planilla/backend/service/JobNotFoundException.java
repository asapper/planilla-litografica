package com.planilla.backend.service;

public class JobNotFoundException extends RuntimeException {
    public JobNotFoundException(String jobId) {
        super("Job no encontrado: " + jobId);
    }
}
