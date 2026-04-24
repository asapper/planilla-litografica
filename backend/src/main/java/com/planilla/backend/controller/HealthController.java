package com.planilla.backend.controller;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class HealthController {

    private final JdbcTemplate postgresJdbc;

    public HealthController(@Qualifier("postgresJdbcTemplate") JdbcTemplate postgresJdbc) {
        this.postgresJdbc = postgresJdbc;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    @GetMapping("/db-health")
    public ResponseEntity<Map<String, String>> dbHealth() {
        try {
            postgresJdbc.queryForObject("SELECT 1", Integer.class);
            return ResponseEntity.ok(Map.of("status", "ok"));
        } catch (Exception e) {
            return ResponseEntity.status(503).body(Map.of("status", "error"));
        }
    }
}
