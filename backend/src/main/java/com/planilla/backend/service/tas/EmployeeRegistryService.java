package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasAbsentEmployee;
import com.planilla.backend.model.tas.TasInactiveEmployee;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class EmployeeRegistryService {

    private static final String SELECT_BASE =
        "SELECT r.employee_id, r.name, r.shift_id, r.active, r.accrues_overtime, s.name AS shift_name " +
        "FROM employee_registry r LEFT JOIN shift_config s ON r.shift_id = s.id";

    private final JdbcTemplate jdbc;

    public EmployeeRegistryService(@Qualifier("h2JdbcTemplate") JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Map<String, Object>> getAll(Boolean active, String shiftId, String search) {
        StringBuilder sql = new StringBuilder(SELECT_BASE + " WHERE 1=1");
        List<Object> params = new ArrayList<>();

        if (active != null) {
            sql.append(" AND r.active = ?");
            params.add(active);
        }
        if (shiftId != null && !shiftId.isBlank()) {
            sql.append(" AND r.shift_id = ?");
            params.add(shiftId);
        }
        if (search != null && !search.isBlank()) {
            sql.append(" AND (LOWER(r.name) LIKE ? ESCAPE '\\' OR LOWER(r.employee_id) LIKE ? ESCAPE '\\')");
            String escaped = search.toLowerCase()
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
            String pattern = "%" + escaped + "%";
            params.add(pattern);
            params.add(pattern);
        }
        sql.append(" ORDER BY r.name");

        List<Map<String, Object>> rows = jdbc.queryForList(sql.toString(), params.toArray());
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(toEmployeeDto(row));
        }
        return result;
    }

    public void upsertEmployee(String employeeId, String name) {
        jdbc.update(
            "MERGE INTO employee_registry AS target " +
            "USING (VALUES (?, ?)) AS src(employee_id, name) " +
            "ON target.employee_id = src.employee_id " +
            "WHEN MATCHED THEN UPDATE SET target.name = src.name, target.last_seen = CURRENT_TIMESTAMP " +
            "WHEN NOT MATCHED THEN INSERT (employee_id, name, shift_id, active, first_seen, last_seen) " +
            "VALUES (src.employee_id, src.name, 'manana', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            employeeId, name
        );
    }

    public Map<String, Object> updateEmployee(String employeeId, String shiftId, Boolean active) {
        if (shiftId == null && active == null) {
            return null;
        }
        if (shiftId != null) {
            Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM shift_config WHERE id = ?", Integer.class, shiftId);
            if (count == null || count == 0) {
                throw new IllegalArgumentException("SHIFT_NOT_FOUND");
            }
        }
        if (shiftId != null && active != null) {
            jdbc.update(
                "UPDATE employee_registry SET shift_id = ?, active = ? WHERE employee_id = ?",
                shiftId, active, employeeId
            );
        } else if (shiftId != null) {
            jdbc.update(
                "UPDATE employee_registry SET shift_id = ? WHERE employee_id = ?",
                shiftId, employeeId
            );
        } else {
            jdbc.update(
                "UPDATE employee_registry SET active = ? WHERE employee_id = ?",
                active, employeeId
            );
        }
        return getById(employeeId);
    }

    public void bulkAssignShift(List<String> employeeIds, String shiftId) {
        for (String id : employeeIds) {
            jdbc.update(
                "UPDATE employee_registry SET shift_id = ? WHERE employee_id = ?",
                shiftId, id
            );
        }
    }

    public Map<String, Object> setActive(String employeeId, boolean active) {
        if (active) {
            Integer nullShift = jdbc.queryForObject(
                "SELECT COUNT(*) FROM employee_registry WHERE employee_id = ? AND shift_id IS NULL",
                Integer.class, employeeId
            );
            if (nullShift != null && nullShift > 0) {
                jdbc.update(
                    "UPDATE employee_registry SET active = TRUE, shift_id = 'manana' WHERE employee_id = ?",
                    employeeId
                );
                return getById(employeeId);
            }
        }
        jdbc.update(
            "UPDATE employee_registry SET active = ? WHERE employee_id = ?",
            active, employeeId
        );
        return getById(employeeId);
    }

    public Map<String, Object> setAccruesOvertime(String employeeId, boolean accruesOvertime) {
        jdbc.update(
            "UPDATE employee_registry SET accrues_overtime = ? WHERE employee_id = ?",
            accruesOvertime, employeeId
        );
        return getById(employeeId);
    }

    public boolean employeeNotInRegistry(String employeeId) {
        Integer count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM employee_registry WHERE employee_id = ?",
            Integer.class, employeeId
        );
        return count == null || count == 0;
    }

    public Map<String, Boolean> getAccruesOvertimeFlags(Collection<String> employeeIds) {
        if (employeeIds.isEmpty()) return Map.of();
        Map<String, Boolean> result = new HashMap<>();
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT employee_id, accrues_overtime FROM employee_registry WHERE employee_id IN (" +
                employeeIds.stream().map(id -> "?").collect(Collectors.joining(",")) + ")",
            employeeIds.toArray()
        );
        for (Map<String, Object> row : rows) {
            Object empId = row.get("EMPLOYEE_ID");
            if (empId == null) empId = row.get("employee_id");
            Object value = row.get("ACCRUES_OVERTIME");
            if (value == null) value = row.get("accrues_overtime");
            result.put((String) empId, !(value instanceof Boolean) || (Boolean) value);
        }
        return result;
    }

    public List<TasAbsentEmployee> getAbsentActiveEmployees(Set<String> presentEmployeeIds) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT employee_id, name FROM employee_registry WHERE active = TRUE AND first_seen < DATEADD('MINUTE', -1, CURRENT_TIMESTAMP)"
        );
        List<TasAbsentEmployee> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String id = (String) row.get("EMPLOYEE_ID");
            if (id == null) id = (String) row.get("employee_id");
            if (!presentEmployeeIds.contains(id)) {
                TasAbsentEmployee emp = new TasAbsentEmployee();
                emp.setEmployeeId(id);
                Object nameObj = row.get("NAME");
                if (nameObj == null) nameObj = row.get("name");
                emp.setName(nameObj != null ? nameObj.toString() : "");
                result.add(emp);
            }
        }
        return result;
    }

    public List<TasInactiveEmployee> getInactiveEmployeesPresent(Set<String> presentEmployeeIds) {
        if (presentEmployeeIds.isEmpty()) {
            return new ArrayList<>();
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT employee_id, name FROM employee_registry WHERE active = FALSE"
        );
        List<TasInactiveEmployee> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String id = (String) row.get("EMPLOYEE_ID");
            if (id == null) id = (String) row.get("employee_id");
            if (presentEmployeeIds.contains(id)) {
                TasInactiveEmployee emp = new TasInactiveEmployee();
                emp.setEmployeeId(id);
                Object nameObj = row.get("NAME");
                if (nameObj == null) nameObj = row.get("name");
                emp.setName(nameObj != null ? nameObj.toString() : "");
                result.add(emp);
            }
        }
        return result;
    }

    private Map<String, Object> getById(String employeeId) {
        List<Map<String, Object>> rows = jdbc.queryForList(SELECT_BASE + " WHERE r.employee_id = ?", employeeId);
        return rows.isEmpty() ? null : toEmployeeDto(rows.get(0));
    }

    private Map<String, Object> toEmployeeDto(Map<String, Object> row) {
        Map<String, Object> dto = new LinkedHashMap<>();
        Object id = row.get("EMPLOYEE_ID");
        dto.put("id", id);
        dto.put("code", id);
        dto.put("name", row.get("NAME"));
        dto.put("shiftId", row.get("SHIFT_ID"));
        dto.put("shiftName", row.get("SHIFT_NAME"));
        dto.put("active", row.get("ACTIVE"));
        dto.put("accruesOvertime", row.get("ACCRUES_OVERTIME"));
        return dto;
    }
}
