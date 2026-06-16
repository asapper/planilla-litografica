package com.planilla.backend.service.tas;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AppConfigService {

    private final JdbcTemplate jdbc;

    public AppConfigService(@Qualifier("h2JdbcTemplate") JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public int getLegalBreakAllowanceMinutes() {
        try {
            String value = jdbc.queryForObject(
                "SELECT config_value FROM app_config WHERE config_key = 'legalBreakAllowanceMinutes'",
                String.class
            );
            return value != null ? Integer.parseInt(value) : 45;
        } catch (Exception e) {
            return 45;
        }
    }

    public void setLegalBreakAllowanceMinutes(int minutes) {
        jdbc.update(
            "MERGE INTO app_config (config_key, config_value) KEY(config_key) VALUES ('legalBreakAllowanceMinutes', ?)",
            String.valueOf(minutes)
        );
    }

    public int getMaxSessionSpanMinutes() {
        try {
            String value = jdbc.queryForObject(
                "SELECT config_value FROM app_config WHERE config_key = 'maxSessionSpanMinutes'",
                String.class
            );
            return value != null ? Integer.parseInt(value) : 780;
        } catch (Exception e) {
            return 780;
        }
    }

    public void setMaxSessionSpanMinutes(int minutes) {
        jdbc.update(
            "MERGE INTO app_config (config_key, config_value) KEY(config_key) VALUES ('maxSessionSpanMinutes', ?)",
            String.valueOf(minutes)
        );
    }
}
