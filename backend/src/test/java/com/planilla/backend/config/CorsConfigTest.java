package com.planilla.backend.config;

import com.planilla.backend.controller.HealthController;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(HealthController.class)
@Import(CorsConfig.class)
class CorsConfigTest {

    @Autowired MockMvc mvc;

    @MockBean(name = "postgresJdbcTemplate")
    JdbcTemplate postgresJdbc;

    @ParameterizedTest
    @ValueSource(strings = {
            "http://localhost:5173",
            "tauri://localhost",
            "https://tauri.localhost"
    })
    void allowedOriginReturnsAccessControlHeaders(String origin) throws Exception {
        mvc.perform(options("/api/health")
                .header("Origin", origin)
                .header("Access-Control-Request-Method", "GET"))
           .andExpect(status().isOk())
           .andExpect(header().string("Access-Control-Allow-Origin", origin));
    }

    @Test
    void disallowedOriginDoesNotReturnAccessControlHeaders() throws Exception {
        mvc.perform(options("/api/health")
                .header("Origin", "https://evil.example.com")
                .header("Access-Control-Request-Method", "GET"))
           .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void wildcardOriginIsRejected() throws Exception {
        mvc.perform(get("/api/health")
                .header("Origin", "http://attacker.local:8080"))
           .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }
}
