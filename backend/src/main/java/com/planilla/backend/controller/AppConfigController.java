package com.planilla.backend.controller;

import com.planilla.backend.service.tas.AppConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/config/general")
public class AppConfigController {

    private static final Logger log = LoggerFactory.getLogger(AppConfigController.class);

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
                if (minutes < 0) {
                    return ResponseEntity.badRequest().body(
                        error(400, "INVALID_VALUE", "legalBreakAllowanceMinutes debe ser ≥ 0."));
                }
                appConfigService.setLegalBreakAllowanceMinutes(minutes);
            }
            if (body.containsKey("maxSessionSpanMinutes")) {
                int minutes = ((Number) body.get("maxSessionSpanMinutes")).intValue();
                if (minutes < 60) {
                    return ResponseEntity.badRequest().body(
                        error(400, "INVALID_VALUE", "maxSessionSpanMinutes debe ser ≥ 60."));
                }
                appConfigService.setMaxSessionSpanMinutes(minutes);
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("Failed to update app config", e);
            return ResponseEntity.badRequest().body(error(400, "UPDATE_FAILED", "No se pudo actualizar la configuración."));
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
