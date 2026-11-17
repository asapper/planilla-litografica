package com.planilla.backend.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.stereotype.Component;

import java.util.function.IntConsumer;

/** Closes the Spring context (and with it the H2 database, cleanly) and ends the JVM. */
@Component
public class ApplicationExiter {

    private final ConfigurableApplicationContext context;
    private final IntConsumer jvmExit;

    @Autowired
    public ApplicationExiter(ConfigurableApplicationContext context) {
        this(context, System::exit);
    }

    ApplicationExiter(ConfigurableApplicationContext context, IntConsumer jvmExit) {
        this.context = context;
        this.jvmExit = jvmExit;
    }

    /** Off the request thread, so the 202 goes out before the server stops. */
    public void exitSoon() {
        new Thread(() -> jvmExit.accept(SpringApplication.exit(context, () -> 0)), "app-exit").start();
    }
}
