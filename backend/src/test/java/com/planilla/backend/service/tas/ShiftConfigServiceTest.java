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
