package com.planilla.backend.service;

import com.planilla.backend.config.ValidationRulesConfig;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.RowValidationResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for ValidationService.
 *
 * Rules under test (from validation-rules.json):
 * - codigo_empleado: required, string (non-empty)
 * - dias_no_laborados: required, integer, min=0
 * - horas_extras_simples: required, integer, min=0
 * - horas_extras_dobles: required, integer, min=0
 * - numero_de_quincena: required, integer, min=1, max=2
 * - mes: required, integer, min=1, max=12
 * - anio: required, integer, min=2000, max=2100
 */
class ValidationServiceTest {

    private ValidationService service;

    @BeforeEach
    void setUp() throws Exception {
        service = new ValidationService(new ValidationRulesConfig());
    }

    // -----------------------------------------------------------------
    // Helper
    // -----------------------------------------------------------------

    private EmployeeRow validRow() {
        EmployeeRow r = new EmployeeRow();
        r.setCodigoEmpleado("42");
        r.setNombreEmpleado("Juan Pérez");
        r.setDiasNoLaborados(1);
        r.setHorasExtrasSimples(0);
        r.setHorasExtrasDobles(0);
        r.setNumeroDequincena(1);
        r.setMes(12);
        r.setAnio(2024);
        return r;
    }

    private RowValidationResult validateSingle(EmployeeRow row) {
        return service.validate(List.of(row)).get(0);
    }

    // -----------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------

    @Test
    void validRowPassesValidation() {
        RowValidationResult result = validateSingle(validRow());
        assertThat(result.isValid()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    void codigoEmpleadoIsPreservedInResult() {
        RowValidationResult result = validateSingle(validRow());
        assertThat(result.getCodigoEmpleado()).isEqualTo("42");
    }

    // -----------------------------------------------------------------
    // numero_de_quincena
    // -----------------------------------------------------------------

    @Test
    void missingQuincenaFailsValidation() {
        EmployeeRow row = validRow();
        row.setNumeroDequincena(null);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("numero_de_quincena"));
    }

    @Test
    void quincena1IsValid() {
        EmployeeRow row = validRow();
        row.setNumeroDequincena(1);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    @Test
    void quincena2IsValid() {
        EmployeeRow row = validRow();
        row.setNumeroDequincena(2);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    @Test
    void quincena0FailsMinConstraint() {
        EmployeeRow row = validRow();
        row.setNumeroDequincena(0);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("numero_de_quincena"));
    }

    @Test
    void quincena3FailsMaxConstraint() {
        EmployeeRow row = validRow();
        row.setNumeroDequincena(3);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("numero_de_quincena"));
    }

    // -----------------------------------------------------------------
    // dias_no_laborados
    // -----------------------------------------------------------------

    @Test
    void diasNoLaboradosZeroIsValid() {
        EmployeeRow row = validRow();
        row.setDiasNoLaborados(0);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    @Test
    void diasNoLaboradosNegativeFailsMinConstraint() {
        EmployeeRow row = validRow();
        row.setDiasNoLaborados(-1);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("dias_no_laborados"));
    }

    // -----------------------------------------------------------------
    // horas_extras
    // -----------------------------------------------------------------

    @Test
    void negativeHorasExtrasSimplesFails() {
        EmployeeRow row = validRow();
        row.setHorasExtrasSimples(-1);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("horas_extras_simples"));
    }

    @Test
    void negativeHorasExtrasDoblesFailsv() {
        EmployeeRow row = validRow();
        row.setHorasExtrasDobles(-5);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("horas_extras_dobles"));
    }

    // -----------------------------------------------------------------
    // mes
    // -----------------------------------------------------------------

    @Test
    void mes0FailsMinConstraint() {
        EmployeeRow row = validRow();
        row.setMes(0);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("mes"));
    }

    @Test
    void mes13FailsMaxConstraint() {
        EmployeeRow row = validRow();
        row.setMes(13);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("mes"));
    }

    @Test
    void mes1IsValid() {
        EmployeeRow row = validRow();
        row.setMes(1);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    @Test
    void mes12IsValid() {
        EmployeeRow row = validRow();
        row.setMes(12);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    // -----------------------------------------------------------------
    // anio
    // -----------------------------------------------------------------

    @Test
    void anio1999FailsMinConstraint() {
        EmployeeRow row = validRow();
        row.setAnio(1999);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("anio"));
    }

    @Test
    void anio2101FailsMaxConstraint() {
        EmployeeRow row = validRow();
        row.setAnio(2101);
        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("anio"));
    }

    @Test
    void anio2000IsValid() {
        EmployeeRow row = validRow();
        row.setAnio(2000);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    // -----------------------------------------------------------------
    // Multiple rows
    // -----------------------------------------------------------------

    @Test
    void validateReturnsResultPerRow() {
        EmployeeRow good = validRow();
        EmployeeRow bad  = validRow();
        bad.setNumeroDequincena(null);

        List<RowValidationResult> results = service.validate(List.of(good, bad));
        assertThat(results).hasSize(2);
        assertThat(results.get(0).isValid()).isTrue();
        assertThat(results.get(1).isValid()).isFalse();
    }

    @Test
    void multipleErrorsAccumulatedOnSingleRow() {
        EmployeeRow row = validRow();
        row.setNumeroDequincena(null);
        row.setDiasNoLaborados(-1);

        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).hasSizeGreaterThanOrEqualTo(2);
    }

    // -----------------------------------------------------------------
    // Branch coverage: required string field — blank codigo triggers required error
    // -----------------------------------------------------------------

    @Test
    void blankCodigoEmpleadoTriggersRequiredError() {
        EmployeeRow row = validRow();
        row.setCodigoEmpleado("");

        RowValidationResult result = validateSingle(row);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getField().equals("codigo_empleado"));
    }

    // -----------------------------------------------------------------
    // Branch coverage: fields at exactly the allowed boundary values
    // -----------------------------------------------------------------

    @Test
    void anio2100IsValid() {
        EmployeeRow row = validRow();
        row.setAnio(2100);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    @Test
    void diasNoLaboradosLargePositiveIsValid() {
        EmployeeRow row = validRow();
        row.setDiasNoLaborados(31);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    @Test
    void horasExtrasSimplesZeroIsValid() {
        EmployeeRow row = validRow();
        row.setHorasExtrasSimples(0);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    @Test
    void horasExtrasDoblesZeroIsValid() {
        EmployeeRow row = validRow();
        row.setHorasExtrasDobles(0);
        assertThat(validateSingle(row).isValid()).isTrue();
    }

    // -----------------------------------------------------------------
    // Branch coverage: FieldError getters
    // -----------------------------------------------------------------

    @Test
    void fieldErrorGettersReturnCorrectValues() {
        RowValidationResult.FieldError e = new RowValidationResult.FieldError("mes", "bad value");
        assertThat(e.getField()).isEqualTo("mes");
        assertThat(e.getMessage()).isEqualTo("bad value");
    }
}
