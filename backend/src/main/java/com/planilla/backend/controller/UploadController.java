package com.planilla.backend.controller;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.service.CsvParserService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class UploadController {

    private final CsvParserService csvParserService;

    public UploadController(CsvParserService csvParserService) {
        this.csvParserService = csvParserService;
    }

    @PostMapping("/upload")
    public ResponseEntity<?> upload(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(error(400, "EMPTY_FILE", "El archivo está vacío."));
        }

        String filename = file.getOriginalFilename();
        if (filename == null || !filename.toLowerCase().endsWith(".csv")) {
            return ResponseEntity.badRequest().body(error(400, "INVALID_FORMAT", "Solo se aceptan archivos CSV."));
        }

        try {
            CsvParserService.ParseResult result = csvParserService.parse(file);

            // Build distinct month options for the UI
            List<Map<String, Integer>> monthOptions = new ArrayList<>();
            for (int[] pair : result.distinctMonths) {
                Map<String, Integer> option = new HashMap<>();
                option.put("mes", pair[0]);
                option.put("anio", pair[1]);
                monthOptions.add(option);
            }

            Map<String, Object> response = new HashMap<>();
            response.put("rows", result.rows);
            response.put("monthOptions", monthOptions);
            response.put("multiMonth", monthOptions.size() > 1);
            response.put("parseWarnings", result.warnings);

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            return ResponseEntity.badRequest().body(
                error(400, "PARSE_ERROR", e.getMessage())
            );
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
