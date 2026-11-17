package com.planilla.backend.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasInactiveEmployee;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasUploadResult;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.JobInProgressException;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.tas.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** TASK-88: revisions, locked draft writes, resume, idle eviction and draft-backed rehydration. */
@WebMvcTest(TasController.class)
class TasControllerDraftTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired TasController tasController;

    @MockBean TasParserService        parserService;
    @MockBean TasUploadService        uploadService;
    @MockBean TasHoursCalculator      hoursCalculator;
    @MockBean TasReportBuilder        reportBuilder;
    @MockBean EmployeeRegistryService registryService;
    @MockBean JobService              jobService;
    @MockBean ShiftConfigService      shiftConfigService;
    @MockBean DatabaseService         databaseService;
    @MockBean TasDraftService         draftService;

    private final ExecutorService pool = Executors.newCachedThreadPool();

    @AfterEach
    void tearDown() {
        tasController.stateStore.clear();
        pool.shutdownNow();
    }

    private String json(Object o) throws Exception { return mapper.writeValueAsString(o); }

    private TasUploadResult result(List<TasSession> sessions) {
        TasUploadResult r = new TasUploadResult();
        r.setResolvedRows(new ArrayList<>());
        r.setFlaggedSessions(new ArrayList<>(sessions));
        r.setAllSessions(new ArrayList<>(sessions));
        r.setWarnings(new ArrayList<>());
        r.setInactiveEmployeesFound(new ArrayList<>());
        r.setAbsentActiveEmployees(new ArrayList<>());
        return r;
    }

    private TasUploadResult withInactive(TasUploadResult r) {
        TasInactiveEmployee e = new TasInactiveEmployee();
        e.setEmployeeId("100");
        e.setName("Inactivo");
        r.setInactiveEmployeesFound(List.of(e));
        return r;
    }

    private TasSession flagged(int id) {
        TasSession s = new TasSession();
        s.setSessionId(id);
        s.setEmployeeId("100");
        s.setDate(LocalDate.of(2026, 10, 3));
        s.setNeedsResolution(true);
        s.setFlags(new ArrayList<>(List.of(TasFlag.MISSING_EXIT)));
        return s;
    }

    private TasUploadState stateWith(String token, long revision, TasSession... sessions) {
        TasUploadState state = new TasUploadState();
        state.setUploadToken(token);
        state.setSessions(new ArrayList<>(List.of(sessions)));
        state.setAllScans(new ArrayList<TasScanRecord>());
        state.setIgnoredEmployeeIds(new HashSet<>());
        state.setRevision(revision);
        return state;
    }

    private void stubBuild() {
        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>()));
    }

    private Map<String, Object> draftBody(String token, long revision) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uploadToken", token);
        body.put("stateRevision", revision);
        body.put("fileName", "oct.csv");
        body.put("view", "verification");
        body.put("periodLabel", "Octubre 2026 - Quincena 1");
        body.put("ui", Map.of("tasView", "verification"));
        return body;
    }

    private MvcResult putDraft(Map<String, Object> body) throws Exception {
        return mvc.perform(put("/api/tas/draft").contentType(MediaType.APPLICATION_JSON).content(json(body)))
                .andReturn();
    }

    // ── upload ───────────────────────────────────────────────────────────────

    @Test
    void upload_startsAtRevisionOneAndDiscardsThePreviousDraft() throws Exception {
        when(parserService.parse(any())).thenReturn(new TasParserService.ParseResult(new ArrayList<>(), new ArrayList<>()));
        when(uploadService.processScans(any(), any(), any())).thenReturn(result(List.of()));
        stubBuild();

        mvc.perform(multipart("/api/tas/upload").file(new MockMultipartFile("file", "a.csv", "text/csv", "x".getBytes())))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(1));

        verify(draftService).delete();
        assertThat(tasController.stateStore.values()).singleElement()
                .satisfies(s -> assertThat(s.getRevision()).isEqualTo(1));
    }

    @Test
    void upload_withInactiveEmployeesAlsoStartsAtRevisionOne() throws Exception {
        when(parserService.parse(any())).thenReturn(new TasParserService.ParseResult(new ArrayList<>(), new ArrayList<>()));
        when(uploadService.processScans(any(), any(), any())).thenReturn(withInactive(result(List.of())));
        stubBuild();

        mvc.perform(multipart("/api/tas/upload").file(new MockMultipartFile("file", "a.csv", "text/csv", "x".getBytes())))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(1));
        verify(draftService).delete();
    }

    @Test
    void upload_draftDeleteFailureDoesNotFailTheUpload() throws Exception {
        when(parserService.parse(any())).thenReturn(new TasParserService.ParseResult(new ArrayList<>(), new ArrayList<>()));
        when(uploadService.processScans(any(), any(), any())).thenReturn(result(List.of()));
        stubBuild();
        doThrow(new RuntimeException("h2 down")).when(draftService).delete();

        mvc.perform(multipart("/api/tas/upload").file(new MockMultipartFile("file", "a.csv", "text/csv", "x".getBytes())))
           .andExpect(status().isOk());
    }

    @Test
    void upload_failureKeepsTheDraft() throws Exception {
        when(parserService.parse(any())).thenThrow(new ParseValidationException("Columnas requeridas no encontradas."));

        mvc.perform(multipart("/api/tas/upload").file(new MockMultipartFile("file", "a.csv", "text/csv", "x".getBytes())))
           .andExpect(status().isBadRequest());

        verify(draftService, never()).delete();
    }

    // ── inactive-review ──────────────────────────────────────────────────────

    @Test
    void inactiveReview_whenInactiveRemain_bumpsInPlace() throws Exception {
        TasUploadState state = stateWith("tok", 1);
        tasController.stateStore.put("tok", state);
        when(uploadService.processScans(any(), any(), any())).thenReturn(withInactive(result(List.of())));
        stubBuild();

        mvc.perform(post("/api/tas/inactive-review").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "reactivate", List.of(), "ignore", List.of("7")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(2));

        assertThat(tasController.stateStore.get("tok")).isSameAs(state);
        assertThat(state.getRevision()).isEqualTo(2);
        assertThat(state.getIgnoredEmployeeIds()).containsExactly("7");
    }

    @Test
    void inactiveReview_whenComplete_swapsInANewStateAtTheNextRevision() throws Exception {
        TasUploadState state = stateWith("tok", 4);
        tasController.stateStore.put("tok", state);
        when(uploadService.processScans(any(), any(), any())).thenReturn(result(List.of(flagged(1))));
        stubBuild();

        mvc.perform(post("/api/tas/inactive-review").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok"))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(5));

        TasUploadState swapped = tasController.stateStore.get("tok");
        assertThat(swapped).isNotSameAs(state);
        assertThat(swapped.getRevision()).isEqualTo(5);
    }

    @Test
    void inactiveReview_putWithThePreReviewRevisionIs409AfterTheSwap() throws Exception {
        TasUploadState state = stateWith("tok", 1);
        tasController.stateStore.put("tok", state);
        when(uploadService.processScans(any(), any(), any())).thenReturn(result(List.of(flagged(1))));
        stubBuild();
        mvc.perform(post("/api/tas/inactive-review").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok"))))
           .andExpect(status().isOk());

        Map<String, Object> body = draftBody("tok", 1);
        body.put("view", "inactiveReview");
        MvcResult res = putDraft(body);

        assertThat(res.getResponse().getStatus()).isEqualTo(409);
        assertThat(res.getResponse().getContentAsString()).contains("DRAFT_STALE");
        verify(draftService, never()).save(any(), any(), any(), any(), any(), any());
    }

    @Test
    void inactiveReview_putHoldingTheOldStateObjectIs409EvenWithAMatchingRevision() throws Exception {
        TasUploadState old = stateWith("tok", 1);
        tasController.stateStore.put("tok", old);
        CountDownLatch inLookup = new CountDownLatch(1);
        when(draftService.loadState(any())).thenReturn(null);
        // The PUT has looked up `old`; the state is replaced before it takes the lock.
        TasUploadState replacement = stateWith("tok", 1);
        Future<MvcResult> put;
        synchronized (old) {
            put = pool.submit(() -> {
                inLookup.countDown();
                return putDraft(draftBody("tok", 1));
            });
            inLookup.await();
            Thread.sleep(200);
            tasController.stateStore.put("tok", replacement);
        }

        assertThat(put.get(5, TimeUnit.SECONDS).getResponse().getStatus()).isEqualTo(409);
        verify(draftService, never()).save(any(), any(), any(), any(), any(), any());
    }

    @Test
    void inactiveReview_stateReplacedBeforeTheLockIs409WithoutSideEffects() throws Exception {
        TasUploadState old = stateWith("tok", 1);
        tasController.stateStore.put("tok", old);
        Future<MvcResult> review;
        synchronized (old) {
            review = pool.submit(() -> mvc.perform(post("/api/tas/inactive-review")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("uploadToken", "tok", "reactivate", List.of("100"))))).andReturn());
            Thread.sleep(300);
            tasController.stateStore.put("tok", stateWith("tok", 1));
        }

        MvcResult res = review.get(5, TimeUnit.SECONDS);
        assertThat(res.getResponse().getStatus()).isEqualTo(409);
        assertThat(res.getResponse().getContentAsString()).contains("STATE_CHANGED");
        verify(registryService, never()).setActive(any(), anyBoolean());
        assertThat(old.getRevision()).isEqualTo(1);
    }

    @Test
    void inactiveReview_replaceThatLosesTheRaceIs409() throws Exception {
        TasUploadState state = stateWith("tok", 1);
        tasController.stateStore.put("tok", state);
        when(uploadService.processScans(any(), any(), any())).thenAnswer(inv -> {
            tasController.stateStore.remove("tok");
            return result(List.of());
        });
        stubBuild();

        mvc.perform(post("/api/tas/inactive-review").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok"))))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.code").value("STATE_CHANGED"));
    }

    @Test
    void inactiveReview_rejectsNonStringLists() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 1));

        mvc.perform(post("/api/tas/inactive-review").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "reactivate", "100"))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_FIELD_FORMAT"));
        mvc.perform(post("/api/tas/inactive-review").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "ignore", List.of(1, 2)))))
           .andExpect(status().isBadRequest());
        assertThat(tasController.stateStore.get("tok").getRevision()).isEqualTo(1);
    }

    // ── resolve / recompute revisions ────────────────────────────────────────

    @Test
    void resolve_bumpsTheRevisionAndReturnsIt() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 2, flagged(1)));
        stubBuild();

        Map<String, Object> res = Map.of("sessionId", 1,
                "resolvedStart", "2026-10-03 07:00", "resolvedEnd", "2026-10-03 15:00");
        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(res)))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(3))
           .andExpect(jsonPath("$.flaggedSessions").isEmpty());
    }

    @Test
    void resolve_thatLeavesSessionsUnresolvedStillBumpsAndReturnsTheRevision() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 2, flagged(1), flagged(2)));
        stubBuild();

        Map<String, Object> res = Map.of("sessionId", 1,
                "resolvedStart", "2026-10-03 07:00", "resolvedEnd", "2026-10-03 15:00");
        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(res)))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(3))
           .andExpect(jsonPath("$.flaggedSessions.length()").value(1));
    }

    @Test
    void resolve_mixedValidAndInvalidBatchIs400AndLeavesStateAndRevisionUntouched() throws Exception {
        TasSession first = flagged(1);
        TasSession second = flagged(2);
        TasUploadState state = stateWith("tok", 5, first, second);
        tasController.stateStore.put("tok", state);
        stubBuild();

        Map<String, Object> valid = Map.of("sessionId", 1,
                "resolvedStart", "2026-10-03 07:00", "resolvedEnd", "2026-10-03 15:00");
        Map<String, Object> invalid = Map.of("sessionId", 2,
                "resolvedStart", "2026-10-03 15:00", "resolvedEnd", "2026-10-03 07:00");
        Map<String, Object> sameDay = Map.of("employeeId", "100", "date", "2026-10-03", "keepSessionId", "all");

        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(sameDay, valid, invalid),
                        "anio", 2026, "mes", 10, "numeroDequincena", 1))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TIME_RANGE"));

        assertThat(state.getRevision()).isEqualTo(5);
        assertThat(first.isNeedsResolution()).isTrue();
        assertThat(first.getEffectiveStart()).isNull();
        assertThat(first.getFlags()).containsExactly(TasFlag.MISSING_EXIT);
        assertThat(state.getResolvedPeriod()).isNull();
        verify(reportBuilder, never()).build(any(), any(), any(), any(), any());
        verify(hoursCalculator, never()).classifyHours(any(), any());
    }

    @Test
    void resolve_rejectsMalformedBatchShapes() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 1, flagged(1)));
        stubBuild();

        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", "x"))))
           .andExpect(status().isBadRequest());
        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(5)))))
           .andExpect(status().isBadRequest());
        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(),
                        "anio", "2026", "mes", 10, "numeroDequincena", 1))))
           .andExpect(status().isBadRequest());
        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", 42))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TOKEN"));

        assertThat(tasController.stateStore.get("tok").getRevision()).isEqualTo(1);
    }

    @Test
    void recompute_bumpsTheRevisionAndReturnsIt() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 7));
        stubBuild();

        mvc.perform(post("/api/tas/recompute/tok"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(8));
    }

    // ── PUT /draft ───────────────────────────────────────────────────────────

    @Test
    void putDraft_savesWhenTheRevisionMatches() throws Exception {
        TasUploadState state = stateWith("tok", 3);
        tasController.stateStore.put("tok", state);

        assertThat(putDraft(draftBody("tok", 3)).getResponse().getStatus()).isEqualTo(204);

        verify(draftService).save(eq("tok"), same(state), argThat((JsonNode ui) ->
                "verification".equals(ui.get("tasView").asText())),
                eq("oct.csv"), eq("verification"), eq("Octubre 2026 - Quincena 1"));
    }

    @Test
    void putDraft_acceptsNullFileNameAndPeriod() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 3));
        Map<String, Object> body = draftBody("tok", 3);
        body.put("fileName", null);
        body.remove("periodLabel");

        assertThat(putDraft(body).getResponse().getStatus()).isEqualTo(204);
        verify(draftService).save(eq("tok"), any(), any(), isNull(), eq("verification"), isNull());
    }

    @Test
    void putDraft_unknownTokenIs409AndWritesNothing() throws Exception {
        MvcResult res = putDraft(draftBody("missing", 1));

        assertThat(res.getResponse().getStatus()).isEqualTo(409);
        assertThat(res.getResponse().getContentAsString()).contains("DRAFT_STALE");
        verify(draftService, never()).save(any(), any(), any(), any(), any(), any());
    }

    @Test
    void putDraft_staleRevisionIs409AndWritesNothing() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 4));

        assertThat(putDraft(draftBody("tok", 3)).getResponse().getStatus()).isEqualTo(409);
        verify(draftService, never()).save(any(), any(), any(), any(), any(), any());
    }

    @Test
    void putDraft_rejectsMalformedBodies() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 1));
        List<Map<String, Object>> bad = new ArrayList<>();
        Map<String, Object> b;
        b = draftBody("tok", 1); b.remove("uploadToken"); bad.add(b);
        b = draftBody("tok", 1); b.put("uploadToken", ""); bad.add(b);
        b = draftBody("tok", 1); b.put("uploadToken", "x".repeat(65)); bad.add(b);
        b = draftBody("tok", 1); b.put("stateRevision", "1"); bad.add(b);
        b = draftBody("tok", 1); b.put("stateRevision", 1.5); bad.add(b);
        b = draftBody("tok", 1); b.remove("stateRevision"); bad.add(b);
        b = draftBody("tok", 1); b.put("view", "result"); bad.add(b);
        b = draftBody("tok", 1); b.put("view", 3); bad.add(b);
        b = draftBody("tok", 1); b.put("ui", "x"); bad.add(b);
        b = draftBody("tok", 1); b.remove("ui"); bad.add(b);
        b = draftBody("tok", 1); b.put("fileName", 5); bad.add(b);
        b = draftBody("tok", 1); b.put("fileName", "x".repeat(256)); bad.add(b);
        b = draftBody("tok", 1); b.put("periodLabel", "x".repeat(65)); bad.add(b);
        for (Map<String, Object> body : bad) {
            assertThat(putDraft(body).getResponse().getStatus()).as(body.toString()).isEqualTo(400);
        }
        mvc.perform(put("/api/tas/draft").contentType(MediaType.APPLICATION_JSON).content("[1,2]"))
           .andExpect(status().isBadRequest());
        verify(draftService, never()).save(any(), any(), any(), any(), any(), any());
    }

    private void assertPutBlocksOnTheLockThen409(String token, Runnable startMutation, CountDownLatch mutationEntered,
                                                 CountDownLatch releaseMutation) throws Exception {
        startMutation.run();
        assertThat(mutationEntered.await(5, TimeUnit.SECONDS)).isTrue();

        Future<MvcResult> put = pool.submit(() -> putDraft(draftBody(token, 1)));
        Thread.sleep(300);
        assertThat(put.isDone()).as("PUT must wait for the in-flight mutation's lock").isFalse();
        verify(draftService, never()).save(any(), any(), any(), any(), any(), any());

        releaseMutation.countDown();
        MvcResult res = put.get(5, TimeUnit.SECONDS);
        assertThat(res.getResponse().getStatus()).isEqualTo(409);
        verify(draftService, never()).save(any(), any(), any(), any(), any(), any());
        assertThat(tasController.stateStore.get(token).getRevision()).isEqualTo(2);
    }

    @Test
    void putDraft_racingAnInFlightResolve_waitsForTheLockAndIsRejected() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 1, flagged(1)));
        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(reportBuilder.build(any(), any(), any(), any(), any())).thenAnswer(inv -> {
            entered.countDown();
            release.await(5, TimeUnit.SECONDS);
            return new TasReportBuilder.BuildResult(new ArrayList<>());
        });
        Map<String, Object> res = Map.of("sessionId", 1,
                "resolvedStart", "2026-10-03 07:00", "resolvedEnd", "2026-10-03 15:00");

        Future<?>[] resolve = new Future<?>[1];
        assertPutBlocksOnTheLockThen409("tok", () -> resolve[0] = pool.submit(() ->
                mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(res))))).andReturn()),
                entered, release);
        resolve[0].get(5, TimeUnit.SECONDS);
    }

    @Test
    void putDraft_racingAnInFlightRecompute_waitsForTheLockAndIsRejected() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 1));
        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(reportBuilder.build(any(), any(), any(), any(), any())).thenAnswer(inv -> {
            entered.countDown();
            release.await(5, TimeUnit.SECONDS);
            return new TasReportBuilder.BuildResult(new ArrayList<>());
        });

        Future<?>[] recompute = new Future<?>[1];
        assertPutBlocksOnTheLockThen409("tok", () -> recompute[0] = pool.submit(() ->
                mvc.perform(post("/api/tas/recompute/tok")).andReturn()), entered, release);
        recompute[0].get(5, TimeUnit.SECONDS);
    }

    @Test
    void putDraft_serializesUnderTheLock() throws Exception {
        TasUploadState state = stateWith("tok", 1);
        tasController.stateStore.put("tok", state);
        AtomicInteger heldDuringSave = new AtomicInteger();
        doAnswer(inv -> {
            if (Thread.holdsLock(state)) heldDuringSave.incrementAndGet();
            return null;
        }).when(draftService).save(any(), any(), any(), any(), any(), any());

        putDraft(draftBody("tok", 1));

        assertThat(heldDuringSave.get()).isEqualTo(1);
    }

    // ── GET / DELETE / resume ────────────────────────────────────────────────

    @Test
    void getDraft_noneIs204() throws Exception {
        when(draftService.findSummary()).thenReturn(Optional.empty());
        mvc.perform(get("/api/tas/draft")).andExpect(status().isNoContent());
    }

    @Test
    void getDraft_returnsTheSummaryWithJobActive() throws Exception {
        when(draftService.findSummary()).thenReturn(Optional.of(new TasDraftService.Summary(
                "tok", "oct.csv", "review", "Octubre 2026 - Quincena 1",
                Instant.parse("2026-11-16T20:20:00Z"), true, true, 1)));
        when(jobService.isAnyJobActive()).thenReturn(true);

        mvc.perform(get("/api/tas/draft"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.fileName").value("oct.csv"))
           .andExpect(jsonPath("$.view").value("review"))
           .andExpect(jsonPath("$.periodLabel").value("Octubre 2026 - Quincena 1"))
           .andExpect(jsonPath("$.savedAt").value("2026-11-16T20:20:00Z"))
           .andExpect(jsonPath("$.partialSubmit").value(true))
           .andExpect(jsonPath("$.jobActive").value(true))
           .andExpect(jsonPath("$.resumable").value(true))
           .andExpect(jsonPath("$.uiVersion").value(1))
           .andExpect(jsonPath("$.uploadToken").doesNotExist())
           .andExpect(jsonPath("$.ui").doesNotExist());
    }

    @Test
    void getDraft_jobActiveFalseWhenNoJobRuns() throws Exception {
        when(draftService.findSummary()).thenReturn(Optional.of(new TasDraftService.Summary(
                "tok", null, "verification", null, Instant.now(), false, true, 1)));

        mvc.perform(get("/api/tas/draft"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.jobActive").value(false));
    }

    @Test
    void deleteDraft_deletesIt() throws Exception {
        mvc.perform(delete("/api/tas/draft")).andExpect(status().isNoContent());
        verify(draftService).delete();
    }

    @Test
    void resume_withoutDraftIs404() throws Exception {
        when(draftService.load()).thenReturn(Optional.empty());
        mvc.perform(post("/api/tas/draft/resume"))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.code").value("NO_DRAFT"));
    }

    @Test
    void getDraft_reportsAnOutdatedDraftAsNotResumable() throws Exception {
        when(draftService.findSummary()).thenReturn(Optional.of(new TasDraftService.Summary(
                "tok", "oct.csv", "review", null, Instant.now(), false, false, null)));

        mvc.perform(get("/api/tas/draft"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.resumable").value(false))
           .andExpect(jsonPath("$.uiVersion").doesNotExist());
    }

    @Test
    void resume_anOutdatedDraftIs409AndLeavesItInPlace() throws Exception {
        when(draftService.load()).thenReturn(Optional.empty());
        when(draftService.findSummary()).thenReturn(Optional.of(new TasDraftService.Summary(
                "tok", "oct.csv", "review", null, Instant.now(), false, false, null)));

        mvc.perform(post("/api/tas/draft/resume"))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.code").value("DRAFT_OUTDATED"))
           .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("otra versión")));

        verify(draftService, never()).delete();
        assertThat(tasController.stateStore).doesNotContainKey("tok");
    }

    @Test
    void resume_aDraftThatCouldNotBeReadIs404NotOutdated() throws Exception {
        when(draftService.load()).thenReturn(Optional.empty());
        when(draftService.currentToken()).thenReturn("tok");
        when(draftService.findSummary()).thenReturn(Optional.empty());

        mvc.perform(post("/api/tas/draft/resume"))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.code").value("NO_DRAFT"));
    }

    @Test
    void resume_putsTheDraftStateUnderItsOriginalTokenWithAFreshClock() throws Exception {
        TasUploadState inMemory = stateWith("tok", 9);
        tasController.stateStore.put("tok", inMemory);
        TasUploadState drafted = stateWith("tok", 6);
        drafted.setLastAccessedAt(Instant.parse("2020-01-01T00:00:00Z"));
        JsonNode ui = mapper.readTree("{\"tasView\":\"review\",\"stateRevision\":6}");
        when(draftService.load()).thenReturn(Optional.of(new TasDraftService.Draft(
                "tok", "oct.csv", "review", null, Instant.now(), false, 6, drafted, ui)));

        mvc.perform(post("/api/tas/draft/resume"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.uploadToken").value("tok"))
           .andExpect(jsonPath("$.ui.tasView").value("review"))
           .andExpect(jsonPath("$.ui.stateRevision").value(6));

        assertThat(tasController.stateStore.get("tok")).isSameAs(drafted);
        assertThat(drafted.getLastAccessedAt()).isAfter(Instant.now().minusSeconds(5));
    }

    // ── getState: rehydrate and idle eviction ────────────────────────────────

    @Test
    void getState_concurrentMissesRehydrateOneInstance() throws Exception {
        AtomicInteger loads = new AtomicInteger();
        when(draftService.loadState("tok")).thenAnswer(inv -> {
            loads.incrementAndGet();
            Thread.sleep(100);
            return stateWith("tok", 3);
        });
        CountDownLatch start = new CountDownLatch(1);
        List<Future<TasUploadState>> futures = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            futures.add(pool.submit(() -> { start.await(); return tasController.getState("tok"); }));
        }
        start.countDown();
        Set<TasUploadState> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        for (Future<TasUploadState> f : futures) seen.add(f.get(5, TimeUnit.SECONDS));

        assertThat(seen).hasSize(1);
        assertThat(loads.get()).isEqualTo(1);
        assertThat(tasController.stateStore.get("tok")).isSameAs(seen.iterator().next());
    }

    @Test
    void getState_rehydratedStateGetsAFreshClock() {
        TasUploadState drafted = stateWith("tok", 3);
        drafted.setLastAccessedAt(Instant.parse("2020-01-01T00:00:00Z"));
        when(draftService.loadState("tok")).thenReturn(drafted);

        assertThat(tasController.getState("tok").getLastAccessedAt()).isAfter(Instant.now().minusSeconds(5));
    }

    @Test
    void getState_nullOrEmptyTokenIsNull() {
        assertThat(tasController.getState(null)).isNull();
        assertThat(tasController.getState("")).isNull();
        verify(draftService, never()).loadState(any());
    }

    @Test
    void evict_skipsTheDraftTokenAndEvictsOtherIdleStates() {
        TasUploadState drafted = stateWith("draft-tok", 1);
        drafted.setLastAccessedAt(Instant.now().minusSeconds(4000));
        TasUploadState idle = stateWith("idle-tok", 1);
        idle.setLastAccessedAt(Instant.now().minusSeconds(4000));
        TasUploadState active = stateWith("active-tok", 1);
        tasController.stateStore.put("draft-tok", drafted);
        tasController.stateStore.put("idle-tok", idle);
        tasController.stateStore.put("active-tok", active);
        when(draftService.currentToken()).thenReturn("draft-tok");

        tasController.evictStaleStates();

        assertThat(tasController.stateStore).containsKeys("draft-tok", "active-tok").doesNotContainKey("idle-tok");
        verify(draftService, times(1)).currentToken();
    }

    @Test
    void evict_touchedStateSurvivesWhileAnUntouchedOneIsEvicted() throws Exception {
        TasUploadState touched = stateWith("a", 1);
        touched.setLastAccessedAt(Instant.now().minusSeconds(4000));
        TasUploadState untouched = stateWith("b", 1);
        untouched.setLastAccessedAt(Instant.now().minusSeconds(4000));
        tasController.stateStore.put("a", touched);
        tasController.stateStore.put("b", untouched);
        when(draftService.currentToken()).thenReturn(null);

        mvc.perform(get("/api/tas/absent-review/a")).andExpect(status().isOk());
        tasController.evictStaleStates();

        assertThat(tasController.stateStore).containsKey("a").doesNotContainKey("b");
    }

    @Test
    void resolveRecomputeAndSubmitSucceedAfterEvictionWhenDraftBacked() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Ana");
        when(draftService.loadState("tok")).thenAnswer(inv -> {
            TasUploadState s = stateWith("tok", 2, flagged(1));
            s.setResolvedRows(new ArrayList<>(List.of(row)));
            return s;
        });
        when(shiftConfigService.getAllShifts()).thenReturn(new ArrayList<>());
        when(reportBuilder.build(any(), any(), any(), any(), any()))
                .thenReturn(new TasReportBuilder.BuildResult(new ArrayList<>(List.of(row))));
        when(jobService.createJob(any(), eq("tok"))).thenReturn("job-1");

        Map<String, Object> res = Map.of("sessionId", 1,
                "resolvedStart", "2026-10-03 07:00", "resolvedEnd", "2026-10-03 15:00");
        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(res)))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(3));

        tasController.stateStore.clear();
        mvc.perform(post("/api/tas/recompute/tok"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(3));

        tasController.stateStore.clear();
        tasController.stateStore.put("other", stateWith("other", 1));
        when(draftService.loadState("tok")).thenAnswer(inv -> {
            TasUploadState s = stateWith("tok", 3);
            s.setResolvedRows(new ArrayList<>(List.of(row)));
            return s;
        });
        mvc.perform(post("/api/tas/submit").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok"))))
           .andExpect(status().isAccepted())
           .andExpect(jsonPath("$.jobId").value("job-1"));
    }

    // ── job in progress ──────────────────────────────────────────────────────

    @Test
    void submit_whileAJobRunsForTheTokenIs409() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        TasUploadState state = stateWith("tok", 1);
        state.setResolvedRows(new ArrayList<>(List.of(row)));
        tasController.stateStore.put("tok", state);
        when(jobService.createJob(any(), eq("tok"))).thenThrow(new JobInProgressException());

        mvc.perform(post("/api/tas/submit").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok"))))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.code").value("JOB_IN_PROGRESS"));
        verify(jobService, never()).processJobAsync(any(), any());
    }

    @Test
    void retry_whileAJobRunsForTheTokenIs409() throws Exception {
        when(jobService.createRetryJob("job-1")).thenThrow(new JobInProgressException());

        mvc.perform(post("/api/tas/jobs/job-1/retry"))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.code").value("JOB_IN_PROGRESS"));
    }

    @Test
    void deactivateAbsent_rejectsMalformedBodies() throws Exception {
        mvc.perform(post("/api/tas/absent-review/x/deactivate").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("employeeIds", "100"))))
           .andExpect(status().isBadRequest());
        mvc.perform(post("/api/tas/absent-review/x/deactivate").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("employeeIds", List.of("100"), "active", "yes"))))
           .andExpect(status().isBadRequest());
        verify(registryService, never()).setActive(any(), anyBoolean());
    }

    @Test
    void checkDuplicates_readsThroughGetState() throws Exception {
        when(draftService.loadState("tok")).thenReturn(stateWith("tok", 1));
        when(databaseService.checkDuplicates(any())).thenReturn(List.of());

        mvc.perform(post("/api/tas/check-duplicates").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok"))))
           .andExpect(status().isOk());
        mvc.perform(post("/api/tas/check-duplicates").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", List.of()))))
           .andExpect(status().isNotFound());
    }

    @Test
    void sameDayResolutionAppliesAfterValidation() throws Exception {
        TasSession a = flagged(1);
        a.setFlags(new ArrayList<>(List.of(TasFlag.SAME_DAY_DOUBLE)));
        tasController.stateStore.put("tok", stateWith("tok", 1, a));
        stubBuild();

        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(
                        Map.of("employeeId", "100", "date", "2026-10-03", "keepSessionId", 1),
                        Map.of("sessionId", 99, "acceptedShiftId", "manana"),
                        Map.of("note", "no session id"))))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(2));
        assertThat(a.getFlags()).isEmpty();
    }

    @Test
    void inactiveReview_reactivatesUnderTheLockWithNullCollections() throws Exception {
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok");
        state.setRevision(1);
        tasController.stateStore.put("tok", state);
        when(uploadService.processScans(any(), any(), any())).thenReturn(result(List.of()));
        stubBuild();

        mvc.perform(post("/api/tas/inactive-review").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "reactivate", List.of("100")))))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.stateRevision").value(2));
        verify(registryService).setActive("100", true);
    }

    @Test
    void resolve_sameDayWithUnparseableDateIs400BeforeAnyMutation() throws Exception {
        TasUploadState state = stateWith("tok", 1, flagged(1));
        tasController.stateStore.put("tok", state);
        stubBuild();

        mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(
                        Map.of("sessionId", 1, "resolvedStart", "2026-10-03 07:00", "resolvedEnd", "2026-10-03 15:00"),
                        Map.of("employeeId", "100", "date", "03/10/2026", "keepSessionId", 1))))))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("INVALID_TIME_FORMAT"));
        assertThat(state.getRevision()).isEqualTo(1);
        assertThat(state.getSessions().get(0).isNeedsResolution()).isTrue();
    }

    @Test
    void resolve_whoseApplyThrowsStillBumpsTheRevision() throws Exception {
        TasUploadState state = stateWith("tok", 2, flagged(1));
        tasController.stateStore.put("tok", state);
        stubBuild();
        doThrow(new IllegalStateException("calc failed")).when(hoursCalculator).classifyHours(any(), any());
        Map<String, Object> res = Map.of("sessionId", 1,
                "resolvedStart", "2026-10-03 07:00", "resolvedEnd", "2026-10-03 15:00");

        try {
            mvc.perform(post("/api/tas/resolve").contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(res)))));
        } catch (Exception expected) {
            // the failure propagates; what matters is the revision
        }

        assertThat(state.getRevision()).isEqualTo(3);
        assertThat(putDraft(draftBody("tok", 2)).getResponse().getStatus()).isEqualTo(409);
    }

    private void assertReplacedWhileWaitingForTheLockIs409(String token, TasUploadState old,
            java.util.concurrent.Callable<MvcResult> request) throws Exception {
        Future<MvcResult> pending;
        synchronized (old) {
            pending = pool.submit(request);
            Thread.sleep(300);
            tasController.stateStore.put(token, stateWith(token, old.getRevision()));
        }
        MvcResult res = pending.get(5, TimeUnit.SECONDS);
        assertThat(res.getResponse().getStatus()).isEqualTo(409);
        assertThat(res.getResponse().getContentAsString()).contains("STATE_CHANGED");
    }

    @Test
    void resolve_onAStateReplacedWhileWaitingForTheLockIs409() throws Exception {
        TasSession session = flagged(1);
        TasUploadState old = stateWith("tok", 1, session);
        tasController.stateStore.put("tok", old);
        stubBuild();
        Map<String, Object> res = Map.of("sessionId", 1,
                "resolvedStart", "2026-10-03 07:00", "resolvedEnd", "2026-10-03 15:00");

        assertReplacedWhileWaitingForTheLockIs409("tok", old, () -> mvc.perform(post("/api/tas/resolve")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("uploadToken", "tok", "resolutions", List.of(res))))).andReturn());
        assertThat(old.getRevision()).isEqualTo(1);
        assertThat(session.isNeedsResolution()).isTrue();
    }

    @Test
    void recompute_onAStateReplacedWhileWaitingForTheLockIs409() throws Exception {
        TasUploadState old = stateWith("tok", 1);
        tasController.stateStore.put("tok", old);
        stubBuild();

        assertReplacedWhileWaitingForTheLockIs409("tok", old,
                () -> mvc.perform(post("/api/tas/recompute/tok")).andReturn());
        assertThat(old.getRevision()).isEqualTo(1);
    }

    @Test
    void submit_onAStateReplacedWhileWaitingForTheLockIs409() throws Exception {
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        TasUploadState old = stateWith("tok", 1);
        old.setResolvedRows(new ArrayList<>(List.of(row)));
        tasController.stateStore.put("tok", old);

        assertReplacedWhileWaitingForTheLockIs409("tok", old, () -> mvc.perform(post("/api/tas/submit")
                .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("uploadToken", "tok")))).andReturn());
        verify(jobService, never()).createJob(any(), any());
    }

    @Test
    void putDraft_staleRevisionReportsTheServerRevision() throws Exception {
        tasController.stateStore.put("tok", stateWith("tok", 4));

        MvcResult res = putDraft(draftBody("tok", 3));

        assertThat(res.getResponse().getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(res.getResponse().getContentAsString()).get("currentRevision").asLong()).isEqualTo(4);
    }
}
