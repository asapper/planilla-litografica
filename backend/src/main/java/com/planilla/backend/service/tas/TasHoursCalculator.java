package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasSession;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

@Service
public class TasHoursCalculator {

    static final int GRACE_PERIOD_MINUTES = 10;
    private static final int MISSING_SCAN_THRESHOLD_MINUTES = 60;

    private final AppConfigService appConfigService;
    private final HolidayService holidayService;
    private final ShiftConfigService shiftConfigService;

    public TasHoursCalculator(
            AppConfigService appConfigService,
            HolidayService holidayService,
            ShiftConfigService shiftConfigService) {
        this.appConfigService   = appConfigService;
        this.holidayService     = holidayService;
        this.shiftConfigService = shiftConfigService;
    }

    public void calculate(List<TasSession> sessions, LocalDate reportStart, LocalDate reportEnd) {
        int legalBreakAllowance = appConfigService.getLegalBreakAllowanceMinutes();
        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();

        for (TasSession session : sessions) {
            detectCutoffFlags(session, reportStart, reportEnd);
            detectMissingScansFlags(session, shifts, legalBreakAllowance);

            boolean hasBlockingFlags = session.getFlags() != null
                    && session.getFlags().stream().anyMatch(f -> f != TasFlag.AMBIGUOUS_SHIFT);
            session.setNeedsResolution(hasBlockingFlags);

            if (!hasBlockingFlags) {
                computeWorkedHours(session, shifts, legalBreakAllowance);
                classifyHours(session, shifts);
            } else {
                setRawScanBounds(session);
                session.setWorkedMinutes(0);
                session.setWorkedHours(0.0);
                session.setSimplesMinutes(0);
                session.setDoblesMinutes(0);
            }
        }
    }

    private void detectCutoffFlags(TasSession session, LocalDate reportStart, LocalDate reportEnd) {
        LocalDate sessionDate = session.getDate();

        if (session.isCrossMidnight() && sessionDate.equals(reportStart)) {
            addFlag(session, TasFlag.START_CUTOFF);
        }

        if (session.isCrossMidnight() && sessionDate.equals(reportEnd)) {
            addFlag(session, TasFlag.END_CUTOFF);
        }
    }

    private void detectMissingScansFlags(
            TasSession session,
            List<Map<String, Object>> shifts,
            int legalBreakAllowance) {

        List<LocalDateTime> scans = session.getScans();
        if (scans == null || scans.isEmpty()) return;

        Map<String, Object> shift = findShiftById(shifts, session.getMatchedShiftId());
        if (shift == null) return;

        LocalTime shiftStart = parseTime(shift.get("start_time"));
        LocalTime shiftEnd   = parseTime(shift.get("end_time"));

        LocalDateTime firstScan = scans.get(0);
        LocalDateTime lastScan  = scans.get(scans.size() - 1);
        LocalDate sessionDate   = session.getDate();

        LocalDateTime expectedStart = LocalDateTime.of(sessionDate, shiftStart);
        LocalDateTime graceEnd      = expectedStart.plusMinutes(GRACE_PERIOD_MINUTES);
        LocalDateTime missingEntryThreshold = graceEnd.plusMinutes(MISSING_SCAN_THRESHOLD_MINUTES);

        if (firstScan.isAfter(missingEntryThreshold)) {
            addFlag(session, TasFlag.MISSING_ENTRY);
        }

        LocalDateTime expectedEnd;
        if (Boolean.TRUE.equals(shift.get("cross_midnight"))) {
            expectedEnd = LocalDateTime.of(sessionDate.plusDays(1), shiftEnd);
        } else {
            expectedEnd = LocalDateTime.of(sessionDate, shiftEnd);
        }
        LocalDateTime missingExitThreshold = expectedEnd.minusMinutes(MISSING_SCAN_THRESHOLD_MINUTES);

        if (lastScan.isBefore(missingExitThreshold)) {
            addFlag(session, TasFlag.MISSING_EXIT);
        }
    }

    private void computeWorkedHours(
            TasSession session,
            List<Map<String, Object>> shifts,
            int legalBreakAllowance) {

        List<LocalDateTime> scans = session.getScans();
        if (scans == null || scans.size() < 2) {
            session.setWorkedMinutes(0);
            session.setWorkedHours(0.0);
            return;
        }

        Map<String, Object> shift = findShiftById(shifts, session.getMatchedShiftId());
        LocalTime shiftStart = shift != null ? parseTime(shift.get("start_time")) : null;

        LocalDateTime firstScan = scans.get(0);
        LocalDateTime lastScanDt = scans.get(scans.size() - 1);

        LocalDateTime effectiveStart;
        if (shift != null && shiftStart != null) {
            LocalDateTime expectedStart = LocalDateTime.of(session.getDate(), shiftStart);
            LocalDateTime graceEnd = expectedStart.plusMinutes(GRACE_PERIOD_MINUTES);
            effectiveStart = firstScan.isAfter(graceEnd) ? firstScan : expectedStart;
        } else {
            effectiveStart = firstScan;
        }
        session.setEffectiveStart(effectiveStart);

        long totalBreakGap = 0;
        for (int i = 1; i < scans.size() - 1; i += 2) {
            long gap = ChronoUnit.MINUTES.between(scans.get(i), scans.get(i + 1));
            totalBreakGap += gap;
        }

        long deductibleBreak = Math.max(0, totalBreakGap - legalBreakAllowance);
        long totalSpan = ChronoUnit.MINUTES.between(effectiveStart, lastScanDt);
        long workedMinutes = totalSpan - deductibleBreak;
        if (workedMinutes < 0) workedMinutes = 0;

        session.setWorkedMinutes((int) workedMinutes);
        session.setWorkedHours(roundToHalfHour((int) workedMinutes));
        session.setLastScan(lastScanDt);
    }

