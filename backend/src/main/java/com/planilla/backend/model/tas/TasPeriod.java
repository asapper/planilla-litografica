package com.planilla.backend.model.tas;

import java.time.LocalDate;

public record TasPeriod(int anio, int mes, int numeroDequincena) {
    public static TasPeriod of(LocalDate date) {
        return new TasPeriod(date.getYear(), date.getMonthValue(),
                date.getDayOfMonth() <= 15 ? 1 : 2);
    }
}
