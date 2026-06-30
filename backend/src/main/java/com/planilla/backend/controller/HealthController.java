package com.planilla.backend.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class HealthController implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    private final JdbcTemplate postgresJdbc;

    public HealthController(@Qualifier("postgresJdbcTemplate") JdbcTemplate postgresJdbc) {
        this.postgresJdbc = postgresJdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            postgresJdbc.queryForObject("SELECT 1", Integer.class);
            log.info("PostgreSQL connectivity check passed.");
        } catch (Exception e) {
            log.warn("PostgreSQL is unreachable at startup — submissions will fail until the database is available: {}", e.getMessage());
        }
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