    private void setRawScanBounds(TasSession session) {
        List<LocalDateTime> scans = session.getScans();
        if (scans == null || scans.isEmpty()) return;

        LocalDateTime first = scans.get(0);
        LocalDateTime last  = scans.get(scans.size() - 1);
        boolean missingEntry = session.getFlags() != null && session.getFlags().contains(TasFlag.MISSING_ENTRY);
        boolean missingExit  = session.getFlags() != null && session.getFlags().contains(TasFlag.MISSING_EXIT);

        if (scans.size() == 1) {
            if (missingEntry && !missingExit) {
                session.setLastScan(first);
            } else if (missingExit && !missingEntry) {
                session.setEffectiveStart(first);
            } else {
                session.setEffectiveStart(first);
                session.setLastScan(first);
            }
            return;
        }

        session.setEffectiveStart(first);
        session.setLastScan(last);
    }

    public static double roundToHalfHour(int minutes) {
        return Math.floor(minutes / 30.0) / 2.0;
    }

    public void classifyHours(TasSession session, List<Map<String, Object>> shifts) {
        int totalMinutes = session.getWorkedMinutes();

        boolean startIsSpecial = isSpecialDay(session.getDate());

        LocalDateTime effectiveStart = session.getEffectiveStart();
        LocalDateTime lastScan = session.getLastScan();
        boolean crossesIntoNextDay = effectiveStart != null && lastScan != null
                && lastScan.toLocalDate().isAfter(effectiveStart.toLocalDate());

        if (crossesIntoNextDay) {
            LocalDate nextDate = effectiveStart.toLocalDate().plusDays(1);
            boolean endIsSpecial = isSpecialDay(nextDate);

            if (startIsSpecial != endIsSpecial) {
                LocalDateTime midnight = LocalDateTime.of(nextDate, LocalTime.MIDNIGHT);
                long rawBeforeMidnight = Math.max(0, ChronoUnit.MINUTES.between(effectiveStart, midnight));
                long rawAfterMidnight  = Math.max(0, ChronoUnit.MINUTES.between(midnight, lastScan));

                int specialMinutes = startIsSpecial
                        ? (int) Math.min(totalMinutes, rawBeforeMidnight)
                        : (int) Math.min(totalMinutes, rawAfterMidnight);
                int normalMinutes = totalMinutes - specialMinutes;

                session.setSimplesMinutes(classifyNormalMinutes(normalMinutes, session, shifts));
                session.setDoblesMinutes(specialMinutes);
                return;
            }
        }

        if (startIsSpecial) {
            session.setSimplesMinutes(0);
            session.setDoblesMinutes(totalMinutes);
            return;
        }

        session.setSimplesMinutes(classifyNormalMinutes(totalMinutes, session, shifts));
        session.setDoblesMinutes(0);
    }

    private boolean isSpecialDay(LocalDate date) {
        return date.getDayOfWeek() == DayOfWeek.SUNDAY || holidayService.isHoliday(date);
    }

    private int classifyNormalMinutes(int totalMinutes, TasSession session, List<Map<String, Object>> shifts) {
        Map<String, Object> shift = findShiftById(shifts, session.getMatchedShiftId());
        int shiftDurationMinutes = computeShiftDurationMinutes(shift);

        int shiftDurationInHalfHours = (int) (Math.floor(shiftDurationMinutes / 30.0));
        int shiftDurationRoundedMinutes = shiftDurationInHalfHours * 30;

        return totalMinutes > shiftDurationRoundedMinutes
                ? totalMinutes - shiftDurationRoundedMinutes
                : 0;
    }

    private int computeShiftDurationMinutes(Map<String, Object> shift) {
        if (shift == null) return 480;
        LocalTime start = parseTime(shift.get("start_time"));
        LocalTime end   = parseTime(shift.get("end_time"));
        boolean crossMidnight = Boolean.TRUE.equals(shift.get("cross_midnight"));

        int startMinutes = start.getHour() * 60 + start.getMinute();
        int endMinutes   = end.getHour()   * 60 + end.getMinute();

        if (crossMidnight) {
            return (24 * 60 - startMinutes) + endMinutes;
        } else {
            return endMinutes - startMinutes;
        }
    }

    private void addFlag(TasSession session, TasFlag flag) {
        if (session.getFlags() == null) {
            session.setFlags(new java.util.ArrayList<>());
        }
        if (!session.getFlags().contains(flag)) {
            session.getFlags().add(flag);
        }
    }

    private Map<String, Object> findShiftById(List<Map<String, Object>> shifts, String shiftId) {
        if (shiftId == null || shifts == null) return null;
        for (Map<String, Object> shift : shifts) {
            Object id = shift.get("id");
            if (shiftId.equals(id != null ? id.toString() : null)) return shift;
        }
        return null;
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
