package com.planilla.backend.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for ValidationRulesConfig.
 *
 * Requirements:
 * - When no external file present: loads rules from classpath resource
 * - When config/validation-rules.json exists: loads from that file (external config)
 * - getFieldRules() returns the correct rules node for a given field name
 * - getFieldRules() returns a missing node for an unknown field
 * - getAllRules() returns the full fields object
 */
class ValidationRulesConfigTest {

    @Test
    void loadsFromClasspathWhenNoExternalFilePresent() throws Exception {
        ValidationRulesConfig config = new ValidationRulesConfig();
        assertThat(config.getFieldRules("mes").path("type").asText()).isEqualTo("integer");
    }

    @Test
    void getFieldRulesReturnsMissingNodeForUnknownField() throws Exception {
        ValidationRulesConfig config = new ValidationRulesConfig();
        assertThat(config.getFieldRules("nonexistent_field").isMissingNode()).isTrue();
    }

    @Test
    void getAllRulesReturnsFieldsObject() throws Exception {
        ValidationRulesConfig config = new ValidationRulesConfig();
        assertThat(config.getAllRules().has("mes")).isTrue();
        assertThat(config.getAllRules().has("anio")).isTrue();
    }

    /**
     * Tests the `else` branch: when config/validation-rules.json exists in the
     * working directory, the config is loaded from that file rather than classpath.
     *
     * We create the file temporarily in a predictable location by writing it to
     * the project's config/ directory, then clean it up afterward.
     */
    @Test
    void loadsFromExternalFileWhenPresent(@TempDir Path tempDir) throws Exception {
        // Write a custom rules file with a recognizable sentinel value
        String customRules = "{\n"
            + "  \"fields\": {\n"
            + "    \"mes\": { \"required\": true, \"type\": \"integer\", \"min\": 1, \"max\": 12 },\n"
            + "    \"custom_test_field\": { \"required\": false, \"type\": \"string\" }\n"
            + "  }\n"
            + "}\n";

        // Place the file where ValidationRulesConfig expects it:
        // new File("config/validation-rules.json") — relative to the JVM working directory.
        Path configDir = Path.of("config");
        Path rulesFile = configDir.resolve("validation-rules.json");
        boolean dirAlreadyExisted = Files.exists(configDir);
        boolean fileAlreadyExisted = Files.exists(rulesFile);

        try {
            if (!dirAlreadyExisted) Files.createDirectories(configDir);
            Files.writeString(rulesFile, customRules);

            ValidationRulesConfig config = new ValidationRulesConfig();

            // custom_test_field only exists in our external file, not in the classpath resource
            assertThat(config.getFieldRules("custom_test_field").path("type").asText())
                .isEqualTo("string");
            assertThat(config.getFieldRules("mes").path("max").asInt()).isEqualTo(12);

        } finally {
            // Only delete the file if we created it (don't touch a pre-existing external config)
            if (!fileAlreadyExisted) Files.deleteIfExists(rulesFile);
            if (!dirAlreadyExisted) {
                try { Files.delete(configDir); } catch (Exception ignored) {}
            }
        }
    }
}
