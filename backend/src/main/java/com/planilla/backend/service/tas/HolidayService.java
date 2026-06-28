package com.planilla.backend.service.tas;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class HolidayService {

    private static final Logger log = LoggerFactory.getLogger(HolidayService.class);

    private final JdbcTemplate jdbc;
    private final String apiUrl;
    private final int timeoutSeconds;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final Set<Integer> apiAttemptedYears = ConcurrentHashMap.newKeySet();

    @Autowired
    public HolidayService(
            @Qualifier("h2JdbcTemplate") JdbcTemplate jdbc,
            @Value("${holiday.api.url}") String apiUrl,
            @Value("${holiday.api.timeout-seconds:5}") int timeoutSeconds) {
        this(jdbc, apiUrl, timeoutSeconds,
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(timeoutSeconds)).build());
    }

    HolidayService(JdbcTemplate jdbc, String apiUrl, int timeoutSeconds, HttpClient httpClient) {
        this.jdbc = jdbc;
        this.apiUrl = apiUrl;
        this.timeoutSeconds = timeoutSeconds;
        this.objectMapper = new ObjectMapper();
        this.httpClient = httpClient;
    }

    public List<Map<String, Object>> getHolidaysForYear(int year) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT id, holiday_date, name, holiday_year, source FROM holiday_cache WHERE holiday_year = ? ORDER BY holiday_date",
            year
        );
        List<Map<String, Object>> result = new java.util.ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(toHolidayDto(row));
        }
        return result;
    }

    public Map<String, Object> addManualHoliday(String date, String name) {
        LocalDate localDate = LocalDate.parse(date);
        jdbc.update(
            "INSERT INTO holiday_cache (holiday_date, name, holiday_year, source) VALUES (?, ?, ?, 'MANUAL')",
            java.sql.Date.valueOf(localDate), name, localDate.getYear()
        );
        Map<String, Object> row = jdbc.queryForMap(
            "SELECT id, holiday_date, name, holiday_year, source FROM holiday_cache WHERE holiday_date = ? AND source = 'MANUAL'",
            java.sql.Date.valueOf(localDate)
        );
        return toHolidayDto(row);
    }

    public void deleteHoliday(long id) {
        jdbc.update("DELETE FROM holiday_cache WHERE id = ?", id);
    }

    public boolean refreshFromApi(int year) {
        if (!apiAttemptedYears.add(year)) {
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM holiday_cache WHERE holiday_year = ? AND source = 'API'", Integer.class, year);
            return count != null && count > 0;
        }
        String url = apiUrl.replace("{year}", String.valueOf(year));
        int[] backoffSeconds = {1};

        for (int attempt = 0; attempt <= backoffSeconds.length; attempt++) {
            try {
                if (attempt > 0) {
                    Thread.sleep(backoffSeconds[attempt - 1] * 1000L);
                }
                HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .GET()
                    .build();
                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() == 200) {
                    List<Map<String, Object>> holidays = objectMapper.readValue(
                        response.body(),
                        new TypeReference<List<Map<String, Object>>>() {}
                    );
                    jdbc.update("DELETE FROM holiday_cache WHERE holiday_year = ? AND source = 'API'", year);
                    for (Map<String, Object> h : holidays) {
                        String dateStr = (String) h.get("date");
                        String name = (String) h.get("localName");
                        if (dateStr != null && name != null) {
                            LocalDate d = LocalDate.parse(dateStr);
                            try {
                                jdbc.update(
                                    "INSERT INTO holiday_cache (holiday_date, name, holiday_year, source) VALUES (?, ?, ?, 'API')",
                                    java.sql.Date.valueOf(d), name, year
                                );
                            } catch (Exception e) {
                                log.warn("Skipping holiday entry for year {}: {}", year, e.getMessage());
                            }
                        }
                    }
                    return true;
                }
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                log.warn("Holiday API attempt {} failed for year {}: {}", attempt + 1, year, e.getMessage());
            }
        }
        loadBundledHolidays(year);
        return false;
    }

    public void loadBundledHolidays(int year) {
        try {
            InputStream is = new ClassPathResource("holidays-GT.json").getInputStream();
            List<Map<String, Object>> all = objectMapper.readValue(
                is,
                new TypeReference<List<Map<String, Object>>>() {}
            );
            for (Map<String, Object> h : all) {
                String dateStr = (String) h.get("date");
                String name = (String) h.get("localName");
                if (dateStr != null && name != null) {
                    LocalDate d = LocalDate.parse(dateStr);
                    if (d.getYear() == year) {
                        try {
                            jdbc.update(
                                "MERGE INTO holiday_cache (holiday_date, name, holiday_year, source) KEY(holiday_date, source) VALUES (?, ?, ?, 'BUNDLED')",
                                java.sql.Date.valueOf(d), name, year
                            );
                        } catch (Exception ignored) {
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.error("Failed to load bundled holidays for year {}: {}", year, e.getMessage());
        }
    }

    public boolean isHoliday(LocalDate date) {
        Integer count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM holiday_cache WHERE holiday_date = ?",
            Integer.class, java.sql.Date.valueOf(date)
        );
        return count != null && count > 0;
    }

    public boolean fetchForDateRange(LocalDate start, LocalDate end) {
        boolean allSucceeded = true;
        int startYear = start.getYear();
        int endYear = end.getYear();
        for (int year = startYear; year <= endYear; year++) {
            if (!refreshFromApi(year)) {
                allSucceeded = false;
            }
        }
        return allSucceeded;
    }

    private Map<String, Object> toHolidayDto(Map<String, Object> row) {
        Map<String, Object> dto = new java.util.LinkedHashMap<>();
        dto.put("id", row.get("ID"));
        dto.put("date", row.get("HOLIDAY_DATE").toString());
        dto.put("name", row.get("NAME"));
        Object source = row.get("SOURCE");
        dto.put("source", "API".equals(source) ? "API" : "Manual");
        return dto;
    }
}
