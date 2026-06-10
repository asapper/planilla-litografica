package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.service.tas.HolidayService;
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
 * Slice tests for HolidayController.
 *
 * Requirements:
 * - GET /api/config/holidays?year= returns 200 with holidays for year
 * - POST /api/config/holidays adds manual holiday; 400 on failure
 * - DELETE /api/config/holidays/{id} deletes holiday; 400 on failure
 * - POST /api/config/holidays/refresh?year= returns 200 with usedFallback flag
 */
@WebMvcTest(HolidayController.class)
class HolidayControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @MockBean HolidayService holidayService;

    @Test
    void getForYear_returns200WithHolidays() throws Exception {
        when(holidayService.getHolidaysForYear(2024)).thenReturn(
            List.of(Map.of("id", 1L, "date", "2024-01-01", "name", "Año Nuevo", "source", "API"))
        );

        mvc.perform(get("/api/config/holidays?year=2024"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$[0].date").value("2024-01-01"))
           .andExpect(jsonPath("$[0].name").value("Año Nuevo"));

        verify(holidayService).getHolidaysForYear(2024);
    }

    @Test
    void addManual_returns200WithCreatedHoliday() throws Exception {
        Map<String, Object> body = Map.of("date", "2024-12-31", "name", "Fin de Año");
        when(holidayService.addManualHoliday("2024-12-31", "Fin de Año")).thenReturn(
            Map.of("id", 7L, "date", "2024-12-31", "name", "Fin de Año", "source", "Manual")
        );

        mvc.perform(post("/api/config/holidays")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.id").value(7))
           .andExpect(jsonPath("$.source").value("Manual"));

        verify(holidayService).addManualHoliday(eq("2024-12-31"), eq("Fin de Año"));
    }

    @Test
    void addManual_returns400OnException() throws Exception {
        doThrow(new RuntimeException("Duplicate holiday")).when(holidayService)
            .addManualHoliday(any(), any());

        Map<String, Object> body = Map.of("date", "2024-01-01", "name", "Año Nuevo dup");

        mvc.perform(post("/api/config/holidays")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("ADD_FAILED"));
    }

    @Test
    void delete_returns200OnSuccess() throws Exception {
        mvc.perform(delete("/api/config/holidays/5"))
           .andExpect(status().isOk());

        verify(holidayService).deleteHoliday(5L);
    }

    @Test
    void delete_returns400OnException() throws Exception {
        doThrow(new RuntimeException("Not found")).when(holidayService).deleteHoliday(anyLong());

        mvc.perform(delete("/api/config/holidays/99"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("DELETE_FAILED"));
    }

    @Test
    void refresh_returns200WithUsedFallbackFalseOnApiSuccess() throws Exception {
        when(holidayService.refreshFromApi(2024)).thenReturn(true);

        mvc.perform(post("/api/config/holidays/refresh?year=2024"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.year").value(2024))
           .andExpect(jsonPath("$.usedFallback").value(false));
    }

    @Test
    void refresh_returns200WithUsedFallbackTrueOnApiFail() throws Exception {
        when(holidayService.refreshFromApi(2024)).thenReturn(false);

        mvc.perform(post("/api/config/holidays/refresh?year=2024"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.usedFallback").value(true));
    }
}
