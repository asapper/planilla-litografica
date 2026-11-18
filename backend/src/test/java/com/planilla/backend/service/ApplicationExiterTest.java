package com.planilla.backend.service;

import org.junit.jupiter.api.Test;
import org.springframework.context.ConfigurableApplicationContext;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ApplicationExiterTest {

    @Test
    void exitSoon_closesTheContextThenExitsWithZero() throws Exception {
        ConfigurableApplicationContext context = mock(ConfigurableApplicationContext.class);
        when(context.isActive()).thenReturn(true);
        CompletableFuture<Integer> exitCode = new CompletableFuture<>();

        new ApplicationExiter(context, exitCode::complete).exitSoon();

        assertThat(exitCode.get(5, TimeUnit.SECONDS)).isZero();
        verify(context).close();
    }
}
