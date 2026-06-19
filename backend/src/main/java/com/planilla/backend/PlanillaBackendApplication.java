package com.planilla.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class PlanillaBackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(PlanillaBackendApplication.class, args);
	}

}
