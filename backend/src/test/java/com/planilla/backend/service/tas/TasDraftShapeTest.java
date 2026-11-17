package com.planilla.backend.service.tas;

import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.introspect.BeanPropertyDefinition;
import com.fasterxml.jackson.databind.ser.std.BeanSerializerBase;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

/**
 * A saved draft is read back with a mapper that ignores unknown fields and leaves missing ones at
 * their defaults, so a changed TasUploadState would resume half-filled instead of failing. This
 * pins the stored shape to SCHEMA_VERSION: changing the shape means bumping the version, which
 * turns an older draft into one the start screen offers only to discard.
 */
class TasDraftShapeTest {

    private final ObjectMapper mapper = Jackson2ObjectMapperBuilder.json().build();

    @Test
    void storedShapeMatchesTheSchemaVersion() throws IOException {
        String actual = String.join("\n", shapeOf(TasUploadState.class)) + "\n";
        String name = "tas-draft/backend-shape-v" + TasDraftService.SCHEMA_VERSION + ".txt";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(name)) {
            if (in == null || !new String(in.readAllBytes(), StandardCharsets.UTF_8).equals(actual)) {
                Path written = Path.of("target", "backend-shape-actual.txt");
                Files.writeString(written, actual);
                fail("The saved draft's shape changed (actual shape in " + written.toAbsolutePath()
                        + "). Bump TasDraftService.SCHEMA_VERSION and add src/test/resources/tas-draft/backend-shape-v"
                        + (TasDraftService.SCHEMA_VERSION + 1) + ".txt with the actual shape; keep the older files.");
            }
        }
    }

    @Test
    void everyEarlierVersionHasItsShapeOnFile() {
        for (int v = 1; v <= TasDraftService.SCHEMA_VERSION; v++) {
            assertThat(getClass().getClassLoader().getResource("tas-draft/backend-shape-v" + v + ".txt"))
                    .as("shape file for schema version %d", v).isNotNull();
        }
    }

    @Test
    void theFingerprintSeesANestedFieldChange() throws IOException {
        assertThat(shapeOf(Outer.class)).isNotEqualTo(shapeOf(OuterRenamed.class));
        assertThat(shapeOf(Outer.class)).contains("$.inner[].when: LocalDate", "$.inner[]: Inner");
    }

    TreeSet<String> shapeOf(Class<?> root) throws IOException {
        TreeSet<String> out = new TreeSet<>();
        describe(mapper.constructType(root), "$", out, new HashSet<>());
        return out;
    }

    private void describe(JavaType type, String path, Set<String> out, Set<Class<?>> open) throws IOException {
        if (type.isCollectionLikeType() || type.isArrayType()) {
            describe(type.getContentType(), path + "[]", out, open);
            return;
        }
        if (type.isMapLikeType()) {
            out.add(path + ": map<" + type.getKeyType().getRawClass().getSimpleName() + ">");
            describe(type.getContentType(), path + "{}", out, open);
            return;
        }
        Class<?> raw = type.getRawClass();
        JsonSerializer<Object> serializer = mapper.getSerializerProviderInstance().findValueSerializer(type);
        out.add(path + ": " + raw.getSimpleName());
        if (!(serializer instanceof BeanSerializerBase) || !open.add(raw)) return;
        for (BeanPropertyDefinition p : mapper.getSerializationConfig().introspect(type).findProperties()) {
            if (p.couldSerialize()) describe(p.getPrimaryType(), path + "." + p.getName(), out, open);
        }
        open.remove(raw);
    }

    static class Inner { public java.time.LocalDate when; }
    static class InnerRenamed { public java.time.LocalDate day; }
    static class Outer { public java.util.List<Inner> inner; }
    static class OuterRenamed { public java.util.List<InnerRenamed> inner; }
}
