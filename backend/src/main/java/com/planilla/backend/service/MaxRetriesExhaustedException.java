package com.planilla.backend.service;

public class MaxRetriesExhaustedException extends RuntimeException {
    public MaxRetriesExhaustedException() {
        super("Se alcanzó el máximo de reintentos");
    }
}
