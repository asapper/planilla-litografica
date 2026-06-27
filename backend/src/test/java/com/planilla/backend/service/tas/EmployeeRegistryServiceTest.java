package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasAbsentEmployee;
import com.planilla.backend.model.tas.TasInactiveEmployee;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
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
    void getAll_noFilters_mapsRowsToCamelCaseDto() {
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("EMPLOYEE_ID", "emp1");
        row.put("NAME", "Ana");
        row.put("SHIFT_ID", "manana");
        row.put("ACTIVE", true);
        row.put("SHIFT_NAME", "Mañana");
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(row));

        List<Map<String, Object>> result = service.getAll(null, null, null);

        assertThat(result).hasSize(1);
        Map<String, Object> dto = result.get(0);
        assertThat(dto.get("id")).isEqualTo("emp1");
        assertThat(dto.get("code")).isEqualTo("emp1");
        assertThat(dto.get("name")).isEqualTo("Ana");
        assertThat(dto.get("shiftId")).isEqualTo("manana");
        assertThat(dto.get("shiftName")).isEqualTo("Mañana");
        assertThat(dto.get("active")).isEqualTo(true);
    }

    @Test
    void getAll_employeeWithoutShift_shiftNameIsNull() {
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("EMPLOYEE_ID", "emp2");
        row.put("NAME", "Carlos");
        row.put("SHIFT_ID", null);
        row.put("ACTIVE", false);
        row.put("SHIFT_NAME", null);
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(row));

        List<Map<String, Object>> result = service.getAll(null, null, null);

        assertThat(result.get(0).get("shiftId")).isNull();
        assertThat(result.get(0).get("shiftName")).isNull();
    }

    @Test
    void getAll_queryJoinsShiftConfigForShiftName() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        service.getAll(null, null, null);

        verify(jdbc).queryForList(contains("LEFT JOIN shift_config"), any(Object[].class));
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
    void getAll_searchWithPercentSign_doesNotMatchAll() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        service.getAll(null, null, "%");

        ArgumentCaptor<Object[]> paramsCaptor = ArgumentCaptor.forClass(Object[].class);
        ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForList(sqlCaptor.capture(), paramsCaptor.capture());

        Object[] params = paramsCaptor.getValue();
        assertThat(params[0]).isEqualTo("%\\%%");
        assertThat(sqlCaptor.getValue()).contains("ESCAPE");
    }

    @Test
    void getAll_searchWithUnderscore_escapedInPattern() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        service.getAll(null, null, "a_b");

        ArgumentCaptor<Object[]> paramsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(anyString(), paramsCaptor.capture());

        Object[] params = paramsCaptor.getValue();
        assertThat(params[0]).isEqualTo("%a\\_b%");
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
    void updateEmployee_bothParams_returnsUpdatedDto() {
        when(jdbc.queryForObject(
                eq("SELECT COUNT(*) FROM shift_config WHERE id = ?"),
                eq(Integer.class),
                eq("tarde")))
            .thenReturn(1);
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("EMPLOYEE_ID", "emp1");
        row.put("NAME", "Ana");
        row.put("SHIFT_ID", "tarde");
        row.put("ACTIVE", true);
        row.put("SHIFT_NAME", "Tarde");
        when(jdbc.queryForList(anyString(), eq("emp1"))).thenReturn(List.of(row));

        Map<String, Object> result = service.updateEmployee("emp1", "tarde", true);

        verify(jdbc).update(contains("SET shift_id = ?, active = ?"), eq("tarde"), eq(true), eq("emp1"));
        assertThat(result.get("shiftId")).isEqualTo("tarde");
    }

    @Test
    void updateEmployee_shiftIdOnly_returnsUpdatedDto() {
        when(jdbc.queryForObject(
                eq("SELECT COUNT(*) FROM shift_config WHERE id = ?"),
                eq(Integer.class),
                eq("tarde")))
            .thenReturn(1);
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("EMPLOYEE_ID", "emp1");
        row.put("NAME", "Ana");
        row.put("SHIFT_ID", "tarde");
        row.put("ACTIVE", true);
        row.put("SHIFT_NAME", "Tarde");
        when(jdbc.queryForList(anyString(), eq("emp1"))).thenReturn(List.of(row));

        Map<String, Object> result = service.updateEmployee("emp1", "tarde", null);

        verify(jdbc).update(contains("SET shift_id = ?"), eq("tarde"), eq("emp1"));
        assertThat(result.get("id")).isEqualTo("emp1");
    }

    @Test
    void updateEmployee_activeOnly_returnsUpdatedDto() {
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("EMPLOYEE_ID", "emp1");
        row.put("NAME", "Ana");
        row.put("SHIFT_ID", null);
        row.put("ACTIVE", false);
        row.put("SHIFT_NAME", null);
        when(jdbc.queryForList(anyString(), eq("emp1"))).thenReturn(List.of(row));

        Map<String, Object> result = service.updateEmployee("emp1", null, false);

        verify(jdbc).update(contains("SET active = ?"), eq(false), eq("emp1"));
        assertThat(result.get("active")).isEqualTo(false);
    }

    @Test
    void updateEmployee_neitherParam_doesNothing() {
        assertThat(service.updateEmployee("emp1", null, null)).isNull();

        verify(jdbc, never()).update(anyString(), any(), any(), any());
    }

    @Test
    void bulkAssignShift_updatesEachEmployee() {
        service.bulkAssignShift(List.of("e1", "e2", "e3"), "noche");

        verify(jdbc, times(3)).update(anyString(), anyString(), anyString());
    }

    @Test
    void setActive_false_returnsUpdatedDto() {
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("EMPLOYEE_ID", "emp1");
        row.put("NAME", "Ana");
        row.put("SHIFT_ID", "manana");
        row.put("ACTIVE", false);
        row.put("SHIFT_NAME", "Mañana");
        when(jdbc.queryForList(anyString(), eq("emp1"))).thenReturn(List.of(row));

        Map<String, Object> result = service.setActive("emp1", false);

        verify(jdbc).update(anyString(), eq(false), eq("emp1"));
        assertThat(result.get("active")).isEqualTo(false);
    }

    @Test
    void setActive_true_withNullShift_setsMananaShiftAndReturnsDto() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(1);
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("EMPLOYEE_ID", "emp1");
        row.put("NAME", "Ana");
        row.put("SHIFT_ID", "manana");
        row.put("ACTIVE", true);
        row.put("SHIFT_NAME", "Mañana");
        when(jdbc.queryForList(anyString(), eq("emp1"))).thenReturn(List.of(row));

        Map<String, Object> result = service.setActive("emp1", true);

        verify(jdbc).update(contains("shift_id = 'manana'"), eq("emp1"));
        assertThat(result.get("shiftId")).isEqualTo("manana");
    }

    @Test
    void setActive_true_withExistingShift_returnsDto() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(0);
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("EMPLOYEE_ID", "emp1");
        row.put("NAME", "Ana");
        row.put("SHIFT_ID", "tarde");
        row.put("ACTIVE", true);
        row.put("SHIFT_NAME", "Tarde");
        when(jdbc.queryForList(anyString(), eq("emp1"))).thenReturn(List.of(row));

        Map<String, Object> result = service.setActive("emp1", true);

        verify(jdbc).update(anyString(), eq(true), eq("emp1"));
        assertThat(result.get("active")).isEqualTo(true);
    }

    @Test
    void setAccruesOvertime_updatesFlagAndReturnsDto() {
        when(jdbc.queryForList(contains("WHERE r.employee_id = ?"), eq("100")))
            .thenReturn(List.of(rowMap("100", "Ana", "manana", "Manana", true, false)));

        Map<String, Object> result = service.setAccruesOvertime("100", false);

        verify(jdbc).update("UPDATE employee_registry SET accrues_overtime = ? WHERE employee_id = ?", false, "100");
        assertThat(result.get("accruesOvertime")).isEqualTo(false);
    }

    @Test
    void getAccruesOvertimeFlags_returnsTrueFalseAndDefaultForMissing() {
        Map<String, Object> row1 = new java.util.HashMap<>();
        row1.put("EMPLOYEE_ID", "100");
        row1.put("ACCRUES_OVERTIME", true);

        Map<String, Object> row2 = new java.util.HashMap<>();
        row2.put("EMPLOYEE_ID", "101");
        row2.put("ACCRUES_OVERTIME", false);

        when(jdbc.queryForList(contains("IN (?,?,?)"), eq("100"), eq("101"), eq("102")))
            .thenReturn(List.of(row1, row2));

        Map<String, Boolean> result = service.getAccruesOvertimeFlags(List.of("100", "101", "102"));

        assertThat(result.get("100")).isTrue();
        assertThat(result.get("101")).isFalse();
        assertThat(result.containsKey("102")).isFalse();
        assertThat(result.getOrDefault("102", true)).isTrue();
    }

    private Map<String, Object> rowMap(String id, String name, String shiftId, String shiftName, boolean active, boolean accruesOvertime) {
        Map<String, Object> row = new java.util.LinkedHashMap<>();
        row.put("EMPLOYEE_ID", id);
        row.put("NAME", name);
        row.put("SHIFT_ID", shiftId);
        row.put("SHIFT_NAME", shiftName);
        row.put("ACTIVE", active);
        row.put("ACCRUES_OVERTIME", accruesOvertime);
        return row;
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

    @Test
    void updateEmployee_unknownShiftId_throwsIllegalArgument() {
        when(jdbc.queryForObject(
                eq("SELECT COUNT(*) FROM shift_config WHERE id = ?"),
                eq(Integer.class),
                eq("nonexistent")))
            .thenReturn(0);

        assertThatThrownBy(() -> service.updateEmployee("emp1", "nonexistent", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("SHIFT_NOT_FOUND");
    }

    @Test
    void updateEmployee_validShiftId_proceedsWithUpdate() {
        when(jdbc.queryForObject(
                eq("SELECT COUNT(*) FROM shift_config WHERE id = ?"),
                eq(Integer.class),
                eq("manana")))
            .thenReturn(1);
        when(jdbc.update(anyString(), eq("manana"), eq("emp1"))).thenReturn(1);

        // getById call after update
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("EMPLOYEE_ID", "emp1");
        row.put("NAME", "Ana");
        row.put("SHIFT_ID", "manana");
        row.put("ACTIVE", true);
        row.put("SHIFT_NAME", "Mañana");
        row.put("ACCRUES_OVERTIME", true);
        when(jdbc.queryForList(anyString(), eq("emp1"))).thenReturn(List.of(row));

        assertThatCode(() -> service.updateEmployee("emp1", "manana", null))
            .doesNotThrowAnyException();
    }
}
