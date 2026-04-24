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

import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration-slice tests for SubmitController.
 *
 * Requirements:
 * - POST /api/submit accepts JSON array of EmployeeRow
 * - Runs final server-side validation; returns 400 if any row is invalid
 * - For each valid row: checks duplicate → skips if duplicate, submits otherwise
 * - On ConnectException/SocketTimeoutException/etc: sets dbUnreachable=true,
 *   short-circuits remaining rows with "no disponible" error
 * - Non-connection exception: single row failure, continues to next row
 * - Response includes totalSubmitted, totalSkippedDuplicates, totalFailed, rows[]
 */
@WebMvcTest(SubmitController.class)
class SubmitControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @MockBean ValidationService validationService;
    @MockBean DatabaseService databaseService;

    // -----------------------------------------------------------------
    // Fake exception classes whose simple names contain the checked substrings
    // so that isConnectionError() identifies them by class name
    // -----------------------------------------------------------------
    static class FakeSQLTransientConnectionException extends RuntimeException {
        FakeSQLTransientConnectionException(String msg) { super(msg); }
    }
    static class FakeCommunicationsException extends RuntimeException {
        FakeCommunicationsException(String msg) { super(msg); }
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

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

    private RowValidationResult valid(String codigo) {
        return new RowValidationResult(codigo);
    }

    private RowValidationResult invalid(String codigo) {
        RowValidationResult r = new RowValidationResult(codigo);
        r.addError("mes", "El valor máximo permitido es 12.");
        return r;
    }

    private String json(Object o) throws Exception {
        return mapper.writeValueAsString(o);
    }

    // -----------------------------------------------------------------
    // Validation guard
    // -----------------------------------------------------------------

    @Test
    void invalidRowsReturn400ValidationFailed() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(invalid("1")));

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        verifyNoInteractions(databaseService);
    }

    @Test
    void mixedValidInvalidRowsReturn400() throws Exception {
        when(validationService.validate(any()))
            .thenReturn(List.of(valid("1"), invalid("2")));

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1"), row("2")))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    // -----------------------------------------------------------------
    // Happy path — submitted
    // -----------------------------------------------------------------

    @Test
    void allValidNonDuplicateRowsAreSubmitted() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1"), valid("2")));
        when(databaseService.isDuplicate(any())).thenReturn(false);

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1"), row("2")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.totalSubmitted").value(2))
           .andExpect(jsonPath("$.totalSkippedDuplicates").value(0))
           .andExpect(jsonPath("$.totalFailed").value(0));

        verify(databaseService, times(2)).submitRow(any());
    }

    @Test
    void rowMarkedSubmittedTrueInResponse() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1")));
        when(databaseService.isDuplicate(any())).thenReturn(false);

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rows[0].submitted").value(true))
           .andExpect(jsonPath("$.rows[0].skippedDuplicate").value(false));
    }

    // -----------------------------------------------------------------
    // Duplicate skipping
    // -----------------------------------------------------------------

    @Test
    void duplicateRowsAreSkippedNotSubmitted() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1")));
        when(databaseService.isDuplicate(any())).thenReturn(true);

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.totalSubmitted").value(0))
           .andExpect(jsonPath("$.totalSkippedDuplicates").value(1))
           .andExpect(jsonPath("$.rows[0].skippedDuplicate").value(true));

        verify(databaseService, never()).submitRow(any());
    }

    @Test
    void mixedDuplicateAndFreshRowsHandledCorrectly() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1"), valid("2")));
        when(databaseService.isDuplicate(any()))
            .thenReturn(true)   // row "1" is duplicate
            .thenReturn(false); // row "2" is fresh

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1"), row("2")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.totalSubmitted").value(1))
           .andExpect(jsonPath("$.totalSkippedDuplicates").value(1));
    }

    // -----------------------------------------------------------------
    // Connection error — short-circuit
    // -----------------------------------------------------------------

    @Test
    void connectExceptionSetsDbUnreachableAndShortCircuits() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1"), valid("2"), valid("3")));
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("pool", new ConnectException("Connection refused")))
            .thenReturn(false); // should never be called for rows 2+

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1"), row("2"), row("3")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.totalFailed").value(3))
           .andExpect(jsonPath("$.totalSubmitted").value(0))
           .andExpect(jsonPath("$.rows[0].error").value("Base de datos remota no disponible."))
           .andExpect(jsonPath("$.rows[1].error").value("Base de datos remota no disponible."))
           .andExpect(jsonPath("$.rows[2].error").value("Base de datos remota no disponible."));

        // isDuplicate should only have been called once (short-circuit after first failure)
        verify(databaseService, times(1)).isDuplicate(any());
    }

    @Test
    void socketTimeoutExceptionIsConnectionError() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1")));
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("pool", new SocketTimeoutException("timed out")));

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rows[0].error").value("Base de datos remota no disponible."));
    }

    @Test
    void noRouteToHostExceptionIsConnectionError() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1")));
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("pool", new NoRouteToHostException("no route")));

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rows[0].error").value("Base de datos remota no disponible."));
    }

    @Test
    void sqlTransientConnectionExceptionIsConnectionError() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1")));
        when(databaseService.isDuplicate(any()))
            .thenThrow(new FakeSQLTransientConnectionException("pool timeout"));

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rows[0].error").value("Base de datos remota no disponible."));
    }

    @Test
    void communicationsExceptionIsConnectionError() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1")));
        when(databaseService.isDuplicate(any()))
            .thenThrow(new FakeCommunicationsException("comms failure"));

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rows[0].error").value("Base de datos remota no disponible."));
    }

    @Test
    void wrappedConnectExceptionInCauseChainIsConnectionError() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1")));
        RuntimeException wrapper = new RuntimeException("outer",
            new RuntimeException("middle", new ConnectException("inner connect")));
        when(databaseService.isDuplicate(any())).thenThrow(wrapper);

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rows[0].error").value("Base de datos remota no disponible."));
    }

    // -----------------------------------------------------------------
    // Non-connection exception — no short-circuit
    // -----------------------------------------------------------------

    @Test
    void nonConnectionExceptionFailsSingleRowAndContinues() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("1"), valid("2")));
        when(databaseService.isDuplicate(any()))
            .thenThrow(new RuntimeException("some DB error"))  // row 1 fails
            .thenReturn(false);                                // row 2 succeeds

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("1"), row("2")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.totalFailed").value(1))
           .andExpect(jsonPath("$.totalSubmitted").value(1))
           .andExpect(jsonPath("$.rows[0].error").value("Error al procesar el registro."))
           .andExpect(jsonPath("$.rows[1].submitted").value(true));

        // Both rows should have been attempted (no short-circuit)
        verify(databaseService, times(2)).isDuplicate(any());
    }

    // -----------------------------------------------------------------
    // Response shape
    // -----------------------------------------------------------------

    @Test
    void responseContainsCodigoEmpleadoPerRow() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of(valid("99")));
        when(databaseService.isDuplicate(any())).thenReturn(false);

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of(row("99")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rows[0].codigoEmpleado").value("99"));
    }

    @Test
    void emptyRowListReturnsZeroTotals() throws Exception {
        when(validationService.validate(any())).thenReturn(List.of());

        mvc.perform(post("/api/submit")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(List.of())))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.totalSubmitted").value(0))
           .andExpect(jsonPath("$.totalSkippedDuplicates").value(0))
           .andExpect(jsonPath("$.totalFailed").value(0));
    }
}
