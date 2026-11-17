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
            boolean partialSubmit) {}

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
    }

    public Optional<Draft> load() {
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
            if (rows.isEmpty()) return Optional.empty();
            Row row = rows.get(0);
            if (row.schemaVersion() != SCHEMA_VERSION) {
                log.warn("Discarding TAS draft with schema version {} (expected {}).",
                        row.schemaVersion(), SCHEMA_VERSION);
                deleteQuietly();
                return Optional.empty();
            }
            TasUploadState state;
            JsonNode ui;
            try {
                state = mapper.readValue(row.backendState(), TasUploadState.class);
                ui = mapper.readTree(row.uiState());
            } catch (Exception e) {
                log.warn("Discarding unreadable TAS draft: {}", e.getMessage());
                deleteQuietly();
                return Optional.empty();
            }
            state.touch();
            return Optional.of(new Draft(row.uploadToken(), row.fileName(), row.view(), row.periodLabel(),
                    row.savedAt(), row.partialSubmit(), row.stateRevision(), state, ui));
        } catch (Exception e) {
            log.warn("Could not read the TAS draft: {}", e.getMessage());
            return Optional.empty();
        }
    }

    public Optional<Summary> findSummary() {
        return load().map(d -> new Summary(d.uploadToken(), d.fileName(), d.view(), d.periodLabel(),
                d.savedAt(), d.partialSubmit()));
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
        } catch (Exception e) {
            log.warn("Could not delete the TAS draft for token {}: {}", token, e.getMessage());
        }
    }

    public void markPartialIfToken(String token) {
        try {
            jdbc.update("UPDATE tas_draft SET partial_submit = TRUE WHERE id = 1 AND upload_token = ?", token);
        } catch (Exception e) {
            log.warn("Could not mark the TAS draft as partially submitted: {}", e.getMessage());
        }
    }

    public void delete() {
        jdbc.update("DELETE FROM tas_draft WHERE id = ?", 1);
    }

    private void deleteQuietly() {
        try {
            delete();
        } catch (Exception e) {
            log.warn("Could not delete the TAS draft: {}", e.getMessage());
        }
    }
}
