package com.planilla.backend.service.tas;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasPeriod;
import com.planilla.backend.model.tas.TasScanRecord;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.model.tas.TasUploadResult;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TasDraftServiceTest {

    private JdbcTemplate jdbc;
    private ObjectMapper mapper;
    private TasDraftService service;

    @BeforeEach
    void setUp() {
        JdbcDataSource ds = new JdbcDataSource();
        ds.setURL("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
        new ResourceDatabasePopulator(new ClassPathResource("schema-h2.sql")).execute(ds);
        jdbc = new JdbcTemplate(ds);
        mapper = Jackson2ObjectMapperBuilder.json().build();
        service = new TasDraftService(jdbc, mapper);
    }

    private JsonNode ui(String json) throws Exception { return mapper.readTree(json); }

    private TasUploadState simpleState(String token) {
        TasSession s = new TasSession();
        s.setSessionId(7);
        s.setEmployeeId("1");
        s.setDate(LocalDate.of(2026, 10, 3));
        s.setEffectiveStart(LocalDateTime.of(2026, 10, 3, 7, 2));
        s.setScans(new ArrayList<>(List.of(LocalDateTime.of(2026, 10, 3, 7, 2))));
        s.setFlags(new ArrayList<>(List.of(TasFlag.MISSING_EXIT, TasFlag.BEST_FIT_SHIFT)));
        s.setNeedsResolution(true);
        TasUploadState state = new TasUploadState();
        state.setUploadToken(token);
        state.setSessions(new ArrayList<>(List.of(s)));
        state.setReportStart(LocalDate.of(2026, 10, 1));
        state.setReportEnd(LocalDate.of(2026, 10, 15));
        state.setResolvedPeriod(new TasPeriod(2026, 10, 1));
        state.setIgnoredEmployeeIds(new HashSet<>(Set.of("9")));
        state.setRevision(3);
        return state;
    }

    private TasUploadResult realPipelineResult(List<TasScanRecord> scans) {
        EmployeeRegistryService registry = mock(EmployeeRegistryService.class);
        HolidayService holidays = mock(HolidayService.class);
        ShiftConfigService shiftConfig = mock(ShiftConfigService.class);
        AppConfigService appConfig = mock(AppConfigService.class);
        Map<String, Object> manana = new LinkedHashMap<>();
        manana.put("id", "manana");
        manana.put("name", "Mañana");
        manana.put("startTime", "07:00");
        manana.put("endTime", "15:00");
        manana.put("crossMidnight", false);
        manana.put("detectionBeforeMinutes", 60);
        manana.put("detectionAfterMinutes", 10);
        when(shiftConfig.getAllShifts()).thenReturn(List.of(manana));
        when(appConfig.getMaxSessionSpanMinutes()).thenReturn(840);
        when(appConfig.getLegalBreakAllowanceMinutes()).thenReturn(45);
        when(holidays.fetchForDateRange(any(), any())).thenReturn(true);
        when(registry.getInactiveEmployeesPresent(anySet())).thenReturn(Collections.emptyList());
        when(registry.getAbsentActiveEmployees(anySet())).thenReturn(Collections.emptyList());
        when(registry.getAccruesOvertimeFlags(anyCollection())).thenAnswer(inv -> {
            Map<String, Boolean> m = new HashMap<>();
            for (Object id : (Collection<?>) inv.getArgument(0)) m.put((String) id, true);
            return m;
        });
        when(registry.getAll(any(), any(), any())).thenReturn(Collections.emptyList());
        TasReportBuilder reportBuilder = new TasReportBuilder(holidays, registry);
        TasUploadService upload = new TasUploadService(new TasParserService(), registry, holidays,
                new TasSessionGrouper(appConfig), new TasHoursCalculator(appConfig, holidays, shiftConfig),
                reportBuilder, shiftConfig);
        return upload.processScans(scans, new ArrayList<>(), Collections.emptySet());
    }

    @Test
    void roundTripsFullPipelineState() throws Exception {
        byte[] csv = Files.readAllBytes(Paths.get("src/test/resources/fixtures/multi-employee-march.csv"));
        List<TasScanRecord> scans = new TasParserService()
                .parse(new MockMultipartFile("file", "m.csv", "text/csv", csv)).scans;
        TasUploadResult result = realPipelineResult(scans);
        TasUploadState state = TasUploadState.from("tok-real", result, scans, Set.of());
        state.setRevision(1);
        assertThat(state.getSessions()).isNotEmpty();

        service.save("tok-real", state, ui("{\"tasView\":\"review\"}"), "marzo.csv", "review", "Marzo 2026 - Quincena 2");

        TasDraftService.Draft draft = service.load().orElseThrow();
        assertThat(mapper.writeValueAsString(draft.state().getSessions()))
                .isEqualTo(mapper.writeValueAsString(state.getSessions()));
        assertThat(mapper.writeValueAsString(draft.state().getResolvedRows()))
                .isEqualTo(mapper.writeValueAsString(state.getResolvedRows()));
        assertThat(mapper.writeValueAsString(draft.state().getAllScans()))
                .isEqualTo(mapper.writeValueAsString(state.getAllScans()));
        assertThat(draft.state().getReportStart()).isEqualTo(state.getReportStart());
        assertThat(draft.state().getReportEnd()).isEqualTo(state.getReportEnd());
        assertThat(draft.state().getRevision()).isEqualTo(1);
        assertThat(draft.uploadToken()).isEqualTo("tok-real");
        assertThat(draft.fileName()).isEqualTo("marzo.csv");
        assertThat(draft.view()).isEqualTo("review");
        assertThat(draft.periodLabel()).isEqualTo("Marzo 2026 - Quincena 2");
        assertThat(draft.stateRevision()).isEqualTo(1);
        assertThat(draft.ui().get("tasView").asText()).isEqualTo("review");
    }

    @Test
    void roundTripsInactiveReviewStateWithNulls() throws Exception {
        TasScanRecord scan = new TasScanRecord();
        scan.setEmployeeId("100");
        scan.setEmployeeName("Inactivo");
        scan.setTimestamp(LocalDateTime.of(2026, 10, 2, 6, 58));
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok-inactive");
        state.setAllScans(new ArrayList<>(List.of(scan)));
        state.setIgnoredEmployeeIds(new HashSet<>());
        state.setRevision(1);

        service.save("tok-inactive", state, ui("{}"), null, "inactiveReview", null);

        TasUploadState loaded = service.load().orElseThrow().state();
        assertThat(loaded.getSessions()).isNull();
        assertThat(loaded.getResolvedRows()).isNull();
        assertThat(loaded.getReportStart()).isNull();
        assertThat(loaded.getAllScans()).hasSize(1);
        assertThat(loaded.getAllScans().get(0).getTimestamp()).isEqualTo(LocalDateTime.of(2026, 10, 2, 6, 58));
        assertThat(loaded.getIgnoredEmployeeIds()).isEmpty();
    }

    @Test
    void preservesJavaTimeTypesAndLeavesFlagsMutable() throws Exception {
        service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "verification", null);

        TasUploadState loaded = service.load().orElseThrow().state();
        TasSession s = loaded.getSessions().get(0);
        assertThat(s.getDate()).isEqualTo(LocalDate.of(2026, 10, 3));
        assertThat(s.getEffectiveStart()).isEqualTo(LocalDateTime.of(2026, 10, 3, 7, 2));
        assertThat(loaded.getResolvedPeriod()).isEqualTo(new TasPeriod(2026, 10, 1));
        assertThat(loaded.getIgnoredEmployeeIds()).containsExactly("9");

        s.getFlags().removeIf(f -> f == TasFlag.MISSING_EXIT);
        assertThat(s.getFlags()).containsExactly(TasFlag.BEST_FIT_SHIFT);
        loaded.getSessions().add(new TasSession());
        assertThat(loaded.getSessions()).hasSize(2);
    }

    @Test
    void keepsOnlyOneRow() throws Exception {
        service.save("a", simpleState("a"), ui("{\"n\":1}"), "a.csv", "verification", null);
        service.save("b", simpleState("b"), ui("{\"n\":2}"), "b.csv", "review", null);

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM tas_draft", Integer.class)).isEqualTo(1);
        TasDraftService.Draft draft = service.load().orElseThrow();
        assertThat(draft.uploadToken()).isEqualTo("b");
        assertThat(draft.ui().get("n").asInt()).isEqualTo(2);
        assertThat(service.currentToken()).isEqualTo("b");
    }

    @Test
    void loadIsEmptyWithoutDraft() {
        assertThat(service.load()).isEmpty();
        assertThat(service.findSummary()).isEmpty();
        assertThat(service.currentToken()).isNull();
        assertThat(service.loadState("x")).isNull();
    }

    private int rowCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM tas_draft", Integer.class);
    }

    private void assertKeptButNotResumable() {
        assertThat(service.load()).isEmpty();
        assertThat(service.loadState("tok")).isNull();
        TasDraftService.Summary summary = service.findSummary().orElseThrow();
        assertThat(summary.resumable()).isFalse();
        assertThat(summary.fileName()).isEqualTo("f.csv");
        assertThat(rowCount()).isOne();
    }

    @Test
    void schemaMismatchIsKeptButNotResumable() throws Exception {
        service.save("tok", simpleState("tok"), ui("{\"uiVersion\":1}"), "f.csv", "review", null);
        jdbc.update("UPDATE tas_draft SET schema_version = ?", TasDraftService.SCHEMA_VERSION + 1);

        assertKeptButNotResumable();
        assertThat(service.findSummary().orElseThrow().uiVersion()).isEqualTo(1);
    }

    @Test
    void corruptBackendStateIsKeptButNotResumable() throws Exception {
        service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
        jdbc.update("UPDATE tas_draft SET backend_state = '{not json'");

        assertKeptButNotResumable();
    }

    @Test
    void corruptUiStateIsKeptButNotResumable() throws Exception {
        service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
        jdbc.update("UPDATE tas_draft SET ui_state = '[1,'");

        assertKeptButNotResumable();
        assertThat(service.findSummary().orElseThrow().uiVersion()).isNull();
    }

    @Test
    void wrongTypedBackendStateIsKeptButNotResumable() throws Exception {
        service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
        jdbc.update("UPDATE tas_draft SET backend_state = '{\"sessions\": 5}'");

        assertKeptButNotResumable();
    }

    @Test
    void anOutdatedRowWarnsOncePerSavedRowNotOnEveryPoll() throws Exception {
        ch.qos.logback.classic.Logger logger =
                (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(TasDraftService.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
                new ch.qos.logback.core.read.ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
            jdbc.update("UPDATE tas_draft SET schema_version = 0");
            for (int i = 0; i < 5; i++) service.findSummary();
            service.load();
            assertThat(appender.list).hasSize(1);
            assertThat(appender.list.get(0).getFormattedMessage()).contains("schema version 0");

            service.save("tok2", simpleState("tok2"), ui("{}"), "g.csv", "review", null);
            jdbc.update("UPDATE tas_draft SET schema_version = 0");
            service.findSummary();
            assertThat(appender.list).hasSize(2);
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void summaryCarriesTheUiVersionOnlyWhenItIsAnInteger() throws Exception {
        service.save("tok", simpleState("tok"), ui("{\"uiVersion\":3}"), "f.csv", "review", null);
        assertThat(service.findSummary().orElseThrow().uiVersion()).isEqualTo(3);
        assertThat(service.findSummary().orElseThrow().resumable()).isTrue();

        service.save("tok", simpleState("tok"), ui("{\"uiVersion\":\"3\"}"), "f.csv", "review", null);
        assertThat(service.findSummary().orElseThrow().uiVersion()).isNull();

        service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
        assertThat(service.findSummary().orElseThrow().uiVersion()).isNull();
    }

    @Test
    void loadNeverThrowsWhenTheDatabaseFails() {
        JdbcTemplate broken = mock(JdbcTemplate.class);
        when(broken.query(anyString(), any(org.springframework.jdbc.core.RowMapper.class)))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("down"));
        when(broken.queryForList(anyString(), eq(String.class)))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("down"));
        when(broken.update(anyString(), any(Object[].class)))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("down"));
        TasDraftService s = new TasDraftService(broken, mapper);

        assertThat(s.load()).isEmpty();
        assertThat(s.findSummary()).isEmpty();
        assertThat(s.currentToken()).isNull();
        assertThat(s.loadState("x")).isNull();
        s.deleteIfToken("x");
        s.markPartialIfToken("x");
    }

    @Test
    void summaryReportsMetadataWithoutPayload() throws Exception {
        Instant before = Instant.now().truncatedTo(ChronoUnit.MILLIS).minusMillis(1);
        service.save("tok", simpleState("tok"), ui("{}"), "oct.csv", "verification", "Octubre 2026 - Quincena 1");

        TasDraftService.Summary summary = service.findSummary().orElseThrow();
        assertThat(summary.uploadToken()).isEqualTo("tok");
        assertThat(summary.fileName()).isEqualTo("oct.csv");
        assertThat(summary.view()).isEqualTo("verification");
        assertThat(summary.periodLabel()).isEqualTo("Octubre 2026 - Quincena 1");
        assertThat(summary.partialSubmit()).isFalse();
        assertThat(summary.savedAt()).isAfter(before);
    }

    @Test
    void loadStateMatchesTokenAndRefreshesLastAccessed() throws Exception {
        TasUploadState state = simpleState("tok");
        state.setLastAccessedAt(Instant.parse("2020-01-01T00:00:00Z"));
        service.save("tok", state, ui("{}"), "f.csv", "review", null);

        assertThat(service.loadState("other")).isNull();
        assertThat(service.loadState(null)).isNull();
        TasUploadState loaded = service.loadState("tok");
        assertThat(loaded).isNotNull();
        assertThat(loaded.getRevision()).isEqualTo(3);
        assertThat(loaded.getLastAccessedAt()).isAfter(Instant.now().minusSeconds(5));
    }

    @Test
    void deleteIfTokenOnlyDeletesMatchingDraft() throws Exception {
        service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);

        service.deleteIfToken("other");
        assertThat(service.currentToken()).isEqualTo("tok");

        service.deleteIfToken("tok");
        assertThat(service.currentToken()).isNull();
    }

    @Test
    void markPartialIfTokenOnlyMarksMatchingDraft() throws Exception {
        service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);

        service.markPartialIfToken("other");
        assertThat(service.findSummary().orElseThrow().partialSubmit()).isFalse();

        service.markPartialIfToken("tok");
        assertThat(service.findSummary().orElseThrow().partialSubmit()).isTrue();
    }

    @Test
    void partialFlagSurvivesSavesForTheSameTokenAndResetsForANewOne() throws Exception {
        service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
        service.markPartialIfToken("tok");

        service.save("tok", simpleState("tok"), ui("{\"x\":1}"), "f.csv", "review", null);
        assertThat(service.findSummary().orElseThrow().partialSubmit()).isTrue();

        service.save("new", simpleState("new"), ui("{}"), "g.csv", "verification", null);
        assertThat(service.findSummary().orElseThrow().partialSubmit()).isFalse();
    }

    @Test
    void deleteRemovesTheDraft() throws Exception {
        service.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
        service.delete();
        assertThat(service.load()).isEmpty();
    }

    @Test
    void saveSurfacesSerializationFailures() throws Exception {
        ObjectMapper broken = mock(ObjectMapper.class);
        when(broken.writeValueAsString(any())).thenThrow(new com.fasterxml.jackson.core.JsonGenerationException("nope", (com.fasterxml.jackson.core.JsonGenerator) null));
        TasDraftService s = new TasDraftService(jdbc, broken);

        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                s.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null))
                .isInstanceOf(IllegalStateException.class);
        assertThat(service.currentToken()).isNull();
    }

    // ── Durability: the desktop shell force-kills the backend on every app close ──

    private JdbcTemplate fileDb(java.nio.file.Path dir) {
        JdbcDataSource ds = new JdbcDataSource();
        ds.setURL("jdbc:h2:file:" + dir.resolve("crash") + ";DB_CLOSE_DELAY=-1");
        return new JdbcTemplate(ds);
    }

    @Test
    void save_survivesAnImmediateHardKill(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
        JdbcTemplate fileJdbc = fileDb(dir);
        new ResourceDatabasePopulator(new ClassPathResource("schema-h2.sql")).execute(fileJdbc.getDataSource());
        TasDraftService fileService = new TasDraftService(fileJdbc, mapper);

        fileService.save("tok", simpleState("tok"), ui("{\"tasView\":\"verification\"}"), "f.csv", "verification", null);
        fileJdbc.execute("SHUTDOWN IMMEDIATELY");

        assertThat(new TasDraftService(fileDb(dir), mapper).findSummary()).isPresent();
    }

    @Test
    void deleteIfToken_survivesAnImmediateHardKill(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
        JdbcTemplate fileJdbc = fileDb(dir);
        new ResourceDatabasePopulator(new ClassPathResource("schema-h2.sql")).execute(fileJdbc.getDataSource());
        TasDraftService fileService = new TasDraftService(fileJdbc, mapper);
        fileService.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
        fileJdbc.execute("CHECKPOINT");

        fileService.deleteIfToken("tok");
        fileJdbc.execute("SHUTDOWN IMMEDIATELY");

        assertThat(new TasDraftService(fileDb(dir), mapper).findSummary()).isEmpty();
    }

    @Test
    void markPartialIfToken_survivesAnImmediateHardKill(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
        JdbcTemplate fileJdbc = fileDb(dir);
        new ResourceDatabasePopulator(new ClassPathResource("schema-h2.sql")).execute(fileJdbc.getDataSource());
        TasDraftService fileService = new TasDraftService(fileJdbc, mapper);
        fileService.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
        fileJdbc.execute("CHECKPOINT");

        fileService.markPartialIfToken("tok");
        fileJdbc.execute("SHUTDOWN IMMEDIATELY");

        assertThat(new TasDraftService(fileDb(dir), mapper).findSummary()).hasValueSatisfying(sm -> assertThat(sm.partialSubmit()).isTrue());
    }

    @Test
    void save_stillSucceedsWhenTheFlushFails() throws Exception {
        JdbcTemplate spy = org.mockito.Mockito.spy(jdbc);
        org.mockito.Mockito.doThrow(new org.springframework.dao.DataAccessResourceFailureException("disk"))
                .when(spy).execute("CHECKPOINT");
        TasDraftService flaky = new TasDraftService(spy, mapper);

        flaky.save("tok", simpleState("tok"), ui("{}"), "f.csv", "verification", null);

        assertThat(flaky.findSummary()).isPresent();
    }

    @Test
    void delete_survivesAnImmediateHardKill(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
        JdbcTemplate fileJdbc = fileDb(dir);
        new ResourceDatabasePopulator(new ClassPathResource("schema-h2.sql")).execute(fileJdbc.getDataSource());
        TasDraftService fileService = new TasDraftService(fileJdbc, mapper);
        fileService.save("tok", simpleState("tok"), ui("{}"), "f.csv", "review", null);
        fileJdbc.execute("CHECKPOINT");

        fileService.delete();
        fileJdbc.execute("SHUTDOWN IMMEDIATELY");

        assertThat(new TasDraftService(fileDb(dir), mapper).findSummary()).isEmpty();
    }
}
