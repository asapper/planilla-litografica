package com.planilla.backend.controller;

import com.planilla.backend.service.tas.ShiftConfigService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/config/shifts")
@CrossOrigin(origins = "*")
public class ShiftConfigController {

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
        String id = (String) body.get("id");
        String name = (String) body.get("name");
        String startTime = (String) body.get("startTime");
        String endTime = (String) body.get("endTime");
        Boolean crossMidnight = body.containsKey("crossMidnight") ? (Boolean) body.get("crossMidnight") : false;

        try {
            shiftConfigService.createShift(id, name, startTime, endTime, crossMidnight != null && crossMidnight);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(error(400, "CREATE_FAILED", e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable String id, @RequestBody Map<String, Object> body) {
        String name = (String) body.get("name");
        String startTime = (String) body.get("startTime");
        String endTime = (String) body.get("endTime");
        Boolean crossMidnight = body.containsKey("crossMidnight") ? (Boolean) body.get("crossMidnight") : false;

        try {
            shiftConfigService.updateShift(id, name, startTime, endTime, crossMidnight != null && crossMidnight);
            return ResponseEntity.ok().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(error(404, e.getMessage(), "Shift not found"));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(error(400, "UPDATE_FAILED", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id) {
        try {
            shiftConfigService.deleteShift(id);
            return ResponseEntity.ok().build();
        } catch (IllegalStateException e) {
            Map<String, Object> body = new HashMap<>();
            body.put("error", e.getMessage());
            return ResponseEntity.status(409).body(body);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(error(400, "DELETE_FAILED", e.getMessage()));
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
