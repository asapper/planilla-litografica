package com.planilla.backend.controller;

import com.planilla.backend.model.EmployeeRow;
import com.planilla.backend.service.DatabaseService;
import com.planilla.backend.service.JobService;
import com.planilla.backend.service.tas.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** TASK-88: the per-token job claim, exercised through the controller against a real JobService. */
class TasControllerJobConcurrencyTest {

    private DatabaseService databaseService;
    private TasDraftService draftService;
    private JobService jobService;
    private TasController controller;
    private CountDownLatch releaseSubmission;

    @BeforeEach
    void setUp() throws Exception {
        databaseService = mock(DatabaseService.class);
        draftService = mock(TasDraftService.class);
        releaseSubmission = new CountDownLatch(1);
        when(databaseService.isDuplicate(any())).thenAnswer(inv -> {
            releaseSubmission.await(5, TimeUnit.SECONDS);
            return false;
        });
        jobService = new JobService(databaseService, draftService);
        ReflectionTestUtils.setField(jobService, "maxRetries", 3);
        controller = new TasController(mock(TasParserService.class), mock(TasUploadService.class),
                mock(TasReportBuilder.class), mock(EmployeeRegistryService.class), jobService,
                mock(ShiftConfigService.class), mock(TasHoursCalculator.class), databaseService, draftService);

        EmployeeRow row = new EmployeeRow();
        row.setCodigoEmpleado("100");
        row.setNombreEmpleado("Ana");
        TasUploadState state = new TasUploadState();
        state.setUploadToken("tok");
        state.setSessions(new ArrayList<>());
        state.setResolvedRows(new ArrayList<>(List.of(row)));
        controller.stateStore.put("tok", state);
        when(draftService.findSummary()).thenReturn(Optional.of(new TasDraftService.Summary(
                "tok", "oct.csv", "review", null, Instant.now(), false)));
    }

    @AfterEach
    void tearDown() {
        releaseSubmission.countDown();
        jobService.shutdown();
    }

    @SuppressWarnings("unchecked")
    private boolean jobActiveInSummary() {
        ResponseEntity<?> res = controller.getDraft();
        return (Boolean) ((Map<String, Object>) res.getBody()).get("jobActive");
    }

    @Test
    void twoConcurrentSubmitsForTheSameTokenAcceptExactlyOne() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Callable<Integer> submit = () -> {
            start.await();
            return controller.submit(new HashMap<>(Map.of("uploadToken", "tok"))).getStatusCode().value();
        };
        Future<Integer> a = pool.submit(submit);
        Future<Integer> b = pool.submit(submit);
        start.countDown();
        List<Integer> statuses = List.of(a.get(5, TimeUnit.SECONDS), b.get(5, TimeUnit.SECONDS));
        pool.shutdown();

        assertThat(statuses).containsExactlyInAnyOrder(202, 409);
    }

    @Test
    void summaryReportsJobActiveWhileTheJobRunsAndNotAfter() {
        assertThat(jobActiveInSummary()).isFalse();

        assertThat(controller.submit(new HashMap<>(Map.of("uploadToken", "tok"))).getStatusCode().value())
                .isEqualTo(202);
        assertThat(jobActiveInSummary()).isTrue();
        assertThat(controller.submit(new HashMap<>(Map.of("uploadToken", "tok"))).getStatusCode().value())
                .isEqualTo(409);

        releaseSubmission.countDown();
        await().atMost(Duration.ofSeconds(3)).until(() -> !jobActiveInSummary());
        verify(draftService).deleteIfToken("tok");
        assertThat(controller.stateStore).doesNotContainKey("tok");
    }

    @Test
    void aJobThatThrowsStillClearsJobActive() {
        reset(databaseService);
        when(databaseService.isDuplicate(any())).thenReturn(false);
        doThrow(new IllegalStateException("draft store exploded")).when(draftService).deleteIfToken("tok");

        assertThat(controller.submit(new HashMap<>(Map.of("uploadToken", "tok"))).getStatusCode().value())
                .isEqualTo(202);

        await().atMost(Duration.ofSeconds(3)).until(() -> !jobActiveInSummary());
    }
}
