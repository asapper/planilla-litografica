package com.planilla.backend.service.tas;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for AppConfigService.
 *
 * Requirements:
 * - getLegalBreakAllowanceMinutes: returns parsed int from DB; defaults to 45 on null or exception
 * - setLegalBreakAllowanceMinutes: upserts the value via MERGE
 */
@ExtendWith(MockitoExtension.class)
class AppConfigServiceTest {

    @Mock JdbcTemplate jdbc;

    AppConfigService service;

    @BeforeEach
    void setUp() {
        service = new AppConfigService(jdbc);
    }

    @Test
    void getLegalBreakAllowanceMinutes_returnsValueFromDb() {
        when(jdbc.queryForObject(anyString(), eq(String.class))).thenReturn("60");

        assertThat(service.getLegalBreakAllowanceMinutes()).isEqualTo(60);
    }

    @Test
    void getLegalBreakAllowanceMinutes_returns45WhenNull() {
        when(jdbc.queryForObject(anyString(), eq(String.class))).thenReturn(null);

        assertThat(service.getLegalBreakAllowanceMinutes()).isEqualTo(45);
    }

    @Test
    void getLegalBreakAllowanceMinutes_returns45OnException() {
        when(jdbc.queryForObject(anyString(), eq(String.class))).thenThrow(new RuntimeException("no row"));

        assertThat(service.getLegalBreakAllowanceMinutes()).isEqualTo(45);
    }

    @Test
    void setLegalBreakAllowanceMinutes_executesUpsert() {
        service.setLegalBreakAllowanceMinutes(30);

        verify(jdbc).update(contains("MERGE INTO app_config"), eq("30"));
    }

    @Test
    void setLegalBreakAllowanceMinutes_convertsIntToString() {
        service.setLegalBreakAllowanceMinutes(45);

        verify(jdbc).update(anyString(), eq("45"));
    }

    @Test
    void getMaxSessionSpanMinutes_returnsDefaultWhenNotSet() {
        when(jdbc.queryForObject(anyString(), eq(String.class))).thenThrow(new RuntimeException("no row"));

        assertThat(service.getMaxSessionSpanMinutes()).isEqualTo(780);
    }

    @Test
    void setAndGetMaxSessionSpanMinutes_roundTrips() {
        when(jdbc.queryForObject(anyString(), eq(String.class))).thenReturn("960");

        service.setMaxSessionSpanMinutes(960);
        assertThat(service.getMaxSessionSpanMinutes()).isEqualTo(960);

        verify(jdbc).update(contains("MERGE INTO app_config"), eq("960"));
    }
}
