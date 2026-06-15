package com.planilla.backend.service.tas;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ShiftConfigService {

    public static class ShiftHasActiveEmployeesException extends RuntimeException {
        private final List<Map<String, Object>> employees;

        public ShiftHasActiveEmployeesException(List<Map<String, Object>> employees) {
            super("SHIFT_HAS_ACTIVE_EMPLOYEES");
            this.employees = employees;
        }

        public List<Map<String, Object>> getEmployees() {
            return employees;
        }
    }

    private final JdbcTemplate jdbc;

    public ShiftConfigService(@Qualifier("h2JdbcTemplate") JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Map<String, Object>> getAllShifts() {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT id, name, start_time, end_time, cross_midnight, detection_before_minutes, detection_after_minutes FROM shift_config ORDER BY name"
        );
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(toShiftDto(row));
        }
        return result;
    }

    public Map<String, Object> createShift(String name, String startTime, String endTime, boolean crossMidnight,
                                             Integer detectionBeforeMinutes, Integer detectionAfterMinutes) {
        String id = generateShiftId(name);
        int before = detectionBeforeMinutes != null ? detectionBeforeMinutes : 60;
        int after = detectionAfterMinutes != null ? detectionAfterMinutes : 10;
        jdbc.update(
            "INSERT INTO shift_config (id, name, start_time, end_time, cross_midnight, detection_before_minutes, detection_after_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            id, name, startTime, endTime, crossMidnight, before, after
        );
        return getShiftById(id);
    }

    public Map<String, Object> updateShift(String id, String name, String startTime, String endTime, boolean crossMidnight,
                                             Integer detectionBeforeMinutes, Integer detectionAfterMinutes) {
        int before = detectionBeforeMinutes != null ? detectionBeforeMinutes : 60;
        int after = detectionAfterMinutes != null ? detectionAfterMinutes : 10;
        int updated = jdbc.update(
            "UPDATE shift_config SET name = ?, start_time = ?, end_time = ?, cross_midnight = ?, detection_before_minutes = ?, detection_after_minutes = ? WHERE id = ?",
            name, startTime, endTime, crossMidnight, before, after, id
        );
        if (updated == 0) {
            throw new IllegalArgumentException("SHIFT_NOT_FOUND");
        }
        return getShiftById(id);
    }

    public void deleteShift(String id) {
        List<Map<String, Object>> activeEmployees = jdbc.queryForList(
            "SELECT employee_id, name FROM employee_registry WHERE shift_id = ? AND active = TRUE",
            id
        );
        if (!activeEmployees.isEmpty()) {
            throw new ShiftHasActiveEmployeesException(activeEmployees);
        }
        jdbc.update(
            "UPDATE employee_registry SET shift_id = NULL WHERE shift_id = ? AND active = FALSE",
            id
        );
        jdbc.update("DELETE FROM shift_config WHERE id = ?", id);
    }

    private Map<String, Object> getShiftById(String id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT id, name, start_time, end_time, cross_midnight, detection_before_minutes, detection_after_minutes FROM shift_config WHERE id = ?", id
        );
        return rows.isEmpty() ? null : toShiftDto(rows.get(0));
    }

    private Map<String, Object> toShiftDto(Map<String, Object> row) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", row.get("ID"));
        dto.put("name", row.get("NAME"));
        dto.put("startTime", formatTime(row.get("START_TIME")));
        dto.put("endTime", formatTime(row.get("END_TIME")));
        dto.put("crossMidnight", row.get("CROSS_MIDNIGHT"));
        dto.put("detectionBeforeMinutes", row.get("DETECTION_BEFORE_MINUTES"));
        dto.put("detectionAfterMinutes", row.get("DETECTION_AFTER_MINUTES"));
        return dto;
    }

    private String formatTime(Object value) {
        if (value == null) return null;
        String s = value.toString();
        return s.length() >= 5 ? s.substring(0, 5) : s;
    }

    private String generateShiftId(String name) {
        String normalized = Normalizer.normalize(name, Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")
            .toLowerCase()
            .replaceAll("[^a-z0-9]+", "-")
            .replaceAll("^-+|-+$", "");
        if (normalized.isEmpty()) normalized = "turno";

        String candidate = normalized;
        int suffix = 2;
        while (countShiftsWithId(candidate) > 0) {
            candidate = normalized + "-" + suffix;
            suffix++;
        }
        return candidate;
    }

    private int countShiftsWithId(String id) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM shift_config WHERE id = ?", Integer.class, id);
        return count == null ? 0 : count;
    }
}
