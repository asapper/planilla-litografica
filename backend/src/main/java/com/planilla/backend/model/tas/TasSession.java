package com.planilla.backend.model.tas;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
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
    private boolean assignedShiftCrossMidnight;
    private LocalDateTime effectiveStart;
    private LocalDateTime lastScan;
    private int workedMinutes;
    private double workedHours;
    private int simplesMinutes;
    private int doblesMinutes;
    private int breakDeductionMinutes;
    private boolean needsResolution;
    private boolean discarded;
    private String sessionAnchor;
    private List<TasFlag> flags;

    public TasSession() {}

    /** Sessions the verification screen lists: blocking ones, and short days she may correct. */
    public static boolean shownForVerification(TasSession s) {
        return s.needsResolution || (s.flags != null && s.flags.contains(TasFlag.SHORT_DAY));
    }

    /**
     * A day with a single scan the clerk may leave as it is: the day counts as worked and adds no
     * overtime, so a shift mismatch on it changes nothing. Not for a night worker's (or, with no shift
     * assigned, a night-matched) morning scan: it may be the exit of the night before and sit on the
     * wrong date. Their evening scan starts its own night and is dated right. Nor for a night flagged
     * at the file's edges.
     */
    public boolean isIncomplete() {
        boolean night = assignedShiftCrossMidnight || (assignedShiftId == null && crossMidnight);
        boolean mayEndThePreviousNight = night && scans != null && !scans.isEmpty()
                && scans.get(0).toLocalTime().isBefore(LocalTime.NOON);
        return needsResolution && scans != null && scans.size() == 1 && flags != null && !mayEndThePreviousNight
                && (flags.contains(TasFlag.MISSING_ENTRY) || flags.contains(TasFlag.MISSING_EXIT))
                && !flags.contains(TasFlag.START_CUTOFF) && !flags.contains(TasFlag.END_CUTOFF);
    }

    /** Sending must wait for this session: still unresolved, and neither an incomplete day nor an undecided double. */
    public static boolean blocksSubmit(TasSession s) {
        return s.needsResolution && (!s.isIncomplete() || s.flags.contains(TasFlag.SAME_DAY_DOUBLE));
    }

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

    public boolean isAssignedShiftCrossMidnight() { return assignedShiftCrossMidnight; }
    public void setAssignedShiftCrossMidnight(boolean assignedShiftCrossMidnight) { this.assignedShiftCrossMidnight = assignedShiftCrossMidnight; }

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

    public int getBreakDeductionMinutes() { return breakDeductionMinutes; }
    public void setBreakDeductionMinutes(int breakDeductionMinutes) { this.breakDeductionMinutes = breakDeductionMinutes; }

    public boolean isNeedsResolution() { return needsResolution; }
    public boolean isDiscarded() { return discarded; }
    public void setDiscarded(boolean discarded) { this.discarded = discarded; }
    public void setNeedsResolution(boolean needsResolution) { this.needsResolution = needsResolution; }

    public String getSessionAnchor() { return sessionAnchor; }
    public void setSessionAnchor(String sessionAnchor) { this.sessionAnchor = sessionAnchor; }

    public List<TasFlag> getFlags() { return flags; }
    public void setFlags(List<TasFlag> flags) { this.flags = flags; }
}
