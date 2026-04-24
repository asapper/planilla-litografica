package com.planilla.backend.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.IOException;

@Component
public class ValidationRulesConfig {

    private JsonNode rules;

    public ValidationRulesConfig() throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        File configFile = new File("config/validation-rules.json");
        if (!configFile.exists()) {
            // fallback to classpath resource during development
            rules = mapper.readTree(
                getClass().getClassLoader().getResourceAsStream("validation-rules.json")
            );
        } else {
            rules = mapper.readTree(configFile);
        }
    }

    public JsonNode getFieldRules(String fieldName) {
        return rules.path("fields").path(fieldName);
    }

    public JsonNode getAllRules() {
        return rules.path("fields");
    }
}
