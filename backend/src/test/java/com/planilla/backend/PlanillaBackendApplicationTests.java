package com.planilla.backend;

import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.mockito.Mockito;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThatCode;

@SpringBootTest
@ActiveProfiles("test")
class PlanillaBackendApplicationTests {

	@Test
	void contextLoads() {
	}

	/**
	 * Verifies that main() delegates to SpringApplication.run() without throwing.
	 * We mock SpringApplication.run to avoid spinning up a second full context.
	 */
	@Test
	void mainMethodDelegatesToSpringApplicationRun() {
		try (MockedStatic<SpringApplication> mock = Mockito.mockStatic(SpringApplication.class)) {
			mock.when(() -> SpringApplication.run(PlanillaBackendApplication.class, new String[]{}))
			    .thenReturn(null);

			assertThatCode(() -> PlanillaBackendApplication.main(new String[]{}))
			    .doesNotThrowAnyException();

			mock.verify(() -> SpringApplication.run(PlanillaBackendApplication.class, new String[]{}));
		}
	}
}
