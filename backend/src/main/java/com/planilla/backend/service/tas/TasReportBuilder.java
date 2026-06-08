package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasSession;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.*;

@Service
public class TasReportBuilder {

    private final HolidayService holidayService;

    public TasReportBuilder(HolidayService holidayService) {
        this.holidayService = holidayService;
    }

    public BuildResult build(
            List<TasSession> sessions,
            LocalDate reportStart,
            LocalDate reportEnd,
            List<Map<String, Object>> shifts) {

        Map<String, String> employeeNames = new LinkedHashMap<>();
        Map<String, Set<LocalDate>> workedDaysByEmployee = new LinkedHashMap<>();
        Map<String, Map<Integer, int[]>> minutesByEmployeeQuincena = new LinkedHashMap<>();

        for (TasSession session : sessions) {
            String empId = session.getEmployeeId();
            employeeNames.putIfAbsent(empId, "");

            int quincena = session.getDate().getDayOfMonth() <= 15 ? 1 : 2;

            workedDaysByEmployee
                    .computeIfAbsent(empId, k -> new HashSet<>())
                    .add(session.getDate());

            int[] minutes = minutesByEmployeeQuincena
                    .computeIfAbsent(empId, k -> new LinkedHashMap<>())
                    .computeIfAbsent(quincena, k -> new int[2]);

            if (!session.isNeedsResolution()) {
                minutes[0] += session.getSimplesMinutes();
                minutes[1] += session.getDoblesMinutes();
            }
        }

        Map<String, String> employeeNamesFromScans = buildEmployeeNamesMap(sessions);

        Map<String, String> consistentMismatchShiftIds = detectConsistentMismatches(sessions);

        List<EmployeeRow> rows = new ArrayList<>();

        for (Map.Entry<String, Map<Integer, int[]>> empEntry : minutesByEmployeeQuincena.entrySet()) {
            String empId = empEntry.getKey();
            String empName = employeeNamesFromScans.getOrDefault(empId, "");
            Set<LocalDate> workedDays = workedDaysByEmployee.getOrDefault(empId, new HashSet<>());

            for (Map.Entry<Integer, int[]> qEntry : empEntry.getValue().entrySet()) {
                int quincena = qEntry.getKey();
                int[] minutes = qEntry.getValue();

                int simplesHours = (int) Math.round(Math.floor(minutes[0] / 30.0) / 2.0);
                int doblesHours  = (int) Math.round(Math.floor(minutes[1] / 30.0) / 2.0);

                LocalDate qStart = quincena == 1
                        ? reportStart.withDayOfMonth(1)
                        : reportStart.withDayOfMonth(16);
                LocalDate qEnd = quincena == 1
                        ? reportStart.withDayOfMonth(15)
                        : reportStart.withDayOfMonth(reportStart.lengthOfMonth());

                if (qStart.isBefore(reportStart)) qStart = reportStart;
                if (qEnd.isAfter(reportEnd)) qEnd = reportEnd;

                int nonWorkedDays = countNonWorkedDays(qStart, qEnd, workedDays);

                EmployeeRow row = new EmployeeRow();
                row.setCodigoEmpleado(empId);
                row.setNombreEmpleado(empName);
                row.setHorasExtrasSimples(simplesHours);
                row.setHorasExtrasDobles(doblesHours);
                row.setDiasNoLaborados(nonWorkedDays);
                row.setMes(qStart.getMonthValue());
                row.setAnio(qStart.getYear());
                row.setNumeroDequincena(quincena);
                rows.add(row);
            }
        }

        return new BuildResult(rows, consistentMismatchShiftIds);
    }

    private int countNonWorkedDays(LocalDate start, LocalDate end, Set<LocalDate> workedDays) {
        int count = 0;
        LocalDate d = start;
        while (!d.isAfter(end)) {
            DayOfWeek dow = d.getDayOfWeek();
            if (dow != DayOfWeek.SUNDAY
                    && !holidayService.isHoliday(d)
                    && !workedDays.contains(d)) {
                count++;
            }
            d = d.plusDays(1);
        }
        return count;
    }

    private Map<String, String> buildEmployeeNamesMap(List<TasSession> sessions) {
        Map<String, String> names = new LinkedHashMap<>();
        return names;
    }

    private Map<String, String> detectConsistentMismatches(List<TasSession> sessions) {
        Map<String, Map<Integer, Set<String>>> mismatchShiftsByEmpQuincena = new LinkedHashMap<>();

        for (TasSession session : sessions) {
            if (session.getFlags() != null && session.getFlags().contains(TasFlag.SHIFT_MISMATCH)
                    && session.getMatchedShiftId() != null) {
                String empId   = session.getEmployeeId();
                int quincena   = session.getDate().getDayOfMonth() <= 15 ? 1 : 2;
                mismatchShiftsByEmpQuincena
                        .computeIfAbsent(empId, k -> new LinkedHashMap<>())
                        .computeIfAbsent(quincena, k -> new HashSet<>())
                        .add(session.getMatchedShiftId());
            }
        }

        Map<String, Set<LocalDate>> sessionDaysByEmpQuincena = new LinkedHashMap<>();
        Map<String, Integer> totalSessionsByEmpQuincena = new LinkedHashMap<>();
        Map<String, Integer> mismatchSessionsByEmpQuincena = new LinkedHashMap<>();

        for (TasSession session : sessions) {
            String empId  = session.getEmployeeId();
            int quincena  = session.getDate().getDayOfMonth() <= 15 ? 1 : 2;
            String key    = empId + ":" + quincena;
            totalSessionsByEmpQuincena.merge(key, 1, Integer::sum);
            if (session.getFlags() != null && session.getFlags().contains(TasFlag.SHIFT_MISMATCH)) {
                mismatchSessionsByEmpQuincena.merge(key, 1, Integer::sum);
            }
        }

        Map<String, String> result = new LinkedHashMap<>();

        for (Map.Entry<String, Map<Integer, Set<String>>> empEntry : mismatchShiftsByEmpQuincena.entrySet()) {
            String empId = empEntry.getKey();
            for (Map.Entry<Integer, Set<String>> qEntry : empEntry.getValue().entrySet()) {
                int quincena = qEntry.getKey();
                Set<String> altShifts = qEntry.getValue();
                if (altShifts.size() != 1) continue;

                String key = empId + ":" + quincena;
                int total    = totalSessionsByEmpQuincena.getOrDefault(key, 0);
                int mismatched = mismatchSessionsByEmpQuincena.getOrDefault(key, 0);

                if (total > 0 && total == mismatched) {
                    result.put(empId, altShifts.iterator().next());
                }
            }
        }

        return result;
    }

    public static class BuildResult {
        public final List<EmployeeRow> rows;
        public final Map<String, String> consistentMismatchShiftIds;

        public BuildResult(List<EmployeeRow> rows, Map<String, String> consistentMismatchShiftIds) {
            this.rows                      = rows;
            this.consistentMismatchShiftIds = consistentMismatchShiftIds;
        }
    }
}
