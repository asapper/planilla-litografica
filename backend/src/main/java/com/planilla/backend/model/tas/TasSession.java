package com.planilla.backend.model.tas;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public class TasSession {

    private int sessionId;
    private String employeeId;
    private String employeeName;
    private LocalDate date;
    private String matchedShiftId;
    private String matchedShiftName;
    private String assignedShiftId;
    private String assignedShiftName;
    private List<LocalDateTime> scans;
    private boolean crossMidnight;
    private LocalDateTime effectiveStart;
    private LocalDateTime lastScan;
    private int workedMinutes;
    private double workedHours;
    private int simplesMinutes;
    private int doblesMinutes;
    private boolean needsResolution;
    private String sessionAnchor;
    private List<TasFlag> flags;

    public TasSession() {}

    public int getSessionId() { return sessionId; }
    public void setSessionId(int sessionId) { this.sessionId = sessionId; }

    public String getEmployeeId() { return employeeId; }
    public void setEmployeeId(String employeeId) { this.employeeId = employeeId; }

    public String getEmployeeName() { return employeeName; }
    public void setEmployeeName(String employeeName) { this.employeeName = employeeName; }

    public LocalDate getDate() { return date; }
    public void setDate(LocalDate date) { this.date = date; }

    public String getMatchedShiftId() { return matchedShiftId; }
    public void setMatchedShiftId(String matchedShiftId) { this.matchedShiftId = matchedShiftId; }

    public String getMatchedShiftName() { return matchedShiftName; }
    public void setMatchedShiftName(String matchedShiftName) { this.matchedShiftName = matchedShiftName; }

    public String getAssignedShiftId() { return assignedShiftId; }
    public void setAssignedShiftId(String assignedShiftId) { this.assignedShiftId = assignedShiftId; }

    public String getAssignedShiftName() { return assignedShiftName; }
    public void setAssignedShiftName(String assignedShiftName) { this.assignedShiftName = assignedShiftName; }

    public List<LocalDateTime> getScans() { return scans; }
    public void setScans(List<LocalDateTime> scans) { this.scans = scans; }

    public boolean isCrossMidnight() { return crossMidnight; }
    public void setCrossMidnight(boolean crossMidnight) { this.crossMidnight = crossMidnight; }

    public LocalDateTime getEffectiveStart() { return effectiveStart; }
    public void setEffectiveStart(LocalDateTime effectiveStart) { this.effectiveStart = effectiveStart; }

    public LocalDateTime getLastScan() { return lastScan; }
    public void setLastScan(LocalDateTime lastScan) { this.lastScan = lastScan; }

    public int getWorkedMinutes() { return workedMinutes; }
    public void setWorkedMinutes(int workedMinutes) { this.workedMinutes = workedMinutes; }

    public double getWorkedHours() { return workedHours; }
    public void setWorkedHours(double workedHours) { this.workedHours = workedHours; }

    public int getSimplesMinutes() { return simplesMinutes; }
    public void setSimplesMinutes(int simplesMinutes) { this.simplesMinutes = simplesMinutes; }

    public int getDoblesMinutes() { return doblesMinutes; }
    public void setDoblesMinutes(int doblesMinutes) { this.doblesMinutes = doblesMinutes; }

    public boolean isNeedsResolution() { return needsResolution; }
    public void setNeedsResolution(boolean needsResolution) { this.needsResolution = needsResolution; }

    public String getSessionAnchor() { return sessionAnchor; }
    public void setSessionAnchor(String sessionAnchor) { this.sessionAnchor = sessionAnchor; }

    public List<TasFlag> getFlags() { return flags; }
    public void setFlags(List<TasFlag> flags) { this.flags = flags; }
}
