package com.planilla.backend.controller;

import com.planilla.backend.service.CsvParserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration-slice tests for UploadController.
 *
 * Requirements:
 * - POST /api/upload accepts multipart CSV file
 * - Returns 400 when file is empty
 * - Returns 400 when file is not a .csv
 * - Returns 200 with rows, monthOptions, multiMonth, parseWarnings on success
 * - Returns 400 with error body when parser throws
 */
@WebMvcTest(UploadController.class)
class UploadControllerTest {

    @Autowired MockMvc mvc;

    @MockBean CsvParserService csvParserService;

    private MockMultipartFile csv(String name, byte[] content) {
        return new MockMultipartFile("file", name, "text/csv", content);
    }

    @Test
    void emptyFileReturns400() throws Exception {
        MockMultipartFile empty = new MockMultipartFile("file", "planilla.csv", "text/csv", new byte[0]);
        mvc.perform(multipart("/api/upload").file(empty))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("EMPTY_FILE"));
    }

    @Test
    void nonCsvFileReturns400() throws Exception {
        MockMultipartFile txt = new MockMultipartFile("file", "planilla.txt", "text/plain", "data".getBytes());
        mvc.perform(multipart("/api/upload").file(txt))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_FORMAT"));
    }

    @Test
    void validCsvReturns200WithExpectedShape() throws Exception {
        com.planilla.backend.model.EmployeeRow row = new com.planilla.backend.model.EmployeeRow();
        row.setCodigoEmpleado("1");
        row.setNombreEmpleado("Ana");
        row.setMes(12);
        row.setAnio(2024);

        CsvParserService.ParseResult parseResult = new CsvParserService.ParseResult(
            List.of(row),
            List.of(),
            List.of(new int[]{12, 2024})
        );

        when(csvParserService.parse(any())).thenReturn(parseResult);

        MockMultipartFile file = csv("planilla.csv", "content".getBytes());
        mvc.perform(multipart("/api/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rows").isArray())
           .andExpect(jsonPath("$.rows[0].codigoEmpleado").value("1"))
           .andExpect(jsonPath("$.monthOptions").isArray())
           .andExpect(jsonPath("$.monthOptions[0].mes").value(12))
           .andExpect(jsonPath("$.multiMonth").value(false))
           .andExpect(jsonPath("$.parseWarnings").isArray());
    }

    @Test
    void multiMonthFileSetsMultiMonthTrue() throws Exception {
        com.planilla.backend.model.EmployeeRow row1 = new com.planilla.backend.model.EmployeeRow();
        row1.setCodigoEmpleado("1"); row1.setMes(11); row1.setAnio(2024);
        com.planilla.backend.model.EmployeeRow row2 = new com.planilla.backend.model.EmployeeRow();
        row2.setCodigoEmpleado("2"); row2.setMes(12); row2.setAnio(2024);

        CsvParserService.ParseResult parseResult = new CsvParserService.ParseResult(
            List.of(row1, row2),
            List.of(),
            List.of(new int[]{11, 2024}, new int[]{12, 2024})
        );

        when(csvParserService.parse(any())).thenReturn(parseResult);

        MockMultipartFile file = csv("planilla.csv", "content".getBytes());
        mvc.perform(multipart("/api/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.multiMonth").value(true))
           .andExpect(jsonPath("$.monthOptions.length()").value(2));
    }

    @Test
    void parserExceptionReturns400WithParseError() throws Exception {
        when(csvParserService.parse(any())).thenThrow(new Exception("No se encontraron registros"));

        MockMultipartFile file = csv("planilla.csv", "bad".getBytes());
        mvc.perform(multipart("/api/upload").file(file))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("PARSE_ERROR"))
           .andExpect(jsonPath("$.message").value("No se encontraron registros"));
    }

    @Test
    void emptyDistinctMonthsProducesEmptyMonthOptions() throws Exception {
        // ParseResult with rows but empty distinctMonths — the for-loop body never executes
        com.planilla.backend.model.EmployeeRow row = new com.planilla.backend.model.EmployeeRow();
        row.setCodigoEmpleado("1"); row.setMes(12); row.setAnio(2024);

        CsvParserService.ParseResult parseResult = new CsvParserService.ParseResult(
            List.of(row),
            List.of(),
            List.of()  // empty distinctMonths
        );
        when(csvParserService.parse(any())).thenReturn(parseResult);

        MockMultipartFile file = csv("planilla.csv", "content".getBytes());
        mvc.perform(multipart("/api/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.monthOptions").isArray())
           .andExpect(jsonPath("$.monthOptions.length()").value(0))
           .andExpect(jsonPath("$.multiMonth").value(false));
    }

    @Test
    void nullOriginalFilenameReturns400() throws Exception {
        // MockMultipartFile accepts null as originalFilename
        MockMultipartFile noName = new MockMultipartFile("file", null, "text/csv", "data".getBytes());
        mvc.perform(multipart("/api/upload").file(noName))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_FORMAT"));
    }

    @Test
    void parseWarningsIncludedInResponse() throws Exception {
        com.planilla.backend.model.EmployeeRow row = new com.planilla.backend.model.EmployeeRow();
        row.setCodigoEmpleado("1"); row.setMes(12); row.setAnio(2024);

        CsvParserService.ParseResult parseResult = new CsvParserService.ParseResult(
            List.of(row),
            List.of("Fila de resumen encontrada sin bloque de empleado previo. Línea ignorada."),
            List.of(new int[]{12, 2024})
        );

        when(csvParserService.parse(any())).thenReturn(parseResult);

        MockMultipartFile file = csv("planilla.csv", "content".getBytes());
        mvc.perform(multipart("/api/upload").file(file))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.parseWarnings[0]").value(
               "Fila de resumen encontrada sin bloque de empleado previo. Línea ignorada."));
    }
}
