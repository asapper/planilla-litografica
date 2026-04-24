package com.planilla.backend.controller;

import com.planilla.backend.service.CsvParserService;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Direct (non-MockMvc) unit tests for UploadController.
 *
 * MockMvc/Spring's multipart pipeline converts a null originalFilename before
 * it reaches the controller, so the `filename == null` branch of the guard
 * condition cannot be triggered via MockMvc. These tests instantiate the
 * controller directly and mock MultipartFile to force the null path.
 */
class UploadControllerDirectTest {

    private UploadController controller() {
        return new UploadController(mock(CsvParserService.class));
    }

    @Test
    void nullOriginalFilenameDirectlyReturns400() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(false);
        when(file.getOriginalFilename()).thenReturn(null);

        ResponseEntity<?> response = controller().upload(file);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("code")).isEqualTo("INVALID_FORMAT");
    }
}
