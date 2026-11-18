package com.planilla.backend.controller;

import com.planilla.backend.service.ApplicationExiter;
import com.planilla.backend.service.JobService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

/**
 * Lets the desktop shell stop the backend gracefully on close. The shell passes a per-launch
 * secret in PLANILLA_SHUTDOWN_TOKEN; without it (dev, tests) the endpoint doesn't exist. The
 * custom header also keeps a web page in the user's browser from triggering it.
 */
@RestController
@RequestMapping("/api/system")
public class ShutdownController {

    public static final String TOKEN_HEADER = "X-Shutdown-Token";

    private static final Logger log = LoggerFactory.getLogger(ShutdownController.class);

    private final ApplicationExiter exiter;
    private final JobService jobService;
    private final byte[] token;

    public ShutdownController(ApplicationExiter exiter, JobService jobService,
                              @Value("${PLANILLA_SHUTDOWN_TOKEN:}") String token) {
        this.exiter = exiter;
        this.jobService = jobService;
        this.token = token.getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/shutdown")
    public ResponseEntity<?> shutdown(@RequestHeader(value = TOKEN_HEADER, required = false) String provided) {
        if (token.length == 0) {
            return ResponseEntity.notFound().build();
        }
        if (provided == null || !MessageDigest.isEqual(token, provided.getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.status(403).body(Map.of("code", "FORBIDDEN", "message", "No autorizado."));
        }
        // Stopping mid-batch would leave payroll rows half-sent with no partial-submit mark.
        if (!jobService.beginShutdown()) {
            return ResponseEntity.status(409).body(Map.of("code", "JOB_IN_PROGRESS",
                    "message", "Hay un envío en curso. Espere a que termine para cerrar."));
        }
        log.info("Shutdown requested by the desktop shell; closing the application.");
        exiter.exitSoon();
        return ResponseEntity.accepted().build();
    }
}
