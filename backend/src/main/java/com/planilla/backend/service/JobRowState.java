package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import java.util.concurrent.atomic.AtomicReference;

class JobRowState {

    final EmployeeRow row;
    private final AtomicReference<String> status = new AtomicReference<>("PENDING");
    volatile String error;

    JobRowState(EmployeeRow row) {
        this.row = row;
    }

    String getStatus() { return status.get(); }
    void setStatus(String s) { status.set(s); }
}
