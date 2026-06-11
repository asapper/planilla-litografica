package com.planilla.backend.controller;

import com.planilla.backend.service.tas.EmployeeRegistryService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/config/employees")
@CrossOrigin(origins = "*")
public class EmployeeRegistryController {

    private final EmployeeRegistryService employeeRegistryService;

    public EmployeeRegistryController(EmployeeRegistryService employeeRegistryService) {
        this.employeeRegistryService = employeeRegistryService;
    }

    @GetMapping
    public ResponseEntity<?> getAll(
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) String shiftId,
            @RequestParam(required = false) String search) {
        List<Map<String, Object>> employees = employeeRegistryService.getAll(active, shiftId, search);
        return ResponseEntity.ok(employees);
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable String id, @RequestBody Map<String, Object> body) {
        String shiftId = (String) body.get("shiftId");
        Boolean active = body.containsKey("active") ? (Boolean) body.get("active") : null;

        if (shiftId == null && active == null) {
            return ResponseEntity.badRequest().body(error(400, "NO_FIELDS_TO_UPDATE", "No fields provided to update"));
        }

        try {
            Map<String, Object> updated = employeeRegistryService.updateEmployee(id, shiftId, active);
            if (updated == null) {
                return ResponseEntity.status(404).body(error(404, "EMPLOYEE_NOT_FOUND", "Employee not found"));
            }
            return ResponseEntity.ok(updated);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(error(400, "UPDATE_FAILED", e.getMessage()));
        }
    }

    @PostMapping("/bulk-assign")
    public ResponseEntity<?> bulkAssign(@RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> employeeIds = (List<String>) body.get("employeeIds");
        String shiftId = (String) body.get("shiftId");

        if (employeeIds == null || employeeIds.isEmpty()) {
            return ResponseEntity.badRequest().body(error(400, "MISSING_EMPLOYEE_IDS", "employeeIds is required"));
        }

        try {
            employeeRegistryService.bulkAssignShift(employeeIds, shiftId);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(error(400, "BULK_ASSIGN_FAILED", e.getMessage()));
        }
    }

    @PostMapping("/{id}/deactivate")
    public ResponseEntity<?> deactivate(@PathVariable String id) {
        try {
            Map<String, Object> updated = employeeRegistryService.setActive(id, false);
            if (updated == null) {
                return ResponseEntity.status(404).body(error(404, "EMPLOYEE_NOT_FOUND", "Employee not found"));
            }
            return ResponseEntity.ok(updated);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(error(400, "DEACTIVATE_FAILED", e.getMessage()));
        }
    }

    @PatchMapping("/{id}/accrues-overtime")
    public ResponseEntity<?> updateAccruesOvertime(@PathVariable String id, @RequestBody Map<String, Object> body) {
        Object value = body.get("accruesOvertime");
        if (!(value instanceof Boolean)) {
            return ResponseEntity.badRequest().body(error(400, "MISSING_FIELD", "accruesOvertime is required"));
        }
        Map<String, Object> updated = employeeRegistryService.setAccruesOvertime(id, (Boolean) value);
        if (updated == null) {
            return ResponseEntity.status(404).body(error(404, "EMPLOYEE_NOT_FOUND", "Employee not found"));
        }
        return ResponseEntity.ok(updated);
    }

    private Map<String, Object> error(int status, String code, String message) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", status);
        body.put("code", code);
        body.put("message", message);
        return body;
    }
}
