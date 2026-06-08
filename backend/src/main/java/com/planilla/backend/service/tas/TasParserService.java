package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasScanRecord;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.io.SequenceInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class TasParserService {

    private static final DateTimeFormatter TIMESTAMP_FORMAT =
            DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm");

    public ParseResult parse(MultipartFile file) throws Exception {
        byte[] rawBytes = file.getBytes();

        byte[] content;
        if (rawBytes.length >= 3
                && (rawBytes[0] & 0xFF) == 0xEF
                && (rawBytes[1] & 0xFF) == 0xBB
                && (rawBytes[2] & 0xFF) == 0xBF) {
            content = Arrays.copyOfRange(rawBytes, 3, rawBytes.length);
        } else {
            content = rawBytes;
        }

        Reader reader = new InputStreamReader(new ByteArrayInputStream(content), StandardCharsets.UTF_8);

        CSVFormat format = CSVFormat.DEFAULT.builder()
                .setIgnoreEmptyLines(true)
                .build();

        List<TasScanRecord> rawScans = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        try (CSVParser parser = new CSVParser(reader, format)) {
            for (CSVRecord record : parser) {
                if (record.size() < 5) continue;

                String col0 = record.get(0).trim();
                if ("No.".equalsIgnoreCase(col0) || !isNumeric(col0)) {
                    continue;
                }

                String timestampStr = record.get(1).trim();
                String employeeName = record.get(3).trim();
                String employeeId   = record.get(4).trim();

                if (timestampStr.isEmpty() || employeeId.isEmpty()) {
                    warnings.add("Fila " + col0 + " ignorada: datos incompletos.");
                    continue;
                }

                try {
                    LocalDateTime timestamp = LocalDateTime.parse(timestampStr, TIMESTAMP_FORMAT);
                    TasScanRecord scan = new TasScanRecord();
                    scan.setEmployeeId(employeeId);
                    scan.setEmployeeName(employeeName);
                    scan.setTimestamp(timestamp);
                    rawScans.add(scan);
                } catch (Exception e) {
                    warnings.add("Fila " + col0 + " ignorada: formato de fecha inválido '" + timestampStr + "'.");
                }
            }
        }

        if (rawScans.isEmpty()) {
            throw new Exception("No se encontraron registros de empleados en el archivo.");
        }

        rawScans.sort(Comparator
                .comparing(TasScanRecord::getEmployeeId)
                .thenComparing(TasScanRecord::getTimestamp));

        return new ParseResult(rawScans, warnings);
    }

    private boolean isNumeric(String value) {
        if (value == null || value.isBlank()) return false;
        try {
            Long.parseLong(value.trim());
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    public static class ParseResult {
        public final List<TasScanRecord> scans;
        public final List<String> warnings;

        public ParseResult(List<TasScanRecord> scans, List<String> warnings) {
            this.scans    = scans;
            this.warnings = warnings;
        }
    }
}
