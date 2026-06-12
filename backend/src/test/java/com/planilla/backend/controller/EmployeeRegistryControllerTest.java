package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.service.tas.EmployeeRegistryService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Slice tests for EmployeeRegistryController.
 *
 * Requirements:
 * - GET /api/config/employees returns 200 with employee list; supports optional filters
 * - PUT /api/config/employees/{id} returns 200 on success; 400 on failure
 * - POST /api/config/employees/bulk-assign returns 200 on success
 * - POST /api/config/employees/{id}/deactivate returns 200 on success
 */
@WebMvcTest(EmployeeRegistryController.class)
class EmployeeRegistryControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @MockBean EmployeeRegistryService employeeRegistryService;

    @Test
    void getAll_returns200WithEmployees() throws Exception {
        when(employeeRegistryService.getAll(any(), any(), any())).thenReturn(
            List.of(Map.of("id", "emp1", "code", "emp1", "name", "Ana", "shiftId", "manana", "shiftName", "Mañana", "active", true))
        );

        mvc.perform(get("/api/config/employees"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$[0].id").value("emp1"))
           .andExpect(jsonPath("$[0].code").value("emp1"))
           .andExpect(jsonPath("$[0].shiftName").value("Mañana"));
    }

    @Test
    void getAll_passesFiltersToService() throws Exception {
        when(employeeRegistryService.getAll(any(), any(), any())).thenReturn(List.of());

        mvc.perform(get("/api/config/employees?active=true&shiftId=manana&search=ana"))
           .andExpect(status().isOk());

        verify(employeeRegistryService).getAll(eq(true), eq("manana"), eq("ana"));
    }

    @Test
    void update_returns200WithUpdatedEmployee() throws Exception {
        Map<String, Object> body = Map.of("shiftId", "tarde", "active", true);
        when(employeeRegistryService.updateEmployee("emp1", "tarde", true)).thenReturn(
            Map.of("id", "emp1", "code", "emp1", "name", "Ana", "shiftId", "tarde", "shiftName", "Tarde", "active", true)
        );

        mvc.perform(put("/api/config/employees/emp1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.shiftId").value("tarde"));

        verify(employeeRegistryService).updateEmployee(eq("emp1"), eq("tarde"), eq(true));
    }

    @Test
    void update_returns400OnException() throws Exception {
        doThrow(new RuntimeException("DB error")).when(employeeRegistryService)
            .updateEmployee(any(), any(), any());

        Map<String, Object> body = Map.of("shiftId", "tarde");

        mvc.perform(put("/api/config/employees/emp1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("UPDATE_FAILED"));
    }

    @Test
    void update_returns400WhenNoFieldsProvided() throws Exception {
        mvc.perform(put("/api/config/employees/emp1")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("NO_FIELDS_TO_UPDATE"));

        verify(employeeRegistryService, never()).updateEmployee(any(), any(), any());
    }

    @Test
    void update_returns404WhenEmployeeNotFound() throws Exception {
        when(employeeRegistryService.updateEmployee("ghost", "tarde", null)).thenReturn(null);

        Map<String, Object> body = Map.of("shiftId", "tarde");

        mvc.perform(put("/api/config/employees/ghost")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.code").value("EMPLOYEE_NOT_FOUND"));
    }

    @Test
    void bulkAssign_returns200OnSuccess() throws Exception {
        Map<String, Object> body = Map.of("employeeIds", List.of("e1", "e2"), "shiftId", "noche");

        mvc.perform(post("/api/config/employees/bulk-assign")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

        verify(employeeRegistryService).bulkAssignShift(eq(List.of("e1", "e2")), eq("noche"));
    }

    @Test
    void bulkAssign_returns400OnException() throws Exception {
        doThrow(new RuntimeException("DB error")).when(employeeRegistryService)
            .bulkAssignShift(any(), any());

        Map<String, Object> body = Map.of("employeeIds", List.of("e1"), "shiftId", "noche");

        mvc.perform(post("/api/config/employees/bulk-assign")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("BULK_ASSIGN_FAILED"));
    }

    @Test
    void bulkAssign_returns400WhenEmployeeIdsNull() throws Exception {
        Map<String, Object> body = Map.of("shiftId", "noche");

        mvc.perform(post("/api/config/employees/bulk-assign")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("MISSING_EMPLOYEE_IDS"));

        verify(employeeRegistryService, never()).bulkAssignShift(any(), any());
    }

    @Test
    void deactivate_returns200WithUpdatedEmployee() throws Exception {
        when(employeeRegistryService.setActive("emp1", false)).thenReturn(
            Map.of("id", "emp1", "code", "emp1", "name", "Ana", "shiftId", "manana", "shiftName", "Mañana", "active", false)
        );

        mvc.perform(post("/api/config/employees/emp1/deactivate"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.active").value(false));

        verify(employeeRegistryService).setActive(eq("emp1"), eq(false));
    }

    @Test
    void deactivate_returns404WhenEmployeeNotFound() throws Exception {
        when(employeeRegistryService.setActive("ghost", false)).thenReturn(null);

        mvc.perform(post("/api/config/employees/ghost/deactivate"))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.code").value("EMPLOYEE_NOT_FOUND"));
    }

    @Test
    void deactivate_returns400OnException() throws Exception {
        doThrow(new RuntimeException("DB error")).when(employeeRegistryService)
            .setActive(any(), anyBoolean());

        mvc.perform(post("/api/config/employees/emp1/deactivate"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("DEACTIVATE_FAILED"));
    }

    @Test
    void updateAccruesOvertime_returns200WithUpdatedEmployee() throws Exception {
        when(employeeRegistryService.setAccruesOvertime("emp1", false)).thenReturn(
            Map.of("id", "emp1", "code", "emp1", "name", "Ana", "shiftId", "manana", "shiftName", "Mañana", "active", true, "accruesOvertime", false)
        );

        Map<String, Object> body = Map.of("accruesOvertime", false);

        mvc.perform(patch("/api/config/employees/emp1/accrues-overtime")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.accruesOvertime").value(false));

        verify(employeeRegistryService).setAccruesOvertime(eq("emp1"), eq(false));
    }

    @Test
    void updateAccruesOvertime_returns404WhenEmployeeNotFound() throws Exception {
        when(employeeRegistryService.setAccruesOvertime("ghost", true)).thenReturn(null);

        Map<String, Object> body = Map.of("accruesOvertime", true);

        mvc.perform(patch("/api/config/employees/ghost/accrues-overtime")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.code").value("EMPLOYEE_NOT_FOUND"));
    }

    @Test
    void updateAccruesOvertime_returns400WhenFieldMissing() throws Exception {
        mvc.perform(patch("/api/config/employees/emp1/accrues-overtime")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("MISSING_FIELD"));

        verify(employeeRegistryService, never()).setAccruesOvertime(any(), anyBoolean());
    }
}
