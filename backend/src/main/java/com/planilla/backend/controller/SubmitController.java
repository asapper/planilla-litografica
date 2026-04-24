package com.planilla.backend.controller;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.RowValidationResult;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.ValidationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class SubmitController {

    private static final Logger log = LoggerFactory.getLogger(SubmitController.class);

    private final ValidationService validationService;
    private final DatabaseService databaseService;

    public SubmitController(ValidationService validationService, DatabaseService databaseService) {
        this.validationService = validationService;
        this.databaseService = databaseService;
    }

    @PostMapping("/submit")
    public ResponseEntity<?> submit(@RequestBody List<EmployeeRow> rows) {
        // Final server-side validation before touching the DB
        List<RowValidationResult> validationResults = validationService.validate(rows);
        boolean anyInvalid = validationResults.stream().anyMatch(r -> !r.isValid());
        if (anyInvalid) {
            return ResponseEntity.badRequest().body(Map.of(
                "status", 400,
                "code", "VALIDATION_FAILED",
                "message", "Hay filas con errores de validación. Por favor corrígelas antes de enviar."
            ));
        }

        List<Map<String, Object>> rowResults = new ArrayList<>();
        int submitted = 0;
        int skippedDuplicates = 0;
        int failed = 0;
        boolean dbUnreachable = false;

        for (EmployeeRow row : rows) {
            Map<String, Object> rowResult = new HashMap<>();
            rowResult.put("codigoEmpleado", row.getCodigoEmpleado());

            if (dbUnreachable) {
                // Short-circuit: don't attempt another connection after the first failure
                rowResult.put("submitted", false);
                rowResult.put("skippedDuplicate", false);
                rowResult.put("error", "Base de datos remota no disponible.");
                failed++;
                rowResults.add(rowResult);
                continue;
            }

            try {
                if (databaseService.isDuplicate(row)) {
                    rowResult.put("submitted", false);
                    rowResult.put("skippedDuplicate", true);
                    skippedDuplicates++;
                    log.info("Fila duplicada omitida: empleado={} quincena={} mes={} anio={}",
                        row.getCodigoEmpleado(), row.getNumeroDequincena(), row.getMes(), row.getAnio());
                } else {
                    databaseService.submitRow(row);
                    rowResult.put("submitted", true);
                    rowResult.put("skippedDuplicate", false);
                    submitted++;
                    log.info("Fila enviada: empleado={} quincena={} mes={} anio={}",
                        row.getCodigoEmpleado(), row.getNumeroDequincena(), row.getMes(), row.getAnio());
                }
            } catch (Exception e) {
                rowResult.put("submitted", false);
                rowResult.put("skippedDuplicate", false);
                if (isConnectionError(e)) {
                    dbUnreachable = true;
                    rowResult.put("error", "Base de datos remota no disponible.");
                    log.warn("PostgreSQL no disponible, se omiten las filas restantes: {}", e.getMessage());
                } else {
                    rowResult.put("error", "Error al procesar el registro.");
                    log.error("Error al enviar fila empleado={}: {}", row.getCodigoEmpleado(), e.getMessage());
                }
                failed++;
            }

            rowResults.add(rowResult);
        }

        Map<String, Object> response = new HashMap<>();
        response.put("totalSubmitted", submitted);
        response.put("totalSkippedDuplicates", skippedDuplicates);
        response.put("totalFailed", failed);
        response.put("rows", rowResults);

        return ResponseEntity.ok(response);
    }

    /** True when the exception root cause is a network/connection problem. */
    private boolean isConnectionError(Exception e) {
        Throwable t = e;
        while (t != null) {
            String name = t.getClass().getName();
            if (t instanceof java.net.ConnectException
                    || t instanceof java.net.NoRouteToHostException
                    || t instanceof java.net.SocketTimeoutException
                    || name.contains("SQLTransientConnectionException")
                    || name.contains("CommunicationsException")) {
                return true;
            }
            t = t.getCause();
        }
        return false;
    }
}
