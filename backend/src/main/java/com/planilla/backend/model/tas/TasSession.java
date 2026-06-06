package com.planilla.backend.model.tas;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public class TasSession {

    private String employeeId;
    private LocalDate date;
    private String matchedShiftId;
    private List<LocalDateTime> scans;
    private boolean crossMidnight;
    private LocalDateTime effectiveStart;
    private LocalDateTime lastScan;
    private int workedMinutes;
    private double workedHours;
    private boolean needsResolution;
    private String sessionAnchor;
    private List<TasFlag> flags;

    public TasSession() {}

    public String getEmployeeId() { return employeeId; }
    public void setEmployeeId(String employeeId) { this.employeeId = employeeId; }

    public LocalDate getDate() { return date; }
    public void setDate(LocalDate date) { this.date = date; }

    public String getMatchedShiftId() { return matchedShiftId; }
    public void setMatchedShiftId(String matchedShiftId) { this.matchedShiftId = matchedShiftId; }

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

    public boolean isNeedsResolution() { return needsResolution; }
    public void setNeedsResolution(boolean needsResolution) { this.needsResolution = needsResolution; }

    public String getSessionAnchor() { return sessionAnchor; }
    public void setSessionAnchor(String sessionAnchor) { this.sessionAnchor = sessionAnchor; }

    public List<TasFlag> getFlags() { return flags; }
    public void setFlags(List<TasFlag> flags) { this.flags = flags; }
}
