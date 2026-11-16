package com.planilla.backend.config;

import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class H2MigrationScriptTest {

    private JdbcDataSource dataSource;
    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
        jdbc = new JdbcTemplate(dataSource);
    }

    private void runStrict(String script) {
        ResourceDatabasePopulator pop = new ResourceDatabasePopulator(new ClassPathResource(script));
        pop.setContinueOnError(false);
        pop.execute(dataSource);
    }

    private List<String> columns(String table) {
        return jdbc.queryForList(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ?",
            String.class, table.toUpperCase());
    }

    @Test
    void migrationSucceedsOnFreshDatabase() {
        runStrict("migrate-holiday-year.sql");
        runStrict("schema-h2.sql");

        assertThat(columns("holiday_cache")).contains("HOLIDAY_YEAR").doesNotContain("YEAR");
    }

    @Test
    void migrationRenamesLegacyYearColumnAndAddsMissingColumns() {
        jdbc.execute("CREATE TABLE holiday_cache (id BIGINT PRIMARY KEY, \"YEAR\" INTEGER)");
        jdbc.execute("CREATE TABLE employee_registry (id BIGINT PRIMARY KEY)");
        jdbc.execute("CREATE TABLE shift_config (id BIGINT PRIMARY KEY)");

        runStrict("migrate-holiday-year.sql");

        assertThat(columns("holiday_cache")).contains("HOLIDAY_YEAR").doesNotContain("YEAR");
        assertThat(columns("employee_registry")).contains("ACCRUES_OVERTIME");
        assertThat(columns("shift_config"))
            .contains("DETECTION_BEFORE_MINUTES", "DETECTION_AFTER_MINUTES");
    }

    @Test
    void migrationIsANoOpOnAlreadyMigratedDatabase() {
        runStrict("migrate-holiday-year.sql");
        runStrict("schema-h2.sql");

        runStrict("migrate-holiday-year.sql");

        assertThat(columns("holiday_cache")).contains("HOLIDAY_YEAR").doesNotContain("YEAR");
    }
}
