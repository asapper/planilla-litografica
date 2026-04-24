package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DatabaseService {

    private final JdbcTemplate postgresJdbc;
    private final JdbcTemplate h2Jdbc;

    public DatabaseService(
            @Qualifier("postgresJdbcTemplate") JdbcTemplate postgresJdbc,
            @Qualifier("h2JdbcTemplate") JdbcTemplate h2Jdbc) {
        this.postgresJdbc = postgresJdbc;
        this.h2Jdbc = h2Jdbc;
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

    public void submitRow(EmployeeRow row) {
        // Execute stored procedure on remote PostgreSQL
        postgresJdbc.queryForObject(
            "SELECT public.carga_datos_empleados(?::varchar, ?::integer, ?::integer, ?::integer, ?::integer, ?::integer, ?::integer)",
            Integer.class,
            row.getCodigoEmpleado(),
            row.getDiasNoLaborados(),
            row.getHorasExtrasSimples(),
            row.getHorasExtrasDobles(),
            row.getNumeroDequincena(),
            row.getMes(),
            row.getAnio()
        );

        // Record successful submission in local H2 log
        h2Jdbc.update(
            "INSERT INTO carga_log (codigo_empleado, numero_quincena, mes, anio) VALUES (?, ?, ?, ?)",
            row.getCodigoEmpleado(),
            row.getNumeroDequincena(),
            row.getMes(),
            row.getAnio()
        );
    }
}
