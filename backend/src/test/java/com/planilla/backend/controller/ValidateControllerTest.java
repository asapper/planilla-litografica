package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.RowValidationResult;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.ValidationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration-slice tests for ValidateController.
 *
 * Requirements:
 * - POST /api/validate accepts JSON array of EmployeeRow
 * - Runs field validation via ValidationService
 * - Runs duplicate check via DatabaseService for each valid row
 * - If DB is unreachable (exception), duplicate check degrades gracefully (false)
 * - Response: { allValid, hasDuplicates, rows[] }
 * - allValid=true only when all rows valid AND no duplicates
 * - hasDuplicates=true when any row is flagged as duplicate
 */
@WebMvcTest(ValidateController.class)
class ValidateControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @MockBean ValidationService validationService;
    @MockBean DatabaseService databaseService;

    private EmployeeRow row(String codigo) {
        EmployeeRow r = new EmployeeRow();
        r.setCodigoEmpleado(codigo);
        r.setNombreEmpleado("Test");
        r.setDiasNoLaborados(0);
        r.setHorasExtrasSimples(0);
        r.setHorasExtrasDobles(0);
        r.setNumeroDequincena(1);
        r.setMes(12);
        r.setAnio(2024);
        return r;
    }

    @Test
    void allValidRowsWithNoDuplicatesReturnsAllValid() throws Exception {
        EmployeeRow r = row("1");
        RowValidationResult vr = new RowValidationResult("1"); // valid by default

        when(validationService.validate(any())).thenReturn(List.of(vr));
        when(databaseService.isDuplicate(any())).thenReturn(false);

        mvc.perform(post("/api/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(List.of(r))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.allValid").value(true))
           .andExpect(jsonPath("$.hasDuplicates").value(false))
           .andExpect(jsonPath("$.rows").isArray());
    }

    @Test
    void rowWithValidationErrorMakesAllValidFalse() throws Exception {
        EmployeeRow r = row("1");
        RowValidationResult vr = new RowValidationResult("1");
        vr.addError("numero_de_quincena", "El campo es obligatorio.");

        when(validationService.validate(any())).thenReturn(List.of(vr));

        mvc.perform(post("/api/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(List.of(r))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.allValid").value(false));
    }

    @Test
    void duplicateRowMakesAllValidFalseAndHasDuplicatesTrue() throws Exception {
        EmployeeRow r = row("1");
        RowValidationResult vr = new RowValidationResult("1");

        when(validationService.validate(any())).thenReturn(List.of(vr));
        when(databaseService.isDuplicate(any())).thenReturn(true);

        mvc.perform(post("/api/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(List.of(r))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.allValid").value(false))
           .andExpect(jsonPath("$.hasDuplicates").value(true));
    }

    @Test
    void databaseExceptionDegracefullyNoDuplicate() throws Exception {
        EmployeeRow r = row("1");
        RowValidationResult vr = new RowValidationResult("1");

        when(validationService.validate(any())).thenReturn(List.of(vr));
        when(databaseService.isDuplicate(any())).thenThrow(new RuntimeException("DB down"));

        mvc.perform(post("/api/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(List.of(r))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.hasDuplicates").value(false))
           .andExpect(jsonPath("$.allValid").value(true));
    }

    @Test
    void invalidRowSkipsDuplicateCheck() throws Exception {
        EmployeeRow r = row("1");
        RowValidationResult vr = new RowValidationResult("1");
        vr.addError("mes", "El valor máximo permitido es 12.");

        when(validationService.validate(any())).thenReturn(List.of(vr));
        // databaseService.isDuplicate should NOT be called — mock returns false by default

        mvc.perform(post("/api/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(List.of(r))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rows[0].duplicate").value(false));
    }

    @Test
    void mixedRowsReturnsCorrectAggregates() throws Exception {
        EmployeeRow r1 = row("1");
        EmployeeRow r2 = row("2");

        RowValidationResult vr1 = new RowValidationResult("1");
        RowValidationResult vr2 = new RowValidationResult("2");
        vr2.addError("dias_no_laborados", "El valor mínimo permitido es 0.");

        when(validationService.validate(any())).thenReturn(List.of(vr1, vr2));
        when(databaseService.isDuplicate(any())).thenReturn(false);

        mvc.perform(post("/api/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(List.of(r1, r2))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.allValid").value(false))
           .andExpect(jsonPath("$.hasDuplicates").value(false))
           .andExpect(jsonPath("$.rows.length()").value(2));
    }
}
