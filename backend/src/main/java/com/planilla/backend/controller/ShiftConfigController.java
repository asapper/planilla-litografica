package com.planilla.backend.controller;

import com.planilla.backend.service.tas.ShiftConfigService;
import com.planilla.backend.service.tas.ShiftConfigService.ShiftHasActiveEmployeesException;
import com.planilla.backend.service.tas.ShiftConfigService.ShiftValidationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/config/shifts")
public class ShiftConfigController {

    private static final Logger log = LoggerFactory.getLogger(ShiftConfigController.class);

    private final ShiftConfigService shiftConfigService;

    public ShiftConfigController(ShiftConfigService shiftConfigService) {
        this.shiftConfigService = shiftConfigService;
    }

    @GetMapping
    public ResponseEntity<?> getAll() {
        List<Map<String, Object>> shifts = shiftConfigService.getAllShifts();
        return ResponseEntity.ok(shifts);
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body) {
        String name = (String) body.get("name");
        String startTime = (String) body.get("startTime");
        String endTime = (String) body.get("endTime");
        Boolean crossMidnight = body.containsKey("crossMidnight") ? (Boolean) body.get("crossMidnight") : false;

        try {
            Map<String, Object> created = shiftConfigService.createShift(name, startTime, endTime, crossMidnight != null && crossMidnight,
                    extractMinutes(body, "detectionBeforeMinutes"), extractMinutes(body, "detectionAfterMinutes"));
            if (created == null) {
                return ResponseEntity.internalServerError().body(error(500, "NOT_FOUND_AFTER_WRITE", "Shift created but could not be retrieved"));
            }
            return ResponseEntity.ok(created);
        } catch (ShiftValidationException e) {
            return ResponseEntity.badRequest().body(error(400, "CREATE_FAILED", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to create shift", e);
            return ResponseEntity.badRequest().body(error(400, "CREATE_FAILED", "No se pudo crear el turno."));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable String id, @RequestBody Map<String, Object> body) {
        String name = (String) body.get("name");
        String startTime = (String) body.get("startTime");
        String endTime = (String) body.get("endTime");
        Boolean crossMidnight = body.containsKey("crossMidnight") ? (Boolean) body.get("crossMidnight") : false;

        try {
            Map<String, Object> updated = shiftConfigService.updateShift(id, name, startTime, endTime, crossMidnight != null && crossMidnight,
                    extractMinutes(body, "detectionBeforeMinutes"), extractMinutes(body, "detectionAfterMinutes"));
            if (updated == null) {
                return ResponseEntity.internalServerError().body(error(500, "NOT_FOUND_AFTER_WRITE", "Shift updated but could not be retrieved"));
            }
            return ResponseEntity.ok(updated);
        } catch (ShiftValidationException e) {
            if ("SHIFT_NOT_FOUND".equals(e.getMessage())) {
                return ResponseEntity.status(404).body(error(404, e.getMessage(), "Shift not found"));
            }
            return ResponseEntity.badRequest().body(error(400, "UPDATE_FAILED", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to update shift {}", id, e);
            return ResponseEntity.badRequest().body(error(400, "UPDATE_FAILED", "No se pudo actualizar el turno."));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id) {
        try {
            shiftConfigService.deleteShift(id);
            return ResponseEntity.ok().build();
        } catch (ShiftHasActiveEmployeesException e) {
            List<Map<String, Object>> employeeList = new ArrayList<>();
            for (Map<String, Object> row : e.getEmployees()) {
                Map<String, Object> emp = new HashMap<>();
                Object empId = row.get("EMPLOYEE_ID");
                if (empId == null) empId = row.get("employee_id");
                Object name = row.get("NAME");
                if (name == null) name = row.get("name");
                emp.put("employeeId", empId);
                emp.put("name", name);
                employeeList.add(emp);
            }
            Map<String, Object> body = new HashMap<>();
            body.put("error", "SHIFT_HAS_ACTIVE_EMPLOYEES");
            body.put("employees", employeeList);
            return ResponseEntity.status(409).body(body);
        } catch (Exception e) {
            log.error("Failed to delete shift {}", id, e);
            return ResponseEntity.badRequest().body(error(400, "DELETE_FAILED", "No se pudo eliminar el turno."));
        }
    }

    private Integer extractMinutes(Map<String, Object> body, String key) {
        Object value = body.get(key);
        return value != null ? ((Number) value).intValue() : null;
    }

    private Map<String, Object> error(int status, String code, String message) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", status);
        body.put("code", code);
        body.put("message", message);
        return body;
    }
}
