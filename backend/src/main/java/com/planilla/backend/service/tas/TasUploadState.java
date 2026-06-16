package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasAbsentEmployee;
import com.planilla.backend.model.tas.TasPeriod;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

public class TasUploadState {

    private String uploadToken;
    private List<TasScanRecord> allScans;
    private List<TasSession> sessions;
    private List<EmployeeRow> resolvedRows;
    private boolean usedFallbackHolidays;
    private List<TasAbsentEmployee> absentEmployees;
    private Set<String> ignoredEmployeeIds;
    private LocalDate reportStart;
    private LocalDate reportEnd;
    private TasPeriod resolvedPeriod;

    public TasUploadState() {}

    public String getUploadToken() { return uploadToken; }
    public void setUploadToken(String uploadToken) { this.uploadToken = uploadToken; }

    public List<TasScanRecord> getAllScans() { return allScans; }
    public void setAllScans(List<TasScanRecord> allScans) { this.allScans = allScans; }

    public List<TasSession> getSessions() { return sessions; }
    public void setSessions(List<TasSession> sessions) { this.sessions = sessions; }

    public List<EmployeeRow> getResolvedRows() { return resolvedRows; }
    public void setResolvedRows(List<EmployeeRow> resolvedRows) { this.resolvedRows = resolvedRows; }

    public boolean isUsedFallbackHolidays() { return usedFallbackHolidays; }
    public void setUsedFallbackHolidays(boolean usedFallbackHolidays) { this.usedFallbackHolidays = usedFallbackHolidays; }

    public List<TasAbsentEmployee> getAbsentEmployees() { return absentEmployees; }
    public void setAbsentEmployees(List<TasAbsentEmployee> absentEmployees) { this.absentEmployees = absentEmployees; }

    public Set<String> getIgnoredEmployeeIds() { return ignoredEmployeeIds; }
    public void setIgnoredEmployeeIds(Set<String> ignoredEmployeeIds) { this.ignoredEmployeeIds = ignoredEmployeeIds; }

    public LocalDate getReportStart() { return reportStart; }
    public void setReportStart(LocalDate reportStart) { this.reportStart = reportStart; }

    public LocalDate getReportEnd() { return reportEnd; }
    public void setReportEnd(LocalDate reportEnd) { this.reportEnd = reportEnd; }

    public TasPeriod getResolvedPeriod() { return resolvedPeriod; }
    public void setResolvedPeriod(TasPeriod resolvedPeriod) { this.resolvedPeriod = resolvedPeriod; }
}
