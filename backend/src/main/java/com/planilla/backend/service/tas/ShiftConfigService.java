package com.planilla.backend.service.tas;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

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
        return jdbc.queryForList("SELECT id, name, start_time, end_time, cross_midnight FROM shift_config ORDER BY name");
    }

    public void createShift(String id, String name, String startTime, String endTime, boolean crossMidnight) {
        jdbc.update(
            "INSERT INTO shift_config (id, name, start_time, end_time, cross_midnight) VALUES (?, ?, ?, ?, ?)",
            id, name, startTime, endTime, crossMidnight
        );
    }

    public void updateShift(String id, String name, String startTime, String endTime, boolean crossMidnight) {
        int updated = jdbc.update(
            "UPDATE shift_config SET name = ?, start_time = ?, end_time = ?, cross_midnight = ? WHERE id = ?",
            name, startTime, endTime, crossMidnight, id
        );
        if (updated == 0) {
            throw new IllegalArgumentException("SHIFT_NOT_FOUND");
        }
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
}
