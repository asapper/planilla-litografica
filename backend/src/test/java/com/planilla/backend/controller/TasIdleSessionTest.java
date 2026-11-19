package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.service.tas.TasDraftService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The user uploads a file, works through verification, walks away for as long as they like (a weekend) (the
 * backend may even restart), then clicks "Revisar". Version 1.2.2 dropped the upload 30 minutes
 * after it was made, so "Revisar" failed and the work was lost. Runs the real controller, draft
 * store and pipeline; only time is moved forward.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TasIdleSessionTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired TasController tasController;
    @Autowired TasDraftService draftService;

    @AfterEach
    void tearDown() {
        tasController.stateStore.clear();
        draftService.delete();
    }

    private JsonNode upload() throws Exception {
        byte[] csv = getClass().getResourceAsStream("/fixtures/multi-employee-march.csv").readAllBytes();
        String body = mvc.perform(multipart("/api/tas/upload")
                        .file(new MockMultipartFile("file", "marzo.csv", "text/csv", csv)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return mapper.readTree(body);
    }

    private void saveDraftLikeTheApp(String token, long revision) throws Exception {
        Map<String, Object> draft = Map.of(
                "uploadToken", token,
                "stateRevision", revision,
                "fileName", "marzo.csv",
                "view", "verification",
                "periodLabel", "Marzo 2026 - Quincena 2",
                "ui", Map.of("tasView", "verification", "uiVersion", 1));
        mvc.perform(put("/api/tas/draft").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(draft)))
                .andExpect(status().isNoContent());
    }

    private void walkAway(String token, Duration away) {
        tasController.stateStore.get(token).setLastAccessedAt(Instant.now().minus(away));
        tasController.evictStaleStates();
    }

    private void restartBackend() {
        tasController.stateStore.clear();
    }

    private org.springframework.test.web.servlet.ResultActions revisar(String token) throws Exception {
        return mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("uploadToken", token, "resolutions", List.of()))));
    }

    private JsonNode revisarBody(String token) throws Exception {
        return mapper.readTree(revisar(token).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    @Test
    void revisarWorksAfterAWeekendAwayAndARestart() throws Exception {
        JsonNode uploaded = upload();
        String token = uploaded.get("uploadToken").asText();
        JsonNode before = revisarBody(token);
        long revision = before.get("stateRevision").asLong();
        assertThat(before.get("resolvedRows").size()).as("the fixture yields rows").isGreaterThan(0);
        saveDraftLikeTheApp(token, revision);

        walkAway(token, Duration.ofDays(3));
        assertThat(tasController.stateStore).as("the saved session is never evicted").containsKey(token);

        restartBackend();
        JsonNode after = revisarBody(token);
        assertThat(after.get("stateRevision").asLong()).isEqualTo(revision + 1);
        for (String field : List.of("uploadToken", "resolvedRows", "flaggedSessions", "availablePeriods", "sessionSummaries")) {
            assertThat(after.get(field)).as(field + " comes back from the saved draft").isEqualTo(before.get(field));
        }
    }

    @Test
    void withoutASavedDraftTheIdleSessionIsGone() throws Exception {
        String token = upload().get("uploadToken").asText();

        walkAway(token, Duration.ofHours(1));
        assertThat(tasController.stateStore).doesNotContainKey(token);

        revisar(token).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
    }
}
