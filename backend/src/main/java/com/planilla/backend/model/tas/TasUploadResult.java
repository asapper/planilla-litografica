package com.planilla.backend.model.tas;

import com.planilla.backend.model.EmployeeRow;

import java.util.List;

public class TasUploadResult {

    private List<EmployeeRow> resolvedRows;
    private List<TasSession> flaggedSessions;
    private List<String> warnings;
    private boolean usedFallbackHolidays;
    private List<TasInactiveEmployee> inactiveEmployeesFound;
    private List<TasAbsentEmployee> absentActiveEmployees;

    public TasUploadResult() {}

    public List<EmployeeRow> getResolvedRows() { return resolvedRows; }
    public void setResolvedRows(List<EmployeeRow> resolvedRows) { this.resolvedRows = resolvedRows; }

    public List<TasSession> getFlaggedSessions() { return flaggedSessions; }
    public void setFlaggedSessions(List<TasSession> flaggedSessions) { this.flaggedSessions = flaggedSessions; }

    public List<String> getWarnings() { return warnings; }
    public void setWarnings(List<String> warnings) { this.warnings = warnings; }

    public boolean isUsedFallbackHolidays() { return usedFallbackHolidays; }
    public void setUsedFallbackHolidays(boolean usedFallbackHolidays) { this.usedFallbackHolidays = usedFallbackHolidays; }

    public List<TasInactiveEmployee> getInactiveEmployeesFound() { return inactiveEmployeesFound; }
    public void setInactiveEmployeesFound(List<TasInactiveEmployee> inactiveEmployeesFound) { this.inactiveEmployeesFound = inactiveEmployeesFound; }

    public List<TasAbsentEmployee> getAbsentActiveEmployees() { return absentActiveEmployees; }
    public void setAbsentActiveEmployees(List<TasAbsentEmployee> absentActiveEmployees) { this.absentActiveEmployees = absentActiveEmployees; }
}
