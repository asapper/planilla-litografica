package com.planilla.backend.controller;

import com.planilla.backend.service.ApplicationExiter;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class ShutdownControllerTest {

    private final ApplicationExiter exiter = mock(ApplicationExiter.class);

    @Test
    void withoutAConfiguredToken_theEndpointDoesNotExist() {
        ResponseEntity<?> response = new ShutdownController(exiter, "").shutdown("anything");

        assertThat(response.getStatusCode().value()).isEqualTo(404);
        verify(exiter, never()).exitSoon();
    }

    @Test
    void aMissingOrWrongToken_isRefused() {
        ShutdownController controller = new ShutdownController(exiter, "s3cret");

        assertThat(controller.shutdown(null).getStatusCode().value()).isEqualTo(403);
        assertThat(controller.shutdown("").getStatusCode().value()).isEqualTo(403);
        assertThat(controller.shutdown("s3cre").getStatusCode().value()).isEqualTo(403);
        assertThat(controller.shutdown("s3cret ").getStatusCode().value()).isEqualTo(403);
        verify(exiter, never()).exitSoon();
    }

    @Test
    void theShellsToken_exitsTheApplication() {
        ResponseEntity<?> response = new ShutdownController(exiter, "s3cret").shutdown("s3cret");

        assertThat(response.getStatusCode().value()).isEqualTo(202);
        verify(exiter).exitSoon();
    }
}
