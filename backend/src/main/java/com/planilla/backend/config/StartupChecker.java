package com.planilla.backend.config;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@Lazy(false)
public class StartupChecker {

    private static final Logger log = LoggerFactory.getLogger(StartupChecker.class);

    private final JdbcTemplate postgresJdbc;

    public StartupChecker(@Qualifier("postgresJdbcTemplate") JdbcTemplate postgresJdbc) {
        this.postgresJdbc = postgresJdbc;
    }

    @PostConstruct
    public void checkDatabaseConnectivity() {
        try {
            postgresJdbc.queryForObject("SELECT 1", Integer.class);
            log.info("PostgreSQL connectivity check passed.");
        } catch (Exception e) {
            log.warn("PostgreSQL is unreachable at startup — submissions will fail until the database is available: {}", e.getMessage());
        }
    }
}
