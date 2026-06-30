package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * Verifies the {@code demo.mode} property defaults to {@code false} when absent,
 * so production builds (which never set it) submit to the real database.
 */
class DemoModeDefaultTest {

    @Test
    void demoModeDefaultsToFalseWhenPropertyAbsent() {
        new ApplicationContextRunner()
                .withUserConfiguration(MockTemplates.class)
                .withBean(DatabaseService.class)
                // no demo.mode property — the @Value default must apply
                .run(context -> {
                    DatabaseService service = context.getBean(DatabaseService.class);
                    JdbcTemplate postgres = context.getBean("postgresJdbcTemplate", JdbcTemplate.class);

                    EmployeeRow row = new EmployeeRow();
                    row.setCodigoEmpleado("10");
                    row.setNombreEmpleado("Test");
                    row.setDiasNoLaborados(0);
                    row.setHorasExtrasSimples(0);
                    row.setHorasExtrasDobles(0);
                    row.setNumeroDequincena(1);
                    row.setMes(6);
                    row.setAnio(2026);

                    service.submitRow(row);

                    // default false → the Postgres stored procedure is invoked, not skipped
                    verify(postgres).queryForObject(
                            anyString(), eq(Integer.class),
                            any(), any(), any(), any(), any(), any(), any());
                });
    }

    @Configuration
    static class MockTemplates {
        @Bean
        JdbcTemplate postgresJdbcTemplate() {
            return mock(JdbcTemplate.class);
        }

        @Bean
        JdbcTemplate h2JdbcTemplate() {
            return mock(JdbcTemplate.class);
        }
    }
}
