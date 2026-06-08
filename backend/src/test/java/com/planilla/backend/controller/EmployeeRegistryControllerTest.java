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
            List.of(Map.of("employee_id", "emp1", "name", "Ana"))
        );

        mvc.perform(get("/api/config/employees"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$[0].employee_id").value("emp1"));
    }

    @Test
    void getAll_passesFiltersToService() throws Exception {
        when(employeeRegistryService.getAll(any(), any(), any())).thenReturn(List.of());

        mvc.perform(get("/api/config/employees?active=true&shiftId=manana&search=ana"))
           .andExpect(status().isOk());

        verify(employeeRegistryService).getAll(eq(true), eq("manana"), eq("ana"));
    }

    @Test
    void update_returns200OnSuccess() throws Exception {
        Map<String, Object> body = Map.of("shiftId", "tarde", "active", true);

        mvc.perform(put("/api/config/employees/emp1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

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
    void deactivate_returns200OnSuccess() throws Exception {
        mvc.perform(post("/api/config/employees/emp1/deactivate"))
           .andExpect(status().isOk());

        verify(employeeRegistryService).setActive(eq("emp1"), eq(false));
    }

    @Test
    void deactivate_returns400OnException() throws Exception {
        doThrow(new RuntimeException("DB error")).when(employeeRegistryService)
            .setActive(any(), anyBoolean());

        mvc.perform(post("/api/config/employees/emp1/deactivate"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("DEACTIVATE_FAILED"));
    }
}
