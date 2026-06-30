package com.planilla.backend.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.DataSourceInitializer;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.core.io.ClassPathResource;

import javax.sql.DataSource;

@Configuration
public class DataSourceConfig {

    // PostgreSQL — remote, stored proc only
    @Value("${postgres.datasource.url}")        private String pgUrl;
    @Value("${postgres.datasource.username}")   private String pgUsername;
    @Value("${postgres.datasource.password}")   private String pgPassword;
    @Value("${postgres.datasource.driver-class-name}") private String pgDriver;

    // H2 — local file, duplicate log
    @Value("${h2.datasource.url}")        private String h2Url;
    @Value("${h2.datasource.username}")   private String h2Username;
    @Value("${h2.datasource.password}")   private String h2Password;

    @Bean("postgresDataSource")
    public DataSource postgresDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(pgUrl);
        config.setUsername(pgUsername);
        config.setPassword(pgPassword);
        config.setDriverClassName(pgDriver);
        config.setMaximumPoolSize(5);
        config.setMinimumIdle(1);
        config.setConnectionTimeout(6_000);      // max wait for a pool slot (ms)
        config.setIdleTimeout(300_000);
        config.setInitializationFailTimeout(-1); // start pool regardless of DB availability; StartupChecker logs the result
        // Limit the TCP connect attempt itself — without this, an unreachable host
        // hangs for the OS default (~75 s) before throwing.
        config.addDataSourceProperty("connectTimeout", "3");  // seconds
        config.addDataSourceProperty("socketTimeout",  "30"); // seconds
        return new HikariDataSource(config);
    }

    @Bean("h2DataSource")
    public DataSource h2DataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(h2Url);
        config.setUsername(h2Username);
        config.setPassword(h2Password);
        config.setDriverClassName("org.h2.Driver");
        config.setMaximumPoolSize(2);
        return new HikariDataSource(config);
    }

    @Bean("postgresJdbcTemplate")
    public JdbcTemplate postgresJdbcTemplate() {
        JdbcTemplate tpl = new JdbcTemplate(postgresDataSource());
        tpl.setQueryTimeout(10); // per-statement timeout (seconds); complements socketTimeout
        return tpl;
    }

    @Bean("h2JdbcTemplate")
    @DependsOn("tasH2Initializer")
    public JdbcTemplate h2JdbcTemplate() {
        return new JdbcTemplate(h2DataSource());
    }

    @Bean("h2Migrator")
    public DataSourceInitializer h2Migrator() {
        ResourceDatabasePopulator pop = new ResourceDatabasePopulator(
            new ClassPathResource("migrate-holiday-year.sql")
        );
        pop.setContinueOnError(true);
        DataSourceInitializer initializer = new DataSourceInitializer();
        initializer.setDataSource(h2DataSource());
        initializer.setDatabasePopulator(pop);
        return initializer;
    }

    @Bean
    @DependsOn("h2Migrator")
    public DataSourceInitializer h2Initializer() {
        DataSourceInitializer initializer = new DataSourceInitializer();
        initializer.setDataSource(h2DataSource());
        initializer.setDatabasePopulator(new ResourceDatabasePopulator(
            new ClassPathResource("schema-h2.sql")
        ));
        return initializer;
    }

    @Bean
    @DependsOn("h2Initializer")
    public DataSourceInitializer tasH2Initializer() {
        DataSourceInitializer initializer = new DataSourceInitializer();
        initializer.setDataSource(h2DataSource());
        initializer.setDatabasePopulator(new ResourceDatabasePopulator(
            new ClassPathResource("seed-shifts.sql")
        ));
        return initializer;
    }
}
