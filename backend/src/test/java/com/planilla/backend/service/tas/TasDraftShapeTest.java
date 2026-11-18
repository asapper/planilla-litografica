package com.planilla.backend.service.tas;

import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.introspect.BeanPropertyDefinition;
import com.fasterxml.jackson.databind.ser.std.BeanSerializerBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

/**
 * A saved draft is read back with a mapper that ignores unknown fields and leaves missing ones at
 * their defaults, so a changed TasUploadState would resume half-filled instead of failing. This
 * pins the stored shape to SCHEMA_VERSION: changing the shape means bumping the version, which
 * turns an older draft into one the start screen offers only to discard.
 * Enum constants are left out on purpose: a draft holding a removed constant fails to read and is
 * already shown as not resumable, and adding one must not discard every saved draft.
 */
@JsonTest
class TasDraftShapeTest {

    @Autowired ObjectMapper mapper;

    @Test
    void storedShapeMatchesTheSchemaVersion() throws IOException {
        String actual = String.join("\n", shapeOf(TasUploadState.class)) + "\n";
        String name = "tas-draft/backend-shape-v" + TasDraftService.SCHEMA_VERSION + ".txt";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(name)) {
            if (in == null || !normalized(new String(in.readAllBytes(), StandardCharsets.UTF_8)).equals(normalized(actual))) {
                Path written = Path.of("target", "backend-shape-actual.txt");
                Files.writeString(written, actual);
                fail("The saved draft's shape changed (actual shape in " + written.toAbsolutePath()
                        + "). Bump TasDraftService.SCHEMA_VERSION and add src/test/resources/tas-draft/backend-shape-v"
                        + (TasDraftService.SCHEMA_VERSION + 1) + ".txt with the actual shape; keep the older files.");
            }
        }
    }

    // A Windows checkout may turn the file's line endings into CRLF.
    static String normalized(String text) {
        return text.replace("\r\n", "\n").strip();
    }

    @Test
    void aWindowsCheckoutOfTheShapeFileStillMatches() {
        assertThat(normalized("$: A\r\n$.b: B\r\n")).isEqualTo(normalized("$: A\n$.b: B\n"));
        assertThat(normalized("$: A\n$.b: B")).isEqualTo(normalized("$: A\n$.b: B\n\n"));
        assertThat(normalized("$: A\n$.b: B\n")).isNotEqualTo(normalized("$: A\n$.c: B\n"));
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

    @Test
    void theFingerprintSeesChangesInsideMapsAndRetypes() throws IOException {
        assertThat(shapeOf(ByKey.class)).contains("$.byKey: map<String>", "$.byKey{}[].when: LocalDate");
        assertThat(shapeOf(ByKey.class)).isNotEqualTo(shapeOf(ByKeyRenamed.class));
        assertThat(shapeOf(Inner.class)).isNotEqualTo(shapeOf(InnerRetyped.class));
    }

    @Test
    void theFingerprintFlagsAFieldThatIsWrittenButNotReadBack() throws IOException {
        assertThat(shapeOf(WriteOnly.class)).contains("$.total: not read back");
        assertThat(shapeOf(Inner.class)).noneMatch(line -> line.contains("not read back"));
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
        Set<String> readBack = mapper.getDeserializationConfig().introspect(type).findProperties().stream()
                .filter(BeanPropertyDefinition::couldDeserialize)
                .map(BeanPropertyDefinition::getName)
                .collect(Collectors.toSet());
        for (BeanPropertyDefinition p : mapper.getSerializationConfig().introspect(type).findProperties()) {
            if (!p.couldSerialize()) continue;
            if (!readBack.contains(p.getName())) out.add(path + "." + p.getName() + ": not read back");
            describe(p.getPrimaryType(), path + "." + p.getName(), out, open);
        }
        open.remove(raw);
    }

    static class Inner { public java.time.LocalDate when; }
    static class InnerRenamed { public java.time.LocalDate day; }
    static class Outer { public java.util.List<Inner> inner; }
    static class OuterRenamed { public java.util.List<InnerRenamed> inner; }
    static class InnerRetyped { public java.time.LocalDateTime when; }
    static class ByKey { public java.util.Map<String, java.util.List<Inner>> byKey; }
    static class ByKeyRenamed { public java.util.Map<String, java.util.List<InnerRenamed>> byKey; }
    static class WriteOnly { public int getTotal() { return 1; } }
}
