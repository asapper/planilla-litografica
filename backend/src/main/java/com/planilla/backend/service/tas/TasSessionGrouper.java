package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class TasSessionGrouper {

    private static final int DEDUP_WINDOW_MINUTES    = 5;
    private static final int DETECTION_BEFORE_MINUTES = 60;
    private static final int DETECTION_AFTER_MINUTES  = 10;
    private static final int AMBIGUOUS_MAX_SPAN_MINUTES = 720;

    public List<TasSession> group(
            List<TasScanRecord> scans,
            List<Map<String, Object>> shifts,
            Map<String, String> employeeShiftAssignments) {

        List<TasScanRecord> deduped = deduplicate(scans);

        Map<String, List<TasScanRecord>> byEmployee = new LinkedHashMap<>();
        for (TasScanRecord scan : deduped) {
            byEmployee.computeIfAbsent(scan.getEmployeeId(), k -> new ArrayList<>()).add(scan);
        }

        List<TasSession> allSessions = new ArrayList<>();
        int sessionCounter = 0;

        for (Map.Entry<String, List<TasScanRecord>> entry : byEmployee.entrySet()) {
            String employeeId = entry.getKey();
            List<TasScanRecord> empScans = entry.getValue();

            String assignedShiftId = employeeShiftAssignments.get(employeeId);
            Map<String, Object> assignedShift = findShiftById(shifts, assignedShiftId);
            boolean isCrossMidnight = assignedShift != null && Boolean.TRUE.equals(assignedShift.get("crossMidnight"));

            List<TasSession> empSessions = groupEmployeeSessions(
                    employeeId, empScans, shifts, assignedShift, isCrossMidnight);

            for (TasSession s : empSessions) {
                s.setSessionId(sessionCounter++);
            }

            detectSameDayDouble(empSessions);
            allSessions.addAll(empSessions);
        }

        return allSessions;
    }

    private List<TasScanRecord> deduplicate(List<TasScanRecord> scans) {
        List<TasScanRecord> result = new ArrayList<>();
        Map<String, LocalDateTime> lastKept = new HashMap<>();

        for (TasScanRecord scan : scans) {
            String id = scan.getEmployeeId();
            LocalDateTime prev = lastKept.get(id);
            if (prev == null || scan.getTimestamp().isAfter(prev.plusMinutes(DEDUP_WINDOW_MINUTES))) {
                result.add(scan);
                lastKept.put(id, scan.getTimestamp());
            }
        }
        return result;
    }

    private List<TasSession> groupEmployeeSessions(
            String employeeId,
            List<TasScanRecord> scans,
            List<Map<String, Object>> shifts,
            Map<String, Object> assignedShift,
            boolean isCrossMidnight) {

        List<TasSession> sessions = new ArrayList<>();
        TasSession currentSession = null;

        for (TasScanRecord scan : scans) {
            if (currentSession == null) {
                Map<String, Object> openerShift = findOpenerShift(scan.getTimestamp(), shifts, assignedShift, isCrossMidnight);
                currentSession = openerShift != null
                        ? openSession(employeeId, scan, openerShift, assignedShift, isCrossMidnight)
                        : openAmbiguousSession(employeeId, scan);
            } else {
                if (isNextShiftExitScan(scan.getTimestamp(), currentSession, shifts, assignedShift)) {
                    currentSession.getScans().add(scan.getTimestamp());
                    finalizeSession(currentSession);
                    sessions.add(currentSession);
                    currentSession = null;
                    continue;
                }

                if (currentSession.getMatchedShiftId() == null) {
                    LocalDateTime sessionFirstScan = currentSession.getScans().get(0);
                    boolean differentDay = !scan.getTimestamp().toLocalDate().equals(currentSession.getDate());
                    boolean exceedsSpan = ChronoUnit.MINUTES.between(sessionFirstScan, scan.getTimestamp()) > AMBIGUOUS_MAX_SPAN_MINUTES;

                    if (differentDay || exceedsSpan) {
                        finalizeSession(currentSession);
                        sessions.add(currentSession);
                        Map<String, Object> openerShift = findOpenerShift(scan.getTimestamp(), shifts, assignedShift, isCrossMidnight);
                        currentSession = openerShift != null
                                ? openSession(employeeId, scan, openerShift, assignedShift, isCrossMidnight)
                                : openAmbiguousSession(employeeId, scan);
                    } else {
                        currentSession.getScans().add(scan.getTimestamp());
                    }
                    continue;
                }

                Map<String, Object> openerShift = currentSession.getScans().size() == 1
                        && isScanAfterCurrentShiftEnd(scan.getTimestamp(), currentSession, shifts)
                        ? findOpenerShift(scan.getTimestamp(), shifts, assignedShift, isCrossMidnight)
                        : null;
                if (openerShift != null) {
                    finalizeSession(currentSession);
                    sessions.add(currentSession);
                    currentSession = openSession(employeeId, scan, openerShift, assignedShift, isCrossMidnight);
                } else {
                    currentSession.getScans().add(scan.getTimestamp());
                }
            }
        }

        if (currentSession != null) {
            finalizeSession(currentSession);
            sessions.add(currentSession);
        }

        return sessions;
    }

    private boolean isScanAfterCurrentShiftEnd(LocalDateTime scanTime, TasSession currentSession, List<Map<String, Object>> shifts) {
        if (currentSession.isCrossMidnight()) return true;
        Map<String, Object> matchedShift = findShiftById(shifts, currentSession.getMatchedShiftId());
        if (matchedShift == null) return true;
        LocalTime endTime = parseTime(matchedShift.get("endTime"));
        LocalDateTime shiftEnd = LocalDateTime.of(currentSession.getDate(), endTime);
        return scanTime.isAfter(shiftEnd);
    }

    private Map<String, Object> findOpenerShift(
            LocalDateTime timestamp,
            List<Map<String, Object>> shifts,
            Map<String, Object> assignedShift,
            boolean isCrossMidnight) {

        if (assignedShift != null && isInDetectionWindow(timestamp, assignedShift)) {
            return assignedShift;
        }

        if (isCrossMidnight) {
            return null;
        }

        for (Map<String, Object> shift : shifts) {
            if (shift.equals(assignedShift)) continue;
            if (isInDetectionWindow(timestamp, shift)) {
                return shift;
            }
        }

        return null;
    }

    private boolean isInDetectionWindow(LocalDateTime timestamp, Map<String, Object> shift) {
        LocalTime shiftStart = parseTime(shift.get("startTime"));
        LocalDate scanDate   = timestamp.toLocalDate();

        LocalDateTime anchor = LocalDateTime.of(scanDate, shiftStart);
        LocalDateTime windowStart = anchor.minusMinutes(DETECTION_BEFORE_MINUTES);
        LocalDateTime windowEnd   = anchor.plusMinutes(DETECTION_AFTER_MINUTES);

        return !timestamp.isBefore(windowStart) && !timestamp.isAfter(windowEnd);
    }

    private boolean isNextShiftExitScan(
            LocalDateTime timestamp,
            TasSession currentSession,
            List<Map<String, Object>> shifts,
            Map<String, Object> assignedShift) {

        if (!currentSession.isCrossMidnight()) return false;

        LocalDate sessionDate = currentSession.getDate();
        LocalDate scanDate    = timestamp.toLocalDate();

        if (!scanDate.isAfter(sessionDate)) return false;

        for (Map<String, Object> shift : shifts) {
            if (shift.equals(assignedShift)) continue;
            if (isInDetectionWindow(timestamp, shift)) {
                return true;
            }
        }
        return false;
    }

    private TasSession openSession(
            String employeeId,
            TasScanRecord firstScan,
            Map<String, Object> openerShift,
            Map<String, Object> assignedShift,
            boolean isCrossMidnight) {

        TasSession session = new TasSession();
        session.setEmployeeId(employeeId);
        session.setEmployeeName(firstScan.getEmployeeName());
        session.setDate(firstScan.getTimestamp().toLocalDate());
        session.setCrossMidnight(isCrossMidnight);
        session.setSessionAnchor("D");
        session.setFlags(new ArrayList<>());

        List<LocalDateTime> scans = new ArrayList<>();
        scans.add(firstScan.getTimestamp());
        session.setScans(scans);

        String openerShiftId = getShiftId(openerShift);
        session.setMatchedShiftId(openerShiftId);
        session.setMatchedShiftName(openerShift != null ? (String) openerShift.get("name") : null);
        session.setAssignedShiftId(getShiftId(assignedShift));
        session.setAssignedShiftName(assignedShift != null ? (String) assignedShift.get("name") : null);

        if (!openerShift.equals(assignedShift)) {
            session.getFlags().add(TasFlag.SHIFT_MISMATCH);
        }

        return session;
    }

    private TasSession openAmbiguousSession(String employeeId, TasScanRecord firstScan) {
        TasSession session = new TasSession();
        session.setEmployeeId(employeeId);
        session.setEmployeeName(firstScan.getEmployeeName());
        session.setDate(firstScan.getTimestamp().toLocalDate());
        session.setCrossMidnight(false);
        session.setSessionAnchor("D");
        session.setFlags(new ArrayList<>(List.of(TasFlag.AMBIGUOUS_SHIFT)));

        List<LocalDateTime> scans = new ArrayList<>();
        scans.add(firstScan.getTimestamp());
        session.setScans(scans);

        session.setMatchedShiftId(null);

        return session;
    }

    private void finalizeSession(TasSession session) {
        List<LocalDateTime> scans = session.getScans();
        if (!scans.isEmpty()) {
            session.setLastScan(scans.get(scans.size() - 1));
        }
    }

    private void detectSameDayDouble(List<TasSession> sessions) {
        Map<LocalDate, List<TasSession>> byDate = new LinkedHashMap<>();
        for (TasSession s : sessions) {
            byDate.computeIfAbsent(s.getDate(), k -> new ArrayList<>()).add(s);
        }
        for (List<TasSession> daySessions : byDate.values()) {
            if (daySessions.size() < 2) continue;

            Set<String> matchedShiftIds = new HashSet<>();
            boolean hasAmbiguous = false;
            for (TasSession s : daySessions) {
                if (s.getFlags().contains(TasFlag.AMBIGUOUS_SHIFT)) {
                    hasAmbiguous = true;
                } else {
                    matchedShiftIds.add(s.getMatchedShiftId());
                }
            }

            // A "double" requires evidence of two distinct shifts: either two sessions
            // matched different shift configs, or an ambiguous session alongside one
            // that did match a shift. Two ambiguous sessions alone (matchedShiftId ==
            // null for both) can't be distinguished from a single shift that got split,
            // so they're not flagged.
            boolean isDouble = matchedShiftIds.size() >= 2 || (hasAmbiguous && !matchedShiftIds.isEmpty());
            if (!isDouble) continue;

            for (TasSession s : daySessions) {
                if (!s.getFlags().contains(TasFlag.SAME_DAY_DOUBLE)) {
                    s.getFlags().add(TasFlag.SAME_DAY_DOUBLE);
                }
            }
        }
    }

    private Map<String, Object> findShiftById(List<Map<String, Object>> shifts, String shiftId) {
        if (shiftId == null) return null;
        for (Map<String, Object> shift : shifts) {
            if (shiftId.equals(getShiftId(shift))) return shift;
        }
        return null;
    }

    private String getShiftId(Map<String, Object> shift) {
        if (shift == null) return null;
        Object id = shift.get("id");
        return id != null ? id.toString() : null;
    }

    private LocalTime parseTime(Object timeObj) {
        if (timeObj == null) return LocalTime.MIDNIGHT;
        if (timeObj instanceof LocalTime) return (LocalTime) timeObj;
        String s = timeObj.toString();
        if (s.length() >= 5) {
            return LocalTime.of(
                    Integer.parseInt(s.substring(0, 2)),
                    Integer.parseInt(s.substring(3, 5))
            );
        }
        return LocalTime.MIDNIGHT;
    }
}
