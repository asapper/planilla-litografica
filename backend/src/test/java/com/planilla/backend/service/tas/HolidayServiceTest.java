package com.planilla.backend.service.tas;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for HolidayService.
 *
 * Requirements:
 * - getHolidaysForYear: queries holiday_cache for given year, ordered by date
 * - addManualHoliday: inserts with source='MANUAL'
 * - deleteHoliday: deletes by id
 * - isHoliday: returns true when date exists in cache, false otherwise
 * - loadBundledHolidays: parses holidays-GT.json and merges entries for the given year
 * - refreshFromApi: returns false and calls loadBundledHolidays when API is unreachable
 * - fetchForDateRange: iterates over years in range
 */
@ExtendWith(MockitoExtension.class)
class HolidayServiceTest {

    @Mock JdbcTemplate jdbc;

    HolidayService service;

    @BeforeEach
    void setUp() {
        service = new HolidayService(jdbc, "https://date.nager.at/api/v3/PublicHolidays/{year}/GT", 1);
    }

    @Test
    void getHolidaysForYear_queriesForCorrectYear() {
        List<Map<String, Object>> expected = List.of(Map.of("holiday_date", "2024-01-01", "name", "Año Nuevo"));
        when(jdbc.queryForList(anyString(), eq(2024))).thenReturn(expected);

        List<Map<String, Object>> result = service.getHolidaysForYear(2024);

        assertThat(result).isEqualTo(expected);
        verify(jdbc).queryForList(anyString(), eq(2024));
    }

    @Test
    void addManualHoliday_insertsWithManualSource() {
        service.addManualHoliday("2024-12-25", "Navidad");

        verify(jdbc).update(contains("INSERT INTO holiday_cache"), any(), eq("Navidad"), eq(2024));
    }

    @Test
    void deleteHoliday_executesDeleteById() {
        service.deleteHoliday(42L);

        verify(jdbc).update(contains("DELETE FROM holiday_cache WHERE id"), eq(42L));
    }

    @Test
    void isHoliday_trueWhenDateExists() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(1);

        assertThat(service.isHoliday(LocalDate.of(2024, 1, 1))).isTrue();
    }

    @Test
    void isHoliday_falseWhenDateNotExists() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(0);

        assertThat(service.isHoliday(LocalDate.of(2024, 2, 14))).isFalse();
    }

    @Test
    void isHoliday_falseWhenCountNull() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(null);

        assertThat(service.isHoliday(LocalDate.of(2024, 2, 14))).isFalse();
    }

    @Test
    void loadBundledHolidays_insertsHolidaysForGivenYear() {
        service.loadBundledHolidays(2024);

        verify(jdbc, atLeastOnce()).update(contains("MERGE INTO holiday_cache"), any(), anyString(), eq(2024));
    }

    @Test
    void loadBundledHolidays_doesNotInsertOtherYears() {
        service.loadBundledHolidays(2025);

        verify(jdbc, never()).update(contains("MERGE INTO holiday_cache"), any(), anyString(), eq(2024));
    }

    @Test
    void refreshFromApi_returnsFalseAndLoadsBundledWhenApiUnreachable() {
        service = new HolidayService(jdbc, "http://localhost:19999/unreachable/{year}/GT", 1);

        boolean result = service.refreshFromApi(2024);

        assertThat(result).isFalse();
        verify(jdbc, atLeastOnce()).update(contains("MERGE INTO holiday_cache"), any(), anyString(), eq(2024));
    }

    @Test
    void fetchForDateRange_callsRefreshForEachYear() {
        service = new HolidayService(jdbc, "http://localhost:19999/unreachable/{year}/GT", 1);

        service.fetchForDateRange(LocalDate.of(2024, 1, 1), LocalDate.of(2025, 12, 31));

        verify(jdbc, atLeastOnce()).update(contains("MERGE INTO holiday_cache"), any(), anyString(), eq(2024));
        verify(jdbc, atLeastOnce()).update(contains("MERGE INTO holiday_cache"), any(), anyString(), eq(2025));
    }
}
