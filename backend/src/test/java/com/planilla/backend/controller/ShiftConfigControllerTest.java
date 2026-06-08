package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.service.tas.ShiftConfigService;
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
 * Slice tests for ShiftConfigController.
 *
 * Requirements:
 * - GET /api/config/shifts returns 200 with list of shifts
 * - POST /api/config/shifts returns 200 on success; 400 on failure
 * - PUT /api/config/shifts/{id} returns 200 on success; 404 when SHIFT_NOT_FOUND
 * - DELETE /api/config/shifts/{id} returns 200 on success; 409 with SHIFT_HAS_ACTIVE_EMPLOYEES error
 */
@WebMvcTest(ShiftConfigController.class)
class ShiftConfigControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @MockBean ShiftConfigService shiftConfigService;

    @Test
    void getAll_returns200WithShifts() throws Exception {
        when(shiftConfigService.getAllShifts()).thenReturn(
            List.of(Map.of("id", "manana", "name", "Mañana"))
        );

        mvc.perform(get("/api/config/shifts"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$[0].id").value("manana"))
           .andExpect(jsonPath("$[0].name").value("Mañana"));
    }

    @Test
    void getAll_returnsEmptyListWhenNoShifts() throws Exception {
        when(shiftConfigService.getAllShifts()).thenReturn(List.of());

        mvc.perform(get("/api/config/shifts"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void create_returns200OnSuccess() throws Exception {
        Map<String, Object> body = Map.of("id", "tarde", "name", "Tarde", "startTime", "15:00", "endTime", "23:00", "crossMidnight", false);

        mvc.perform(post("/api/config/shifts")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

        verify(shiftConfigService).createShift(eq("tarde"), eq("Tarde"), eq("15:00"), eq("23:00"), eq(false));
    }

    @Test
    void create_returns400OnException() throws Exception {
        doThrow(new RuntimeException("Duplicate key")).when(shiftConfigService)
            .createShift(any(), any(), any(), any(), anyBoolean());

        Map<String, Object> body = Map.of("id", "dup", "name", "Dup", "startTime", "15:00", "endTime", "23:00");

        mvc.perform(post("/api/config/shifts")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("CREATE_FAILED"));
    }

    @Test
    void update_returns200OnSuccess() throws Exception {
        Map<String, Object> body = Map.of("name", "Tarde Updated", "startTime", "15:00", "endTime", "23:00", "crossMidnight", false);

        mvc.perform(put("/api/config/shifts/tarde")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

        verify(shiftConfigService).updateShift(eq("tarde"), eq("Tarde Updated"), eq("15:00"), eq("23:00"), eq(false));
    }

    @Test
    void update_returns404WhenShiftNotFound() throws Exception {
        doThrow(new IllegalArgumentException("SHIFT_NOT_FOUND")).when(shiftConfigService)
            .updateShift(any(), any(), any(), any(), anyBoolean());

        Map<String, Object> body = Map.of("name", "Ghost", "startTime", "00:00", "endTime", "08:00");

        mvc.perform(put("/api/config/shifts/ghost")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.code").value("SHIFT_NOT_FOUND"));
    }

    @Test
    void delete_returns200OnSuccess() throws Exception {
        mvc.perform(delete("/api/config/shifts/tarde"))
           .andExpect(status().isOk());

        verify(shiftConfigService).deleteShift("tarde");
    }

    @Test
    void delete_returns409WhenShiftHasActiveEmployees() throws Exception {
        doThrow(new IllegalStateException("SHIFT_HAS_ACTIVE_EMPLOYEES")).when(shiftConfigService)
            .deleteShift(any());

        mvc.perform(delete("/api/config/shifts/manana"))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.error").value("SHIFT_HAS_ACTIVE_EMPLOYEES"));
    }

    @Test
    void delete_returns400OnGenericException() throws Exception {
        doThrow(new RuntimeException("unexpected error")).when(shiftConfigService).deleteShift(any());

        mvc.perform(delete("/api/config/shifts/broken"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("DELETE_FAILED"));
    }

    @Test
    void update_returns400OnGenericException() throws Exception {
        doThrow(new RuntimeException("db error")).when(shiftConfigService)
            .updateShift(any(), any(), any(), any(), anyBoolean());

        Map<String, Object> body = Map.of("name", "X", "startTime", "00:00", "endTime", "08:00");

        mvc.perform(put("/api/config/shifts/bad")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("UPDATE_FAILED"));
    }

    @Test
    void create_withNoCrossMidnightField_defaultsToFalse() throws Exception {
        Map<String, Object> body = Map.of("id", "x", "name", "X", "startTime", "06:00", "endTime", "14:00");

        mvc.perform(post("/api/config/shifts")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

        verify(shiftConfigService).createShift(eq("x"), eq("X"), eq("06:00"), eq("14:00"), eq(false));
    }
}
