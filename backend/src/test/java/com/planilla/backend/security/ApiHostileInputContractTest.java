package com.planilla.backend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.planilla.backend.controller.TasController;
import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.model.tas.TasFlag;
import com.planilla.backend.model.tas.TasSession;
import com.planilla.backend.service.ApplicationExiter;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.tas.TasDraftService;
import com.planilla.backend.service.tas.TasUploadState;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

/**
 * Hostile-input contract for the whole HTTP surface.
 *
 * The surface is DERIVED at run time from Spring's handler mappings, never hand-listed: a new
 * endpoint is attacked automatically. Every /api handler gets garbage JSON, wrong-typed fields,
 * missing / oversized / unknown tokens (in the body and in path variables), and malformed fields
 * carrying a valid token. The bar: never a 5xx (or an unhandled exception), and a request that
 * does not carry the victim's token never sees the victim session's data nor changes it.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "PLANILLA_SHUTDOWN_TOKEN=hostile-test-shutdown-token")
class ApiHostileInputContractTest {

    private static final String SECRET = "VICTIM-SECRET-5f1c";

    /**
     * Token-less by design: the app is single-user, bound to loopback, and keeps exactly one draft.
     * These may expose or replace the saved draft without a token. Asserted to exist, so the list
     * cannot silently rot; any OTHER endpoint that leaks or mutates the victim session fails.
     */
    private static final Set<String> TOKENLESS_DRAFT_READS = Set.of(
            "GET /api/tas/draft",
            "POST /api/tas/draft/resume");
    private static final Set<String> TOKENLESS_DRAFT_REPLACERS = Set.of(
            "DELETE /api/tas/draft",
            "POST /api/tas/upload");

    /**
     * OPEN finding H-3, tracked in docs/tas-api-auth-review.md: these config endpoints cast request-body
     * values without type checks, so a wrong-typed field is an unhandled exception (HTTP 500). No data
     * leaks and no session state changes. Ratchet, pinned per endpoint by failure kind and count: the
     * observed failures must EQUAL this map, so a new 5xx kind (or more of one) on a listed endpoint,
     * or any 5xx on another endpoint, fails the build, and a fix must shrink the map.
     */
    private static final Map<String, Map<String, Integer>> KNOWN_OPEN_5XX = Map.of(
            "POST /api/config/employees/bulk-assign", Map.of("unhandled ClassCastException", 16),
            "POST /api/config/holidays", Map.of("unhandled ClassCastException", 14),
            "POST /api/config/shifts", Map.of(
                    "unhandled ClassCastException", 16, "unhandled NullPointerException", 2),
            "PUT /api/config/employees/{id}", Map.of("unhandled ClassCastException", 112),
            "PUT /api/config/shifts/{id}", Map.of(
                    "unhandled ClassCastException", 112, "unhandled NullPointerException", 14));

    private static final List<String> FIELD_NAMES = List.of(
            "uploadToken", "reactivate", "ignore", "resolutions", "anio", "mes", "numeroDequincena",
            "overtimeOverrides", "nonWorkedDaysOverrides", "employeeIds", "active", "stateRevision",
            "view", "fileName", "periodLabel", "ui", "name", "startTime", "endTime", "crossMidnight",
            "detectionBeforeMinutes", "detectionAfterMinutes", "shiftId", "accruesOvertime", "date",
            "legalBreakAllowanceMinutes", "maxSessionSpanMinutes", "id", "year");

    private static final List<Object> HOSTILE_VALUES = Arrays.asList(
            "x", -999_999_999_999L, 1.5e308, true, List.of(), Map.of(),
            Arrays.asList(1, "a", null, Map.of("k", List.of())), Map.of("a", List.of(Map.of())), null);

    private static final Pattern PATH_VAR = Pattern.compile("\\{([^}]+)}");

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired TasController tasController;
    @Autowired TasDraftService draftService;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping handlerMapping;

    @MockBean DatabaseService databaseService;
    @MockBean(name = "postgresJdbcTemplate") JdbcTemplate postgresJdbcTemplate;
    @MockBean ApplicationExiter exiter;

    private final String victimToken = UUID.randomUUID().toString();

    private record Endpoint(String method, String pattern, boolean multipart) {
        String key() { return method + " " + pattern; }
    }

    private List<Endpoint> surface() {
        List<Endpoint> endpoints = new ArrayList<>();
        for (Map.Entry<RequestMappingInfo, HandlerMethod> e : handlerMapping.getHandlerMethods().entrySet()) {
            RequestMappingInfo info = e.getKey();
            Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
            if (methods.isEmpty()) methods = EnumSet.of(RequestMethod.GET, RequestMethod.POST);
            boolean multipart = info.getConsumesCondition().getConsumableMediaTypes().stream()
                    .anyMatch(MediaType.MULTIPART_FORM_DATA::includes);
            for (String pattern : info.getPatternValues()) {
                if (!pattern.startsWith("/api/")) continue;
                for (RequestMethod m : methods) endpoints.add(new Endpoint(m.name(), pattern, multipart));
            }
        }
        endpoints.sort(Comparator.comparing(Endpoint::key));
        return endpoints;
    }

    @SuppressWarnings("unchecked")
    private void resetVictim() throws Exception {
        ConcurrentHashMap<String, TasUploadState> store =
                (ConcurrentHashMap<String, TasUploadState>) ReflectionTestUtils.getField(tasController, "stateStore");
        store.clear();

        TasSession session = new TasSession();
        session.setSessionId(1);
        session.setEmployeeId("V1");
        session.setEmployeeName(SECRET);
        session.setDate(LocalDate.of(2026, 10, 3));
        session.setNeedsResolution(true);
        session.setFlags(new ArrayList<>(List.of(TasFlag.MISSING_EXIT)));
        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("V1");
        row.setNombreEmpleado(SECRET);
        TasUploadState state = new TasUploadState();
        state.setUploadToken(victimToken);
        state.setSessions(new ArrayList<>(List.of(session)));
        state.setResolvedRows(new ArrayList<>(List.of(row)));
        state.setAllScans(new ArrayList<>());
        state.setIgnoredEmployeeIds(new HashSet<>());
        state.setRevision(7);
        store.put(victimToken, state);
        draftService.save(victimToken, state, mapper.readTree("{\"secret\":\"" + SECRET + "\"}"),
                SECRET + ".csv", "verification", null);
        victimBaseline = victimFingerprint();
    }

    private String victimBaseline;

    /**
     * The victim session's full content, in memory and in the saved draft, minus the idle clock
     * (any read touches it) and the save time. Comparing this, not just the revision, catches a
     * mutation that forgets to bump the revision.
     */
    private String victimFingerprint() throws Exception {
        ObjectNode out = mapper.createObjectNode();
        TasUploadState live = victimState();
        out.set("live", live == null ? null : withoutClock(mapper.valueToTree(live)));
        Optional<TasDraftService.Draft> draft = draftService.load();
        if (draft.isPresent()) {
            TasDraftService.Draft d = draft.get();
            ObjectNode saved = mapper.createObjectNode();
            saved.put("token", d.uploadToken());
            saved.put("fileName", d.fileName());
            saved.put("view", d.view());
            saved.put("revision", d.stateRevision());
            saved.put("partial", d.partialSubmit());
            saved.set("state", withoutClock(mapper.valueToTree(d.state())));
            saved.set("ui", d.ui());
            out.set("draft", saved);
        }
        return mapper.writeValueAsString(out);
    }

    private static JsonNode withoutClock(JsonNode node) {
        ((ObjectNode) node).remove("lastAccessedAt");
        return node;
    }

    private TasUploadState victimState() {
        @SuppressWarnings("unchecked")
        Map<String, TasUploadState> store =
                (Map<String, TasUploadState>) ReflectionTestUtils.getField(tasController, "stateStore");
        return store.get(victimToken);
    }

    private List<String> pathValues(boolean withVictim) {
        List<String> values = new ArrayList<>(List.of(
                UUID.randomUUID().toString(), "A".repeat(4096), "' OR 1=1 --", "..%2F..%2Fetc", "-1", "null"));
        if (withVictim) values.add(victimToken);
        return values;
    }

    private String expand(String pattern, String value) {
        Matcher m = PATH_VAR.matcher(pattern);
        StringBuilder sb = new StringBuilder();
        while (m.find()) m.appendReplacement(sb, Matcher.quoteReplacement(value));
        m.appendTail(sb);
        return sb.toString();
    }

    private record Attempt(String body, boolean carriesVictim) {}

    private List<Attempt> bodies() throws Exception {
        List<Attempt> out = new ArrayList<>();
        out.add(new Attempt(null, false));
        out.add(new Attempt("{not json", false));
        out.add(new Attempt("[]", false));
        out.add(new Attempt("null", false));
        out.add(new Attempt("\"" + "x".repeat(10) + "\"", false));
        out.add(new Attempt("{}", false));
        out.add(new Attempt(json(Map.of("uploadToken", 12345)), false));
        out.add(new Attempt(json(Map.of("uploadToken", "A".repeat(100_000))), false));
        out.add(new Attempt(json(Map.of("uploadToken", UUID.randomUUID().toString(), "stateRevision", 7,
                "view", "verification", "ui", Map.of())), false));
        for (Object hostile : HOSTILE_VALUES) {
            Map<String, Object> foreign = new LinkedHashMap<>();
            Map<String, Object> victim = new LinkedHashMap<>();
            for (String f : FIELD_NAMES) { foreign.put(f, hostile); victim.put(f, hostile); }
            foreign.put("uploadToken", UUID.randomUUID().toString());
            victim.put("uploadToken", victimToken);
            out.add(new Attempt(json(foreign), false));
            out.add(new Attempt(json(victim), true));
        }
        out.add(new Attempt(json(Map.of("uploadToken", victimToken, "resolutions", List.of(
                Map.of("sessionId", "a"),
                Map.of("employeeId", 1, "date", List.of(), "keepSessionId", Map.of()),
                Map.of("sessionId", 1, "resolvedStart", "9999-99-99 99:99", "resolvedEnd", 5),
                Map.of("sessionId", 1, "acceptedShiftId", List.of())))), true));
        out.add(new Attempt(json(Map.of("uploadToken", victimToken, "stateRevision", Long.MAX_VALUE,
                "view", "verification", "ui", Map.of("x", "y"))), true));
        return out;
    }

    private String json(Object o) throws Exception { return mapper.writeValueAsString(o); }

    private MockHttpServletRequestBuilder build(Endpoint e, String uri, String body) {
        MockHttpServletRequestBuilder b = request(HttpMethod.valueOf(e.method()), uri);
        if (body != null) b.contentType(MediaType.APPLICATION_JSON).content(body);
        return b;
    }

    private void check(Map<String, List<String>> failuresByEndpoint, Endpoint e, String label, boolean carriesVictim,
                       MockHttpServletRequestBuilder req) throws Exception {
        String head = e.key() + " [" + label + "]";
        List<String> failures = failuresByEndpoint.computeIfAbsent(e.key(), k -> new ArrayList<>());
        int status;
        String content;
        try {
            MvcResult r = mvc.perform(req).andReturn();
            status = r.getResponse().getStatus();
            content = r.getResponse().getContentAsString();
        } catch (Exception ex) {
            Throwable root = ex;
            while (root.getCause() != null) root = root.getCause();
            failures.add(head + " -> unhandled " + root.getClass().getSimpleName() + ": " + ex.getMessage());
            return;
        }
        if (status >= 500) {
            failures.add(head + " -> HTTP " + status + " " + truncate(content));
        }
        if (carriesVictim) return;
        if (!TOKENLESS_DRAFT_READS.contains(e.key()) && content.contains(SECRET)) {
            failures.add(head + " -> leaked the victim session without its token: " + truncate(content));
        }
        if (!TOKENLESS_DRAFT_REPLACERS.contains(e.key()) && !victimFingerprint().equals(victimBaseline)) {
            failures.add(head + " -> changed the victim session without its token");
        }
    }

    private static String failureKind(String failure) {
        String tail = failure.substring(failure.lastIndexOf("] -> ") + 5);
        if (tail.startsWith("unhandled ")) return tail.substring(0, tail.indexOf(':'));
        if (tail.startsWith("HTTP ")) return tail.substring(0, 8);
        return tail;
    }

    private static String truncate(String s) {
        return s.length() > 200 ? s.substring(0, 200) + "…" : s;
    }

    @Test
    void everyApiEndpointRefusesHostileInputWithout5xxOrCrossTokenLeak() throws Exception {
        List<Endpoint> endpoints = surface();
        Set<String> keys = new HashSet<>();
        endpoints.forEach(e -> keys.add(e.key()));
        assertThat(keys).as("the derived surface must include the draft endpoints")
                .containsAll(TOKENLESS_DRAFT_READS).containsAll(TOKENLESS_DRAFT_REPLACERS)
                .contains("PUT /api/tas/draft")
                .contains("POST /api/system/shutdown");

        Map<String, List<String>> failures = new TreeMap<>();
        int requests = 0;
        for (Endpoint e : endpoints) {
            resetVictim();
            for (String pv : e.pattern().contains("{") ? pathValues(true) : List.of("")) {
                String uri = e.pattern().contains("{") ? expand(e.pattern(), pv) : e.pattern();
                boolean pathCarriesVictim = victimToken.equals(pv);
                if (e.multipart()) {
                    for (byte[] file : List.of(new byte[0], "{not csv".getBytes(), new byte[]{0, (byte) 0xff, 0x7f})) {
                        check(failures, e, "multipart " + file.length + "B", false,
                                multipart(uri).file(new MockMultipartFile("file", "x.csv", "text/csv", file)));
                        requests++;
                        resetVictim();
                    }
                    check(failures, e, "multipart without file", false, multipart(uri));
                    requests++;
                    resetVictim();
                }
                for (Attempt a : bodies()) {
                    check(failures, e, "path=" + truncate(pv) + " body=" + (a.body() == null ? "<none>" : truncate(a.body())),
                            pathCarriesVictim || a.carriesVictim(), build(e, uri, a.body()));
                    requests++;
                    resetVictim();
                }
            }
        }

        failures.values().removeIf(List::isEmpty);
        assertThat(requests).isGreaterThan(endpoints.size());

        Map<String, List<String>> tas = new TreeMap<>(failures);
        tas.keySet().removeIf(k -> !k.split(" ")[1].startsWith("/api/tas/"));
        assertThat(tas).as("TAS hostile-input failures across %d endpoints / %d requests", endpoints.size(), requests)
                .isEmpty();

        List<String> leaks = failures.values().stream().flatMap(List::stream)
                .filter(f -> f.contains("leaked") || f.contains("changed the victim")).toList();
        assertThat(leaks).as("cross-token leaks or mutations anywhere on /api").isEmpty();
        org.mockito.Mockito.verify(exiter, org.mockito.Mockito.never()).exitSoon();

        Map<String, Map<String, Integer>> observed = new TreeMap<>();
        failures.forEach((endpoint, list) -> {
            Map<String, Integer> kinds = new TreeMap<>();
            for (String f : list) kinds.merge(failureKind(f), 1, Integer::sum);
            observed.put(endpoint, kinds);
        });
        assertThat(observed).as("5xx failures must match the tracked OPEN map exactly, per endpoint, kind and"
                + " count (new failure = regression; a fix must shrink KNOWN_OPEN_5XX). First failures: %s",
                failures.values().stream().map(l -> l.get(0)).toList())
                .isEqualTo(new TreeMap<>(KNOWN_OPEN_5XX));
    }
}
