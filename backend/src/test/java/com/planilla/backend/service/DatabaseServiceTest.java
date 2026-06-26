package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Collections;
import java.util.List;

import org.mockito.ArgumentCaptor;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for DatabaseService.
 *
 * Requirements:
 * - isDuplicate: queries H2 log by codigo, quincena, mes, anio → true when count > 0
 * - submitRow: calls stored procedure on Postgres, then inserts into H2 log
 * - Both operations use the correct JdbcTemplate (postgres vs h2)
 */
@ExtendWith(MockitoExtension.class)
class DatabaseServiceTest {

    @Mock JdbcTemplate postgresJdbc;
    @Mock JdbcTemplate h2Jdbc;

    DatabaseService service;

    @BeforeEach
    void setUp() {
        service = new DatabaseService(postgresJdbc, h2Jdbc, false);
    }

    private DatabaseService demoService() {
        return new DatabaseService(postgresJdbc, h2Jdbc, true);
    }

    private EmployeeRow row(String codigo, int quincena, int mes, int anio) {
        EmployeeRow r = new EmployeeRow();
        r.setCodigoEmpleado(codigo);
        r.setNombreEmpleado("Test");
        r.setDiasNoLaborados(0);
        r.setHorasExtrasSimples(0);
        r.setHorasExtrasDobles(0);
        r.setNumeroDequincena(quincena);
        r.setMes(mes);
        r.setAnio(anio);
        return r;
    }

    // -----------------------------------------------------------------
    // isDuplicate
    // -----------------------------------------------------------------

    @Test
    void isDuplicate_returnsTrueWhenCountAboveZero() {
        when(h2Jdbc.queryForObject(anyString(), eq(Integer.class), any(), any(), any(), any()))
            .thenReturn(1);

        assertThat(service.isDuplicate(row("42", 1, 12, 2024))).isTrue();
    }

    @Test
    void isDuplicate_returnsFalseWhenCountIsZero() {
        when(h2Jdbc.queryForObject(anyString(), eq(Integer.class), any(), any(), any(), any()))
            .thenReturn(0);

        assertThat(service.isDuplicate(row("42", 1, 12, 2024))).isFalse();
    }

    @Test
    void isDuplicate_returnsFalseWhenCountIsNull() {
        when(h2Jdbc.queryForObject(anyString(), eq(Integer.class), any(), any(), any(), any()))
            .thenReturn(null);

        assertThat(service.isDuplicate(row("42", 1, 12, 2024))).isFalse();
    }

    @Test
    void isDuplicate_queriesH2NotPostgres() {
        when(h2Jdbc.queryForObject(anyString(), eq(Integer.class), any(), any(), any(), any()))
            .thenReturn(0);

        service.isDuplicate(row("42", 1, 12, 2024));

        verify(h2Jdbc).queryForObject(anyString(), eq(Integer.class), any(), any(), any(), any());
        verifyNoInteractions(postgresJdbc);
    }

    @Test
    void isDuplicate_passesCorrectParametersToQuery() {
        when(h2Jdbc.queryForObject(anyString(), eq(Integer.class), any(), any(), any(), any()))
            .thenReturn(0);

        service.isDuplicate(row("99", 2, 7, 2023));

        verify(h2Jdbc).queryForObject(
            anyString(),
            eq(Integer.class),
            eq("99"), eq(2), eq(7), eq(2023)
        );
    }

    // -----------------------------------------------------------------
    // submitRow
    // -----------------------------------------------------------------

    @Test
    void submitRow_callsStoredProcOnPostgres() {
        EmployeeRow r = row("10", 1, 12, 2024);
        r.setDiasNoLaborados(2);
        r.setHorasExtrasSimples(3.0);
        r.setHorasExtrasDobles(1.5);

        service.submitRow(r);

        verify(postgresJdbc).queryForObject(
            contains("SELECT public.carga_datos_empleados"),
            eq(Integer.class),
            eq("10"), eq(2), eq(3.0), eq(1.5), eq(1), eq(12), eq(2024)
        );
    }

