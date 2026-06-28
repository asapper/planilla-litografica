package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.service.tas.AppConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Slice tests for AppConfigController.
 *
 * Requirements:
 * - GET /api/config/general returns 200 with legalBreakAllowanceMinutes
 * - PUT /api/config/general updates value; 400 on exception
 */
@WebMvcTest(AppConfigController.class)
class AppConfigControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @MockBean AppConfigService appConfigService;

    @Test
    void get_returns200WithBreakAllowanceMinutes() throws Exception {
        when(appConfigService.getLegalBreakAllowanceMinutes()).thenReturn(45);

        mvc.perform(get("/api/config/general"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.legalBreakAllowanceMinutes").value(45));
    }

    @Test
    void update_returns200OnSuccess() throws Exception {
        Map<String, Object> body = Map.of("legalBreakAllowanceMinutes", 30);

        mvc.perform(put("/api/config/general")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

        verify(appConfigService).setLegalBreakAllowanceMinutes(30);
    }

    @Test
    void update_returns400OnException() throws Exception {
        doThrow(new RuntimeException("DB error")).when(appConfigService)
            .setLegalBreakAllowanceMinutes(anyInt());

        Map<String, Object> body = Map.of("legalBreakAllowanceMinutes", 30);

        mvc.perform(put("/api/config/general")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("UPDATE_FAILED"));
    }

    @Test
    void update_noKnownKey_returns200WithoutCallingService() throws Exception {
        Map<String, Object> body = Map.of("unknownKey", "value");

        mvc.perform(put("/api/config/general")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

        verify(appConfigService, never()).setLegalBreakAllowanceMinutes(anyInt());
    }

    @Test
    void get_includesMaxSessionSpanMinutes() throws Exception {
        when(appConfigService.getMaxSessionSpanMinutes()).thenReturn(780);

        mvc.perform(get("/api/config/general"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.maxSessionSpanMinutes").value(780));
    }

    @Test
    void update_maxSessionSpanMinutes_updatesValue() throws Exception {
        Map<String, Object> body = Map.of("maxSessionSpanMinutes", 960);

        mvc.perform(put("/api/config/general")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

        verify(appConfigService).setMaxSessionSpanMinutes(960);
    }

    @Test
    void update_negativeLegalBreakAllowance_returns400() throws Exception {
        Map<String, Object> body = Map.of("legalBreakAllowanceMinutes", -1);

        mvc.perform(put("/api/config/general")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_VALUE"));

        verify(appConfigService, never()).setLegalBreakAllowanceMinutes(anyInt());
    }

    @Test
    void update_maxSessionSpanMinutesBelowMinimum_returns400() throws Exception {
        Map<String, Object> body = Map.of("maxSessionSpanMinutes", 30);

        mvc.perform(put("/api/config/general")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_VALUE"));

        verify(appConfigService, never()).setMaxSessionSpanMinutes(anyInt());
    }

    @Test
    void update_zeroLegalBreakAllowance_isAccepted() throws Exception {
        Map<String, Object> body = Map.of("legalBreakAllowanceMinutes", 0);

        mvc.perform(put("/api/config/general")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

        verify(appConfigService).setLegalBreakAllowanceMinutes(0);
    }

    @Test
    void update_maxSessionSpanMinutesAtMinimum_isAccepted() throws Exception {
        Map<String, Object> body = Map.of("maxSessionSpanMinutes", 60);

        mvc.perform(put("/api/config/general")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)))
           .andExpect(status().isOk());

        verify(appConfigService).setMaxSessionSpanMinutes(60);
    }
}
