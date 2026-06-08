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

        try {
            employeeRegistryService.updateEmployee(id, shiftId, active);
            return ResponseEntity.ok().build();
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
            employeeRegistryService.setActive(id, false);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(error(400, "DEACTIVATE_FAILED", e.getMessage()));
        }
    }

    private Map<String, Object> error(int status, String code, String message) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", status);
        body.put("code", code);
        body.put("message", message);
        return body;
    }
}
