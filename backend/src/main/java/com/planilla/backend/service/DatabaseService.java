package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class DatabaseService {

    private static final Logger log = LoggerFactory.getLogger(DatabaseService.class);

    private final JdbcTemplate postgresJdbc;
    private final JdbcTemplate h2Jdbc;
    private final boolean demoMode;

    public DatabaseService(
            @Qualifier("postgresJdbcTemplate") JdbcTemplate postgresJdbc,
            @Qualifier("h2JdbcTemplate") JdbcTemplate h2Jdbc,
            @Value("${demo.mode:false}") boolean demoMode) {
        this.postgresJdbc = postgresJdbc;
        this.h2Jdbc = h2Jdbc;
        this.demoMode = demoMode;
    }

    public boolean isDuplicate(EmployeeRow row) {
        Integer count = h2Jdbc.queryForObject(
            "SELECT COUNT(*) FROM carga_log WHERE codigo_empleado = ? AND numero_quincena = ? AND mes = ? AND anio = ?",
            Integer.class,
            row.getCodigoEmpleado(),
            row.getNumeroDequincena(),
            row.getMes(),
            row.getAnio()
        );
        return count != null && count > 0;
    }

    public List<String> checkDuplicates(List<EmployeeRow> rows) {
        List<String> duplicates = new ArrayList<>();
        for (EmployeeRow row : rows) {
            if (isDuplicate(row)) {
                duplicates.add(row.getCodigoEmpleado());
            }
        }
        return duplicates;
    }

    public void submitRow(EmployeeRow row) {
        if (demoMode) {
            log.info("DEMO MODE: submission skipped for employee {}", row.getCodigoEmpleado());
            return;
        }

        postgresJdbc.queryForObject(
            "SELECT public.carga_datos_empleados(?::varchar, ?::integer, ?::numeric, ?::numeric, ?::integer, ?::integer, ?::integer)",
            Integer.class,
            row.getCodigoEmpleado(),
            row.getDiasNoLaborados(),
            row.getHorasExtrasSimples(),
            row.getHorasExtrasDobles(),
            row.getNumeroDequincena(),
            row.getMes(),
            row.getAnio()
        );

        h2Jdbc.update(
            "INSERT INTO carga_log (codigo_empleado, numero_quincena, mes, anio) VALUES (?, ?, ?, ?)",
            row.getCodigoEmpleado(),
            row.getNumeroDequincena(),
            row.getMes(),
            row.getAnio()
        );
    }
}
