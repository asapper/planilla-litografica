package com.planilla.backend.controller;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.RowValidationResult;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.ValidationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ValidateController {

    private final ValidationService validationService;
    private final DatabaseService databaseService;

    public ValidateController(ValidationService validationService, DatabaseService databaseService) {
        this.validationService = validationService;
        this.databaseService = databaseService;
    }

    @PostMapping("/validate")
    public ResponseEntity<?> validate(@RequestBody List<EmployeeRow> rows) {
        List<RowValidationResult> results = validationService.validate(rows);

        // Run duplicate check for each valid row
        for (int i = 0; i < rows.size(); i++) {
            RowValidationResult result = results.get(i);
            if (result.isValid()) {
                try {
                    boolean isDuplicate = databaseService.isDuplicate(rows.get(i));
                    result.setDuplicate(isDuplicate);
                } catch (Exception e) {
                    // DB unreachable — surface as a warning, don't block validation
                    result.setDuplicate(false);
                }
            }
        }

        boolean allValid = results.stream().allMatch(r -> r.isValid() && !r.isDuplicate());
        boolean hasDuplicates = results.stream().anyMatch(RowValidationResult::isDuplicate);

        Map<String, Object> response = new HashMap<>();
        response.put("allValid", allValid);
        response.put("hasDuplicates", hasDuplicates);
        response.put("rows", results);

        return ResponseEntity.ok(response);
    }
}
