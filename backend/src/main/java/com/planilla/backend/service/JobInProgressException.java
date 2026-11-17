package com.planilla.backend.service;

public class JobInProgressException extends RuntimeException {
    public JobInProgressException() {
        super("Ya hay un envío en curso. Espere a que termine.");
    }
}
