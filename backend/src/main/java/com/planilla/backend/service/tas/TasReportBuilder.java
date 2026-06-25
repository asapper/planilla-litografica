package com.planilla.backend.service.tas;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasPeriod;
import com.planilla.backend.model.tas.TasSession;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class TasReportBuilder {

    private final HolidayService holidayService;
    private final EmployeeRegistryService employeeRegistryService;

    public TasReportBuilder(HolidayService holidayService, EmployeeRegistryService employeeRegistryService) {
        this.holidayService = holidayService;
        this.employeeRegistryService = employeeRegistryService;
    }

    public BuildResult build(
            List<TasSession> sessions,
            LocalDate reportStart,
            LocalDate reportEnd,
            List<Map<String, Object>> shifts) {
        return build(sessions, reportStart, reportEnd, shifts, null);
    }

    public BuildResult build(
            List<TasSession> sessions,
            LocalDate reportStart,
            LocalDate reportEnd,
            List<Map<String, Object>> shifts,
            TasPeriod periodFilter) {

        List<TasSession> filteredSessions = periodFilter == null
                ? sessions
                : sessions.stream()
                        .filter(s -> TasPeriod.of(s.getDate()).equals(periodFilter))
                        .collect(Collectors.toList());

        Map<String, Set<LocalDate>> workedDaysByEmployee = new LinkedHashMap<>();
        Map<String, Map<TasPeriod, int[]>> minutesByEmployeePeriod = new LinkedHashMap<>();
        Map<String, Map<TasPeriod, Set<LocalDate>>> bestFitDaysByEmpPeriod = new LinkedHashMap<>();

        for (TasSession session : filteredSessions) {
            String empId = session.getEmployeeId();
            TasPeriod period = TasPeriod.of(session.getDate());

            workedDaysByEmployee
                    .computeIfAbsent(empId, k -> new HashSet<>())
                    .add(session.getDate());

            int[] minutes = minutesByEmployeePeriod
                    .computeIfAbsent(empId, k -> new LinkedHashMap<>())
                    .computeIfAbsent(period, k -> new int[2]);

            if (!session.isNeedsResolution()) {
                minutes[0] += session.getSimplesMinutes();
                minutes[1] += session.getDoblesMinutes();
            }

            if (session.getFlags() != null && session.getFlags().contains(TasFlag.BEST_FIT_SHIFT)) {
                bestFitDaysByEmpPeriod
                        .computeIfAbsent(empId, k -> new LinkedHashMap<>())
                        .computeIfAbsent(period, k -> new HashSet<>())
                        .add(session.getDate());
            }
        }

        Map<String, String> employeeNamesFromScans = buildEmployeeNamesMap(filteredSessions);

        Map<String, Boolean> accruesOvertimeFlags =
                employeeRegistryService.getAccruesOvertimeFlags(minutesByEmployeePeriod.keySet());

        List<EmployeeRow> rows = new ArrayList<>();

        for (Map.Entry<String, Map<TasPeriod, int[]>> empEntry : minutesByEmployeePeriod.entrySet()) {
            String empId = empEntry.getKey();
            String empName = employeeNamesFromScans.getOrDefault(empId, "");
            Set<LocalDate> workedDays = workedDaysByEmployee.getOrDefault(empId, new HashSet<>());

            for (Map.Entry<TasPeriod, int[]> pEntry : empEntry.getValue().entrySet()) {
                TasPeriod period = pEntry.getKey();
                int[] minutes = pEntry.getValue();

                double simplesHours = Math.floor(minutes[0] / 30.0) / 2.0;
                double doblesHours  = Math.floor(minutes[1] / 30.0) / 2.0;

                LocalDate qStart = period.numeroDequincena() == 1
                        ? LocalDate.of(period.anio(), period.mes(), 1)
                        : LocalDate.of(period.anio(), period.mes(), 16);
                LocalDate qEnd = period.numeroDequincena() == 1
                        ? LocalDate.of(period.anio(), period.mes(), 15)
                        : qStart.withDayOfMonth(qStart.lengthOfMonth());

                int nonWorkedDays = countNonWorkedDays(qStart, qEnd, workedDays);

                EmployeeRow row = new EmployeeRow();
                row.setCodigoEmpleado(empId);
                row.setNombreEmpleado(empName);
                row.setHorasExtrasSimples(simplesHours);
                row.setHorasExtrasDobles(doblesHours);
                row.setDiasNoLaborados(nonWorkedDays);
                row.setMes(period.mes());
                row.setAnio(period.anio());
                row.setNumeroDequincena(period.numeroDequincena());

                int diasTurnoEstimado = bestFitDaysByEmpPeriod
                        .getOrDefault(empId, Map.of())
                        .getOrDefault(period, Set.of())
                        .size();
                row.setDiasTurnoEstimado(diasTurnoEstimado);

                boolean accruesOvertime = accruesOvertimeFlags.getOrDefault(empId, true);
                row.setAccruesOvertime(accruesOvertime);
                if (!accruesOvertime) {
                    row.setHorasExtrasSimples(0);
                    row.setHorasExtrasDobles(0);
                }

                rows.add(row);
            }
        }

        return new BuildResult(rows);
    }

    public List<TasPeriod> computeAvailablePeriods(List<TasSession> sessions) {
        return sessions.stream()
                .map(s -> TasPeriod.of(s.getDate()))
                .distinct()
                .sorted(Comparator.comparingInt(TasPeriod::anio)
                        .thenComparingInt(TasPeriod::mes)
                        .thenComparingInt(TasPeriod::numeroDequincena))
                .collect(Collectors.toList());
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
        for (TasSession session : sessions) {
            names.putIfAbsent(session.getEmployeeId(),
                    session.getEmployeeName() != null ? session.getEmployeeName() : "");
        }
        return names;
    }

    public static class BuildResult {
        public final List<EmployeeRow> rows;

        public BuildResult(List<EmployeeRow> rows) {
            this.rows = rows;
        }
    }
}
