package com.planilla.backend.controller;

import com.planilla.backend.service.tas.AppConfigService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/config/general")
@CrossOrigin(origins = "*")
public class AppConfigController {

    private final AppConfigService appConfigService;

    public AppConfigController(AppConfigService appConfigService) {
        this.appConfigService = appConfigService;
    }

    @GetMapping
    public ResponseEntity<?> get() {
        Map<String, Object> response = new HashMap<>();
        response.put("legalBreakAllowanceMinutes", appConfigService.getLegalBreakAllowanceMinutes());
        response.put("maxSessionSpanMinutes", appConfigService.getMaxSessionSpanMinutes());
        return ResponseEntity.ok(response);
    }

    @PutMapping
    public ResponseEntity<?> update(@RequestBody Map<String, Object> body) {
        try {
            if (body.containsKey("legalBreakAllowanceMinutes")) {
                int minutes = ((Number) body.get("legalBreakAllowanceMinutes")).intValue();
                appConfigService.setLegalBreakAllowanceMinutes(minutes);
            }
            if (body.containsKey("maxSessionSpanMinutes")) {
                int minutes = ((Number) body.get("maxSessionSpanMinutes")).intValue();
                appConfigService.setMaxSessionSpanMinutes(minutes);
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(error(400, "UPDATE_FAILED", e.getMessage()));
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
