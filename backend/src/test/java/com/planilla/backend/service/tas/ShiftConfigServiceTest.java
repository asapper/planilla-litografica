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

@ExtendWith(MockitoExtension.class)
class ShiftConfigServiceTest {

    @Mock JdbcTemplate jdbc;

    ShiftConfigService service;

    @BeforeEach
    void setUp() {
        service = new ShiftConfigService(jdbc);
    }

    @Test
    void getAllShifts_mapsRowsToCamelCaseDto() {
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("ID", "manana");
        row.put("NAME", "Mañana");
        row.put("START_TIME", java.sql.Time.valueOf("07:00:00"));
        row.put("END_TIME", java.sql.Time.valueOf("15:00:00"));
        row.put("CROSS_MIDNIGHT", false);
        when(jdbc.queryForList(anyString())).thenReturn(List.of(row));

        List<Map<String, Object>> result = service.getAllShifts();

        assertThat(result).hasSize(1);
        Map<String, Object> dto = result.get(0);
        assertThat(dto.get("id")).isEqualTo("manana");
        assertThat(dto.get("name")).isEqualTo("Mañana");
        assertThat(dto.get("startTime")).isEqualTo("07:00");
        assertThat(dto.get("endTime")).isEqualTo("15:00");
        assertThat(dto.get("crossMidnight")).isEqualTo(false);
    }

    @Test
    void createShift_generatesSlugIdAndReturnsDto() {
        when(jdbc.queryForObject(contains("COUNT(*) FROM shift_config WHERE id = ?"), eq(Integer.class), eq("tarde")))
            .thenReturn(0);
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("ID", "tarde");
        row.put("NAME", "Tarde");
        row.put("START_TIME", java.sql.Time.valueOf("15:00:00"));
        row.put("END_TIME", java.sql.Time.valueOf("23:00:00"));
        row.put("CROSS_MIDNIGHT", false);
        when(jdbc.queryForList(anyString(), eq("tarde"))).thenReturn(List.of(row));

        Map<String, Object> created = service.createShift("Tarde", "15:00", "23:00", false);

        assertThat(created.get("id")).isEqualTo("tarde");
        assertThat(created.get("name")).isEqualTo("Tarde");
        verify(jdbc).update(contains("INSERT INTO shift_config"), eq("tarde"), eq("Tarde"), eq("15:00"), eq("23:00"), eq(false));
    }

    @Test
    void createShift_appendsSuffixWhenSlugCollides() {
        when(jdbc.queryForObject(contains("COUNT(*) FROM shift_config WHERE id = ?"), eq(Integer.class), eq("tarde")))
            .thenReturn(1);
        when(jdbc.queryForObject(contains("COUNT(*) FROM shift_config WHERE id = ?"), eq(Integer.class), eq("tarde-2")))
            .thenReturn(0);
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("ID", "tarde-2");
        row.put("NAME", "Tarde");
        row.put("START_TIME", java.sql.Time.valueOf("15:00:00"));
        row.put("END_TIME", java.sql.Time.valueOf("23:00:00"));
        row.put("CROSS_MIDNIGHT", false);
        when(jdbc.queryForList(anyString(), eq("tarde-2"))).thenReturn(List.of(row));

        Map<String, Object> created = service.createShift("Tarde", "15:00", "23:00", false);

        assertThat(created.get("id")).isEqualTo("tarde-2");
        verify(jdbc).update(contains("INSERT INTO shift_config"), eq("tarde-2"), eq("Tarde"), eq("15:00"), eq("23:00"), eq(false));
    }

    @Test
    void updateShift_successReturnsUpdatedDto() {
        when(jdbc.update(anyString(), any(), any(), any(), any(), any())).thenReturn(1);
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("ID", "tarde");
        row.put("NAME", "Tarde");
        row.put("START_TIME", java.sql.Time.valueOf("15:00:00"));
        row.put("END_TIME", java.sql.Time.valueOf("23:00:00"));
        row.put("CROSS_MIDNIGHT", false);
        when(jdbc.queryForList(anyString(), eq("tarde"))).thenReturn(List.of(row));

        Map<String, Object> updated = service.updateShift("tarde", "Tarde", "15:00", "23:00", false);

        assertThat(updated.get("id")).isEqualTo("tarde");
        assertThat(updated.get("startTime")).isEqualTo("15:00");
    }

    @Test
    void updateShift_throwsWhenNoRowsAffected() {
        when(jdbc.update(anyString(), any(), any(), any(), any(), any())).thenReturn(0);

        assertThatThrownBy(() -> service.updateShift("ghost", "Ghost", "00:00", "08:00", false))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("SHIFT_NOT_FOUND");
    }

    @SuppressWarnings("unchecked")
    @Test
    void deleteShift_throwsWithEmployeeListWhenActiveEmployeesExist() {
        List<Map<String, Object>> activeEmployees = List.of(
            Map.of("EMPLOYEE_ID", "emp1", "NAME", "Ana"),
            Map.of("EMPLOYEE_ID", "emp2", "NAME", "Carlos")
        );
        doReturn(activeEmployees).when(jdbc).queryForList(anyString(), (Object[]) any());

        assertThatThrownBy(() -> service.deleteShift("manana"))
            .isInstanceOf(ShiftConfigService.ShiftHasActiveEmployeesException.class)
            .hasMessage("SHIFT_HAS_ACTIVE_EMPLOYEES")
            .satisfies(ex -> {
                ShiftConfigService.ShiftHasActiveEmployeesException e =
                    (ShiftConfigService.ShiftHasActiveEmployeesException) ex;
                assertThat(e.getEmployees()).hasSize(2);
                assertThat(e.getEmployees().get(0)).containsEntry("EMPLOYEE_ID", "emp1");
                assertThat(e.getEmployees().get(1)).containsEntry("EMPLOYEE_ID", "emp2");
            });

        verify(jdbc, never()).update(contains("DELETE FROM shift_config"), (Object[]) any());
    }

    @SuppressWarnings("unchecked")
    @Test
    void deleteShift_employeeListIsPopulatedCorrectly() {
        List<Map<String, Object>> activeEmployees = List.of(
            Map.of("EMPLOYEE_ID", "emp3", "NAME", "Beatriz")
        );
        doReturn(activeEmployees).when(jdbc).queryForList(anyString(), (Object[]) any());

        ShiftConfigService.ShiftHasActiveEmployeesException ex =
            catchThrowableOfType(() -> service.deleteShift("tarde"),
                ShiftConfigService.ShiftHasActiveEmployeesException.class);

        assertThat(ex).isNotNull();
        assertThat(ex.getEmployees()).hasSize(1);
        assertThat(ex.getEmployees().get(0).get("EMPLOYEE_ID")).isEqualTo("emp3");
        assertThat(ex.getEmployees().get(0).get("NAME")).isEqualTo("Beatriz");
    }

    @SuppressWarnings("unchecked")
    @Test
    void deleteShift_clearsInactiveEmployeesAndDeletes() {
        doReturn(List.of()).when(jdbc).queryForList(anyString(), (Object[]) any());

        service.deleteShift("manana");

        verify(jdbc).update(contains("UPDATE employee_registry SET shift_id = NULL"), eq("manana"));
        verify(jdbc).update(contains("DELETE FROM shift_config"), eq("manana"));
    }
}
