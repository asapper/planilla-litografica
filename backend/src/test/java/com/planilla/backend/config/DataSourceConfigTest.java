package com.planilla.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
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

    @Test
    void h2Url_doesNotEnableAutoServer() throws IOException {
        Properties props = new Properties();
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("application.properties")) {
            props.load(is);
        }
        assertThat(props.getProperty("h2.datasource.url")).doesNotContain("AUTO_SERVER");
    }
}
