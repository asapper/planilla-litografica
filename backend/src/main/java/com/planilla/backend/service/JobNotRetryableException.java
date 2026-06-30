package com.planilla.backend.service;

public class JobNotRetryableException extends RuntimeException {
    public JobNotRetryableException() {
        super("Solo se puede reintentar un job con estado DONE_WITH_ERRORS");
    }
}
