package com.planilla.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class DataSourceConfigTest {

    @Value("${postgres.datasource.username}")
    private String pgUsername;

    @Value("${postgres.datasource.password}")
    private String pgPassword;

    @Test
    void credentialPlaceholdersAreResolved() {
        assertThat(pgUsername).doesNotContain("@POSTGRES_DB_USERNAME@");
        assertThat(pgPassword).doesNotContain("@POSTGRES_DB_PASSWORD@");
    }
}
