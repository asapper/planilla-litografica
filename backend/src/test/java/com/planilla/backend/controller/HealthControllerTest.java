package com.planilla.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(HealthController.class)
class HealthControllerTest {

    @Autowired MockMvc mvc;
    @Autowired HealthController controller;

    @MockBean(name = "postgresJdbcTemplate")
    JdbcTemplate postgresJdbc;

    @Test
    void healthReturns200WithStatusOk() throws Exception {
        mvc.perform(get("/api/health"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.status").value("ok"));
    }

    @Test
    void dbHealthReturns200WhenPostgresReachable() throws Exception {
        when(postgresJdbc.queryForObject("SELECT 1", Integer.class)).thenReturn(1);
        mvc.perform(get("/api/db-health"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.status").value("ok"));
    }

    @Test
    void dbHealthReturns503WhenPostgresUnreachable() throws Exception {
        when(postgresJdbc.queryForObject("SELECT 1", Integer.class))
            .thenThrow(new DataAccessResourceFailureException("timeout"));
        mvc.perform(get("/api/db-health"))
           .andExpect(status().isServiceUnavailable());
    }

    @Test
    void runDoesNotThrowWhenDatabaseReachable() throws Exception {
        when(postgresJdbc.queryForObject("SELECT 1", Integer.class)).thenReturn(1);
        assertThatCode(() -> controller.run(null)).doesNotThrowAnyException();
    }

    @Test
    void runDoesNotThrowWhenDatabaseUnreachable() throws Exception {
        when(postgresJdbc.queryForObject("SELECT 1", Integer.class))
            .thenThrow(new DataAccessResourceFailureException("timeout"));
        assertThatCode(() -> controller.run(null)).doesNotThrowAnyException();
    }
}
