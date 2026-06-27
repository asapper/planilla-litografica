package com.planilla.backend.model;

public class EmployeeRow {

    private String codigoEmpleado;
    private String nombreEmpleado;
    private int diasNoLaborados;
    private double horasExtrasSimples;
    private double horasExtrasDobles;
    private int mes;
    private int anio;
    private Integer numeroDequincena; // set by user after upload
    private int diasTurnoEstimado;
    private boolean accruesOvertime = true;

    public EmployeeRow() {}

    public EmployeeRow(EmployeeRow other) {
        this.codigoEmpleado    = other.codigoEmpleado;
        this.nombreEmpleado    = other.nombreEmpleado;
        this.diasNoLaborados   = other.diasNoLaborados;
        this.horasExtrasSimples = other.horasExtrasSimples;
        this.horasExtrasDobles  = other.horasExtrasDobles;
        this.mes               = other.mes;
        this.anio              = other.anio;
        this.numeroDequincena  = other.numeroDequincena;
        this.diasTurnoEstimado = other.diasTurnoEstimado;
        this.accruesOvertime   = other.accruesOvertime;
    }

    public String getCodigoEmpleado() { return codigoEmpleado; }
    public void setCodigoEmpleado(String codigoEmpleado) { this.codigoEmpleado = codigoEmpleado; }

    public String getNombreEmpleado() { return nombreEmpleado; }
    public void setNombreEmpleado(String nombreEmpleado) { this.nombreEmpleado = nombreEmpleado; }

    public int getDiasNoLaborados() { return diasNoLaborados; }
    public void setDiasNoLaborados(int diasNoLaborados) { this.diasNoLaborados = diasNoLaborados; }

    public double getHorasExtrasSimples() { return horasExtrasSimples; }
    public void setHorasExtrasSimples(double horasExtrasSimples) { this.horasExtrasSimples = horasExtrasSimples; }

    public double getHorasExtrasDobles() { return horasExtrasDobles; }
    public void setHorasExtrasDobles(double horasExtrasDobles) { this.horasExtrasDobles = horasExtrasDobles; }

    public int getMes() { return mes; }
    public void setMes(int mes) { this.mes = mes; }

    public int getAnio() { return anio; }
    public void setAnio(int anio) { this.anio = anio; }

    public Integer getNumeroDequincena() { return numeroDequincena; }
    public void setNumeroDequincena(Integer numeroDequincena) { this.numeroDequincena = numeroDequincena; }

    public int getDiasTurnoEstimado() { return diasTurnoEstimado; }
    public void setDiasTurnoEstimado(int diasTurnoEstimado) { this.diasTurnoEstimado = diasTurnoEstimado; }

    public boolean isAccruesOvertime() { return accruesOvertime; }
    public void setAccruesOvertime(boolean accruesOvertime) { this.accruesOvertime = accruesOvertime; }
}
