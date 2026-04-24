package com.planilla.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.planilla.backend.config.ValidationRulesConfig;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.RowValidationResult;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class ValidationService {

    private final ValidationRulesConfig rulesConfig;

    public ValidationService(ValidationRulesConfig rulesConfig) {
        this.rulesConfig = rulesConfig;
    }

    public List<RowValidationResult> validate(List<EmployeeRow> rows) {
        List<RowValidationResult> results = new ArrayList<>();
        for (EmployeeRow row : rows) {
            results.add(validateRow(row));
        }
        return results;
    }

    private RowValidationResult validateRow(EmployeeRow row) {
        RowValidationResult result = new RowValidationResult(row.getCodigoEmpleado());

        Map<String, Object> fieldValues = Map.of(
            "codigo_empleado",       row.getCodigoEmpleado(),
            "dias_no_laborados",     row.getDiasNoLaborados(),
            "horas_extras_simples",  row.getHorasExtrasSimples(),
            "horas_extras_dobles",   row.getHorasExtrasDobles(),
            "numero_de_quincena",    row.getNumeroDequincena() != null ? row.getNumeroDequincena() : -1,
            "mes",                   row.getMes(),
            "anio",                  row.getAnio()
        );

        fieldValues.forEach((fieldName, value) -> {
            JsonNode rules = rulesConfig.getFieldRules(fieldName);
            if (rules.isMissingNode()) return;

            // required check
            if (rules.path("required").asBoolean(false)) {
                if (value == null || value.toString().isBlank() || value.equals(-1)) {
                    result.addError(fieldName, "El campo es obligatorio.");
                    return;
                }
            }

            // type + range checks for integers
            if ("integer".equals(rules.path("type").asText())) {
                int intVal;
                try { intVal = Integer.parseInt(value.toString()); }
                catch (NumberFormatException e) {
                    result.addError(fieldName, "Debe ser un número entero.");
                    return;
                }

                if (!rules.path("min").isMissingNode() && intVal < rules.path("min").asInt()) {
                    result.addError(fieldName,
                        "El valor mínimo permitido es " + rules.path("min").asInt() + ".");
                }
                if (!rules.path("max").isMissingNode() && intVal > rules.path("max").asInt()) {
                    result.addError(fieldName,
                        "El valor máximo permitido es " + rules.path("max").asInt() + ".");
                }
            }

            // string non-empty check
            if ("string".equals(rules.path("type").asText())) {
                if (value == null || value.toString().isBlank()) {
                    result.addError(fieldName, "El campo no puede estar vacío.");
                }
            }
        });

        return result;
    }
}
