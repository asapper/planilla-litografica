package com.planilla.backend.service.tas;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ShiftConfigService.
 *
 * Requirements:
 * - getAllShifts: queries H2 and returns list of shift maps
 * - createShift: inserts a row into shift_config
 * - updateShift: updates shift row; throws IllegalArgumentException("SHIFT_NOT_FOUND") when 0 rows affected
 * - deleteShift: throws IllegalStateException("SHIFT_HAS_ACTIVE_EMPLOYEES") when active employees exist;
 *   clears inactive employee shift_id before deleting
 * - shiftExists: returns true/false based on count query
 */
@ExtendWith(MockitoExtension.class)
class ShiftConfigServiceTest {

    @Mock JdbcTemplate jdbc;

    ShiftConfigService service;

    @BeforeEach
    void setUp() {
        service = new ShiftConfigService(jdbc);
    }

    @Test
    void getAllShifts_returnsQueryResult() {
        List<Map<String, Object>> expected = List.of(Map.of("id", "manana", "name", "Mañana"));
        when(jdbc.queryForList(anyString())).thenReturn(expected);

        List<Map<String, Object>> result = service.getAllShifts();

        assertThat(result).isEqualTo(expected);
        verify(jdbc).queryForList(anyString());
    }

    @Test
    void createShift_executesInsert() {
        service.createShift("tarde", "Tarde", "15:00", "23:00", false);

        verify(jdbc).update(contains("INSERT INTO shift_config"), eq("tarde"), eq("Tarde"), eq("15:00"), eq("23:00"), eq(false));
    }

    @Test
    void updateShift_successWhenRowUpdated() {
        when(jdbc.update(anyString(), any(), any(), any(), any(), any())).thenReturn(1);

        assertThatCode(() -> service.updateShift("tarde", "Tarde", "15:00", "23:00", false))
            .doesNotThrowAnyException();
    }

    @Test
    void updateShift_throwsWhenNoRowsAffected() {
        when(jdbc.update(anyString(), any(), any(), any(), any(), any())).thenReturn(0);

        assertThatThrownBy(() -> service.updateShift("ghost", "Ghost", "00:00", "08:00", false))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("SHIFT_NOT_FOUND");
    }

    @Test
    void deleteShift_throwsWhenActiveEmployeesExist() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(2);

        assertThatThrownBy(() -> service.deleteShift("manana"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("SHIFT_HAS_ACTIVE_EMPLOYEES");

        verify(jdbc, never()).update(contains("DELETE FROM shift_config"), (Object[]) any());
    }

    @Test
    void deleteShift_clearsInactiveEmployeesAndDeletes() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(0);

        service.deleteShift("manana");

        verify(jdbc).update(contains("UPDATE employee_registry SET shift_id = NULL"), eq("manana"));
        verify(jdbc).update(contains("DELETE FROM shift_config"), eq("manana"));
    }

    @Test
    void shiftExists_returnsTrueWhenFound() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(1);

        assertThat(service.shiftExists("manana")).isTrue();
    }

    @Test
    void shiftExists_returnsFalseWhenNotFound() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(0);

        assertThat(service.shiftExists("ghost")).isFalse();
    }

    @Test
    void shiftExists_returnsFalseWhenNull() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(null);

        assertThat(service.shiftExists("ghost")).isFalse();
    }
}
