package com.planilla.backend.controller;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.RowValidationResult;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.ValidationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class JobController {

    private final ValidationService validationService;
    private final JobService jobService;

    public JobController(ValidationService validationService, JobService jobService) {
        this.validationService = validationService;
        this.jobService = jobService;
    }

    @PostMapping("/submit")
    public ResponseEntity<?> submit(@RequestBody List<EmployeeRow> rows) {
        List<RowValidationResult> validationResults = validationService.validate(rows);
        boolean anyInvalid = validationResults.stream().anyMatch(r -> !r.isValid());
        if (anyInvalid) {
            return ResponseEntity.badRequest().body(Map.of(
                "status", 400,
                "code", "VALIDATION_FAILED",
                "message", "Hay filas con errores de validación. Por favor corrígelas antes de enviar."
            ));
        }

        String jobId = jobService.createJob(rows);
        jobService.processJob(jobId);

        return ResponseEntity.accepted().body(Map.of("jobId", jobId, "status", "PENDING"));
    }

    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<?> getJob(@PathVariable String jobId) {
        return jobService.getJobResponse(jobId)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/jobs/{jobId}/retry")
    public ResponseEntity<?> retry(@PathVariable String jobId) {
        try {
            String newJobId = jobService.retryJob(jobId);
            jobService.processJob(newJobId);
            return ResponseEntity.accepted().body(Map.of("jobId", newJobId, "status", "PENDING"));
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of(
                "code", "RETRY_NOT_ALLOWED",
                "message", e.getMessage()
            ));
        }
    }
}
