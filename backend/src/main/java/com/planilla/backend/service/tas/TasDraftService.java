package com.planilla.backend.service.tas;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

@Service
public class TasDraftService {

    private static final Logger log = LoggerFactory.getLogger(TasDraftService.class);

    public static final int SCHEMA_VERSION = 1;

    public record Draft(
            String uploadToken,
            String fileName,
            String view,
            String periodLabel,
            Instant savedAt,
            boolean partialSubmit,
            long stateRevision,
            TasUploadState state,
            JsonNode ui) {}

    public record Summary(
            String uploadToken,
            String fileName,
            String view,
            String periodLabel,
            Instant savedAt,
            boolean partialSubmit,
            boolean resumable,
            Integer uiVersion) {}

    private record Row(
            String uploadToken,
            int schemaVersion,
            String fileName,
            String view,
            long stateRevision,
            boolean partialSubmit,
            String periodLabel,
            Instant savedAt,
            String backendState,
            String uiState) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final AtomicReference<String> warnedRow = new AtomicReference<>();

    public TasDraftService(@Qualifier("h2JdbcTemplate") JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public void save(String token, TasUploadState state, JsonNode ui,
                     String fileName, String view, String periodLabel) {
        String backendJson;
        String uiJson;
        try {
            backendJson = mapper.writeValueAsString(state);
            uiJson = mapper.writeValueAsString(ui);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("No se pudo serializar el borrador.", e);
        }
        jdbc.update(
            "MERGE INTO tas_draft (id, upload_token, schema_version, file_name, tas_view, state_revision,"
                + " partial_submit, period_label, saved_at, backend_state, ui_state) KEY(id)"
                + " VALUES (1, ?, ?, ?, ?, ?,"
                + " COALESCE((SELECT d.partial_submit FROM tas_draft d WHERE d.id = 1 AND d.upload_token = ?), FALSE),"
                + " ?, ?, ?, ?)",
            token, SCHEMA_VERSION, fileName, view, state.getRevision(),
            token,
            periodLabel, Timestamp.from(Instant.now()), backendJson, uiJson);
        flushToDisk();
    }

    public Optional<Draft> load() {
        return readRow().flatMap(this::parse);
    }

    // An outdated or unreadable draft is kept, not deleted: the start screen lists it as one that
    // can't be continued, so the user knows to upload the file again instead of losing it silently.
    public Optional<Summary> findSummary() {
        return readRow().map(row -> new Summary(row.uploadToken(), row.fileName(), row.view(),
                row.periodLabel(), row.savedAt(), row.partialSubmit(), parse(row).isPresent(),
                uiVersion(row.uiState())));
    }

    private Optional<Row> readRow() {
        try {
            List<Row> rows = jdbc.query(
                "SELECT upload_token, schema_version, file_name, tas_view, state_revision, partial_submit,"
                    + " period_label, saved_at, backend_state, ui_state FROM tas_draft WHERE id = 1",
                (rs, i) -> new Row(
                    rs.getString("upload_token"),
                    rs.getInt("schema_version"),
                    rs.getString("file_name"),
                    rs.getString("tas_view"),
                    rs.getLong("state_revision"),
                    rs.getBoolean("partial_submit"),
                    rs.getString("period_label"),
                    rs.getTimestamp("saved_at").toInstant(),
                    rs.getString("backend_state"),
                    rs.getString("ui_state")));
            return rows.stream().findFirst();
        } catch (Exception e) {
            log.warn("Could not read the TAS draft: {}", e.getMessage());
            return Optional.empty();
        }
    }

    private Optional<Draft> parse(Row row) {
        if (row.schemaVersion() != SCHEMA_VERSION) {
            warnOnce(row, "TAS draft has schema version " + row.schemaVersion()
                    + " (expected " + SCHEMA_VERSION + "); it can't be resumed.");
            return Optional.empty();
        }
        TasUploadState state;
        JsonNode ui;
        try {
            state = mapper.readValue(row.backendState(), TasUploadState.class);
            ui = mapper.readTree(row.uiState());
        } catch (Exception e) {
            warnOnce(row, "TAS draft is unreadable; it can't be resumed: " + e.getMessage());
            return Optional.empty();
        }
        state.touch();
        return Optional.of(new Draft(row.uploadToken(), row.fileName(), row.view(), row.periodLabel(),
                row.savedAt(), row.partialSubmit(), row.stateRevision(), state, ui));
    }

    // The start screen polls the summary while a job runs; one warning per saved row is enough.
    private void warnOnce(Row row, String message) {
        String key = row.uploadToken() + "@" + row.savedAt();
        if (!key.equals(warnedRow.getAndSet(key))) log.warn(message);
    }

    private Integer uiVersion(String uiJson) {
        try {
            JsonNode version = mapper.readTree(uiJson).path("uiVersion");
            return version.isInt() ? version.intValue() : null;
        } catch (Exception e) {
            return null;
        }
    }

    public TasUploadState loadState(String token) {
        if (token == null || !token.equals(currentToken())) return null;
        return load()
                .filter(d -> token.equals(d.uploadToken()))
                .map(Draft::state)
                .orElse(null);
    }

    public String currentToken() {
        try {
            List<String> tokens = jdbc.queryForList(
                "SELECT upload_token FROM tas_draft WHERE id = 1", String.class);
            return tokens.isEmpty() ? null : tokens.get(0);
        } catch (Exception e) {
            log.warn("Could not read the TAS draft token: {}", e.getMessage());
            return null;
        }
    }

    public void deleteIfToken(String token) {
        try {
            jdbc.update("DELETE FROM tas_draft WHERE id = 1 AND upload_token = ?", token);
            flushToDisk();
        } catch (Exception e) {
            log.warn("Could not delete the TAS draft for token {}: {}", token, e.getMessage());
        }
    }

    public void markPartialIfToken(String token) {
        try {
            jdbc.update("UPDATE tas_draft SET partial_submit = TRUE WHERE id = 1 AND upload_token = ?", token);
            flushToDisk();
        } catch (Exception e) {
            log.warn("Could not mark the TAS draft as partially submitted: {}", e.getMessage());
        }
    }

    public void delete() {
        jdbc.update("DELETE FROM tas_draft WHERE id = ?", 1);
        flushToDisk();
    }

    // The desktop shell force-kills the backend on every app close, and H2 keeps recent commits
    // in memory for up to a second; without this a save or delete that already returned can vanish.
    private void flushToDisk() {
        try {
            jdbc.execute("CHECKPOINT");
        } catch (Exception e) {
            log.warn("Could not flush the TAS draft to disk: {}", e.getMessage());
        }
    }
}