    @Test
    void submitRow_sqlUsesNumericCastForOvertimeFields() {
        EmployeeRow r = row("10", 1, 12, 2024);
        r.setHorasExtrasSimples(0.5);
        r.setHorasExtrasDobles(1.5);

        ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
        service.submitRow(r);

        verify(postgresJdbc).queryForObject(
            sqlCaptor.capture(),
            eq(Integer.class),
            any(), any(), eq(0.5), eq(1.5), any(), any(), any()
        );
        // Positions 3 and 4 (horas_extras_simples, horas_extras_dobles) must be ::numeric,
        // not ::integer, so decimal values are not truncated at the SP boundary.
        String sql = sqlCaptor.getValue();
        int simplesPos = sql.indexOf("::numeric");
        int doblesPos  = sql.indexOf("::numeric", simplesPos + 1);
        assertThat(simplesPos).isGreaterThan(0);
        assertThat(doblesPos).isGreaterThan(simplesPos);
    }

    @Test
    void submitRow_insertsIntoH2LogAfterSuccess() {
        EmployeeRow r = row("10", 1, 12, 2024);

        service.submitRow(r);

        verify(h2Jdbc).update(
            contains("INSERT INTO carga_log"),
            eq("10"), eq(1), eq(12), eq(2024)
        );
    }

    @Test
    void submitRow_writesToBothDatabases() {
        service.submitRow(row("5", 2, 11, 2024));

        verify(postgresJdbc, times(1)).queryForObject(anyString(), eq(Integer.class), any(), any(), any(), any(), any(), any(), any());
        verify(h2Jdbc, times(1)).update(anyString(), any(), any(), any(), any());
    }

    // -----------------------------------------------------------------
    // checkDuplicates
    // -----------------------------------------------------------------

    @Test
    void checkDuplicates_mixedRows_returnsOnlyDuplicateCodes() {
        when(h2Jdbc.queryForObject(anyString(), eq(Integer.class), eq("DUP"), any(), any(), any()))
            .thenReturn(1);
        when(h2Jdbc.queryForObject(anyString(), eq(Integer.class), eq("NEW"), any(), any(), any()))
            .thenReturn(0);

        List<String> result = service.checkDuplicates(List.of(
            row("DUP", 1, 3, 2026),
            row("NEW", 1, 3, 2026)
        ));

        assertThat(result).containsExactly("DUP");
    }

    @Test
    void checkDuplicates_noDuplicates_returnsEmptyList() {
        when(h2Jdbc.queryForObject(anyString(), eq(Integer.class), any(), any(), any(), any()))
            .thenReturn(0);

        List<String> result = service.checkDuplicates(List.of(
            row("A", 1, 3, 2026),
            row("B", 1, 3, 2026)
        ));

        assertThat(result).isEmpty();
    }

    @Test
    void checkDuplicates_allDuplicates_returnsAllCodes() {
        when(h2Jdbc.queryForObject(anyString(), eq(Integer.class), any(), any(), any(), any()))
            .thenReturn(1);

        List<String> result = service.checkDuplicates(List.of(
            row("X", 1, 3, 2026),
            row("Y", 1, 3, 2026)
        ));

        assertThat(result).containsExactlyInAnyOrder("X", "Y");
    }

    @Test
    void checkDuplicates_emptyList_returnsEmptyList() {
        List<String> result = service.checkDuplicates(Collections.emptyList());

        assertThat(result).isEmpty();
    }

    // -----------------------------------------------------------------
    // demo mode
    // -----------------------------------------------------------------

    @Test
    void submitRow_demoMode_skipsPostgres() {
        demoService().submitRow(row("10", 1, 6, 2026));

        verifyNoInteractions(postgresJdbc);
    }

    @Test
    void submitRow_demoMode_skipsH2Log() {
        demoService().submitRow(row("10", 1, 6, 2026));

        verifyNoInteractions(h2Jdbc);
    }
}
