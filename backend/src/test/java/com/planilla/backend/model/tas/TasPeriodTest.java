package com.planilla.backend.model.tas;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class TasPeriodTest {

    @Test
    void of_dayInFirstHalf_returnsQuincenaOne() {
        TasPeriod period = TasPeriod.of(LocalDate.of(2026, 4, 15));
        assertThat(period).isEqualTo(new TasPeriod(2026, 4, 1));
    }

    @Test
    void of_dayInSecondHalf_returnsQuincenaTwo() {
        TasPeriod period = TasPeriod.of(LocalDate.of(2026, 4, 16));
        assertThat(period).isEqualTo(new TasPeriod(2026, 4, 2));
    }
}
