package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasAbsentEmployee;
import com.planilla.backend.model.tas.TasInactiveEmployee;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for EmployeeRegistryService.
 *
 * Requirements:
 * - getAll: builds query with optional filters (active, shiftId, search)
 * - upsertEmployee: inserts new employee with defaults; updates name+last_seen for existing
 * - updateEmployee: partial update with non-null params only
 * - bulkAssignShift: updates all listed employee IDs
 * - setActive: sets shift_id='manana' when activating employee with null shift
 * - isNewEmployee: returns true when not in registry
 * - getAbsentActiveEmployees: excludes present employees and brand-new ones
 * - getInactiveEmployeesPresent: returns inactive employees that are in the present set
 */
@ExtendWith(MockitoExtension.class)
class EmployeeRegistryServiceTest {

    @Mock JdbcTemplate jdbc;

    EmployeeRegistryService service;

    @BeforeEach
    void setUp() {
        service = new EmployeeRegistryService(jdbc);
    }

    @Test
    void getAll_noFilters_returnsAllEmployees() {
        List<Map<String, Object>> expected = List.of(Map.of("employee_id", "1", "name", "Ana"));
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(expected);

        List<Map<String, Object>> result = service.getAll(null, null, null);

        assertThat(result).isEqualTo(expected);
    }

    @Test
    void getAll_withActiveFilter_addsCondition() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        service.getAll(true, null, null);

        verify(jdbc).queryForList(contains("active = ?"), any(Object[].class));
    }

    @Test
    void getAll_withShiftIdFilter_addsCondition() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        service.getAll(null, "manana", null);

        verify(jdbc).queryForList(contains("shift_id = ?"), any(Object[].class));
    }

    @Test
    void getAll_withSearchFilter_addsLikeCondition() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        service.getAll(null, null, "ana");

        verify(jdbc).queryForList(contains("LIKE ?"), any(Object[].class));
    }

    @Test
    void upsertEmployee_insertsNewEmployee() {
        service.upsertEmployee("emp1", "Maria");

        verify(jdbc).update(contains("MERGE INTO employee_registry"), eq("emp1"), eq("Maria"));
    }

    @Test
    void upsertEmployee_updatesExistingEmployee() {
        service.upsertEmployee("emp1", "Maria Updated");

        verify(jdbc).update(contains("MERGE INTO employee_registry"), eq("emp1"), eq("Maria Updated"));
    }

    @Test
    void updateEmployee_bothParams_updatesBoth() {
        service.updateEmployee("emp1", "tarde", true);

        verify(jdbc).update(contains("SET shift_id = ?, active = ?"), eq("tarde"), eq(true), eq("emp1"));
    }

    @Test
    void updateEmployee_shiftIdOnly_updatesShiftOnly() {
        service.updateEmployee("emp1", "tarde", null);

        verify(jdbc).update(contains("SET shift_id = ?"), eq("tarde"), eq("emp1"));
    }

    @Test
    void updateEmployee_activeOnly_updatesActiveOnly() {
        service.updateEmployee("emp1", null, false);

        verify(jdbc).update(contains("SET active = ?"), eq(false), eq("emp1"));
    }

    @Test
    void updateEmployee_neitherParam_doesNothing() {
        service.updateEmployee("emp1", null, null);

        verify(jdbc, never()).update(anyString(), any(), any(), any());
    }

    @Test
    void bulkAssignShift_updatesEachEmployee() {
        service.bulkAssignShift(List.of("e1", "e2", "e3"), "noche");

        verify(jdbc, times(3)).update(anyString(), anyString(), anyString());
    }

    @Test
    void setActive_false_setsActiveFalse() {
        service.setActive("emp1", false);

        verify(jdbc).update(anyString(), eq(false), eq("emp1"));
    }

    @Test
    void setActive_true_withNullShift_setsMananaShift() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(1);

        service.setActive("emp1", true);

        verify(jdbc).update(contains("shift_id = 'manana'"), eq("emp1"));
    }

    @Test
    void setActive_true_withExistingShift_setsActiveTrue() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(0);

        service.setActive("emp1", true);

        verify(jdbc).update(anyString(), eq(true), eq("emp1"));
    }

    @Test
    void isNewEmployee_trueWhenNotFound() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(0);

        assertThat(service.isNewEmployee("newEmp")).isTrue();
    }

    @Test
    void isNewEmployee_falseWhenFound() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(1);

        assertThat(service.isNewEmployee("existingEmp")).isFalse();
    }

    @Test
    void getAbsentActiveEmployees_excludesPresentEmployees() {
        Map<String, Object> row1 = Map.of("EMPLOYEE_ID", "emp1", "NAME", "Ana");
        Map<String, Object> row2 = Map.of("EMPLOYEE_ID", "emp2", "NAME", "Carlos");
        when(jdbc.queryForList(anyString())).thenReturn(List.of(row1, row2));

        List<TasAbsentEmployee> result = service.getAbsentActiveEmployees(Set.of("emp1"));

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getEmployeeId()).isEqualTo("emp2");
    }

    @Test
    void getAbsentActiveEmployees_emptyWhenAllPresent() {
        Map<String, Object> row = Map.of("EMPLOYEE_ID", "emp1", "NAME", "Ana");
        when(jdbc.queryForList(anyString())).thenReturn(List.of(row));

        List<TasAbsentEmployee> result = service.getAbsentActiveEmployees(Set.of("emp1"));

        assertThat(result).isEmpty();
    }

    @Test
    void getInactiveEmployeesPresent_returnsInactiveInPresentSet() {
        Map<String, Object> row1 = Map.of("EMPLOYEE_ID", "emp1", "NAME", "Ana");
        Map<String, Object> row2 = Map.of("EMPLOYEE_ID", "emp2", "NAME", "Carlos");
        when(jdbc.queryForList(anyString())).thenReturn(List.of(row1, row2));

        List<TasInactiveEmployee> result = service.getInactiveEmployeesPresent(Set.of("emp1", "emp3"));

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getEmployeeId()).isEqualTo("emp1");
    }

    @Test
    void getInactiveEmployeesPresent_emptyWhenNoPresentSet() {
        List<TasInactiveEmployee> result = service.getInactiveEmployeesPresent(Set.of());

        assertThat(result).isEmpty();
        verify(jdbc, never()).queryForList(anyString());
    }

    @Test
    void getAbsentActiveEmployees_handlesLowercaseColumnKeys() {
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("employee_id", "emp3");
        row.put("name", "Beatriz");
        when(jdbc.queryForList(anyString())).thenReturn(List.of(row));

        List<TasAbsentEmployee> result = service.getAbsentActiveEmployees(Set.of());

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getEmployeeId()).isEqualTo("emp3");
        assertThat(result.get(0).getName()).isEqualTo("Beatriz");
    }

    @Test
    void getInactiveEmployeesPresent_handlesLowercaseColumnKeys() {
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("employee_id", "emp4");
        row.put("name", "Diego");
        when(jdbc.queryForList(anyString())).thenReturn(List.of(row));

        List<TasInactiveEmployee> result = service.getInactiveEmployeesPresent(Set.of("emp4"));

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getEmployeeId()).isEqualTo("emp4");
        assertThat(result.get(0).getName()).isEqualTo("Diego");
    }
}
