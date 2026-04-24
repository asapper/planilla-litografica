package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;


@Service
public class CsvParserService {

    // ISO-8859-1 to handle Spanish characters in the attendance report
    private static final Charset FILE_ENCODING = Charset.forName("ISO-8859-1");

    public ParseResult parse(MultipartFile file) throws Exception {
        List<EmployeeRow> rows = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        Reader reader = new InputStreamReader(file.getInputStream(), FILE_ENCODING);

        // Apache Commons CSV handles multiline quoted fields correctly
        CSVFormat format = CSVFormat.DEFAULT.builder()
                .setIgnoreEmptyLines(false)
                .build();

        try (CSVParser parser = new CSVParser(reader, format)) {
            String currentCode = null;
            String currentName = null;

            for (CSVRecord record : parser) {
                if (record.size() == 0) continue;

                String col0 = get(record, 0).trim();

                // Employee header row: col[0] == "Empleado"
                if ("Empleado".equalsIgnoreCase(col0)) {
                    currentCode = get(record, 1).trim();
                    currentName = get(record, 2).replace("\"", "").trim();
                    continue;
                }

                // Summary row: col[0] is a date AND col[8] == "Ausencias"
                if (isDate(col0) && "Ausencias".equalsIgnoreCase(get(record, 8).trim())) {
                    if (currentCode == null || currentCode.isBlank()) {
                        warnings.add("Fila de resumen encontrada sin bloque de empleado previo. Línea ignorada.");
                        continue;
                    }

                    EmployeeRow row = new EmployeeRow();
                    row.setCodigoEmpleado(currentCode);
                    row.setNombreEmpleado(currentName);
                    row.setDiasNoLaborados(parseIntSafe(get(record, 18)));
                    row.setHorasExtrasSimples(convertTime(get(record, 27)));
                    row.setHorasExtrasDobles(convertTime(get(record, 28)));

                    int[] mesAnio = extractMesAnio(col0);
                    row.setMes(mesAnio[0]);
                    row.setAnio(mesAnio[1]);

                    rows.add(row);
                    currentCode = null;
                    currentName = null;
                }
            }
        }

        if (rows.isEmpty()) {
            throw new Exception("No se encontraron registros de empleados en el archivo.");
        }

        // Build distinct month options from summary rows only — sorted chronologically
        Set<String> summaryMonthKeys = new LinkedHashSet<>();
        for (EmployeeRow row : rows) {
            summaryMonthKeys.add(String.format("%04d-%02d", row.getAnio(), row.getMes()));
        }
        List<String> sortedKeys = new ArrayList<>(summaryMonthKeys);
        Collections.sort(sortedKeys);
        List<int[]> distinctMonths = new ArrayList<>();
        for (String key : sortedKeys) {
            String[] parts = key.split("-");
            distinctMonths.add(new int[]{ Integer.parseInt(parts[1]), Integer.parseInt(parts[0]) });
        }

        return new ParseResult(rows, warnings, distinctMonths);
    }

    // Safe field accessor — returns empty string if index out of range
    private String get(CSVRecord record, int index) {
        return index < record.size() ? record.get(index) : "";
    }

    // Convert HH:MM:SS or HH:MM to total hours, rounded to nearest integer
    private int convertTime(String value) {
        if (value == null || value.isBlank()) return 0;
        String[] parts = value.trim().split(":");
        try {
            int hours   = Integer.parseInt(parts[0]);
            int minutes = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
            return (int) Math.round(hours + minutes / 60.0);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private int parseIntSafe(String value) {
        if (value == null || value.isBlank()) return 0;
        try { return Integer.parseInt(value.trim()); }
        catch (NumberFormatException e) { return 0; }
    }

    private boolean isDate(String value) {
        return value != null && value.matches("\\d{1,2}/\\d{1,2}/\\d{4}");
    }

    // Parse DD/MM/YYYY → [mes, anio]
    private int[] extractMesAnio(String dateStr) {
        String[] parts = dateStr.split("/");
        return new int[]{ Integer.parseInt(parts[1]), Integer.parseInt(parts[2]) };
    }

    public static class ParseResult {
        public final List<EmployeeRow> rows;
        public final List<String> warnings;
        public final List<int[]> distinctMonths;

        public ParseResult(List<EmployeeRow> rows, List<String> warnings, List<int[]> distinctMonths) {
            this.rows           = rows;
            this.warnings       = warnings;
            this.distinctMonths = distinctMonths;
        }
    }
}
