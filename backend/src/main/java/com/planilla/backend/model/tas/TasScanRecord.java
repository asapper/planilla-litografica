package com.planilla.backend.model.tas;

import java.time.LocalDateTime;

public class TasScanRecord {

    private String employeeId;
    private String employeeName;
    private LocalDateTime timestamp;

    public TasScanRecord() {}

    public String getEmployeeId() { return employeeId; }
    public void setEmployeeId(String employeeId) { this.employeeId = employeeId; }

    public String getEmployeeName() { return employeeName; }
    public void setEmployeeName(String employeeName) { this.employeeName = employeeName; }

    public LocalDateTime getTimestamp() { return timestamp; }
    public void setTimestamp(LocalDateTime timestamp) { this.timestamp = timestamp; }
}
