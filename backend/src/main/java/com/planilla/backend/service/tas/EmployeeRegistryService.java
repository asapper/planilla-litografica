package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasAbsentEmployee;
import com.planilla.backend.model.tas.TasInactiveEmployee;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class EmployeeRegistryService {

    private final JdbcTemplate jdbc;

    public EmployeeRegistryService(@Qualifier("h2JdbcTemplate") JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Map<String, Object>> getAll(Boolean active, String shiftId, String search) {
        StringBuilder sql = new StringBuilder(
            "SELECT employee_id, name, shift_id, active, first_seen, last_seen FROM employee_registry WHERE 1=1"
        );
        List<Object> params = new ArrayList<>();

        if (active != null) {
            sql.append(" AND active = ?");
            params.add(active);
        }
        if (shiftId != null && !shiftId.isBlank()) {
            sql.append(" AND shift_id = ?");
            params.add(shiftId);
        }
        if (search != null && !search.isBlank()) {
            sql.append(" AND (LOWER(name) LIKE ? OR LOWER(employee_id) LIKE ?)");
            String pattern = "%" + search.toLowerCase() + "%";
            params.add(pattern);
            params.add(pattern);
        }
        sql.append(" ORDER BY name");

        return jdbc.queryForList(sql.toString(), params.toArray());
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

    public void updateEmployee(String employeeId, String shiftId, Boolean active) {
        if (shiftId == null && active == null) {
            return;
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
    }

    public void bulkAssignShift(List<String> employeeIds, String shiftId) {
        for (String id : employeeIds) {
            jdbc.update(
                "UPDATE employee_registry SET shift_id = ? WHERE employee_id = ?",
                shiftId, id
            );
        }
    }

    public void setActive(String employeeId, boolean active) {
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
                return;
            }
        }
        jdbc.update(
            "UPDATE employee_registry SET active = ? WHERE employee_id = ?",
            active, employeeId
        );
    }

    public boolean isNewEmployee(String employeeId) {
        Integer count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM employee_registry WHERE employee_id = ?",
            Integer.class, employeeId
        );
        return count == null || count == 0;
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
}
