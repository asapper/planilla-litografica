package com.planilla.backend.model;

public class EmployeeRow {

    private String codigoEmpleado;
    private String nombreEmpleado;
    private int diasNoLaborados;
    private int horasExtrasSimples;
    private int horasExtrasDobles;
    private int mes;
    private int anio;
    private Integer numeroDequincena; // set by user after upload
    private int diasTurnoAmbiguo;

    public EmployeeRow() {}

    public String getCodigoEmpleado() { return codigoEmpleado; }
    public void setCodigoEmpleado(String codigoEmpleado) { this.codigoEmpleado = codigoEmpleado; }

    public String getNombreEmpleado() { return nombreEmpleado; }
    public void setNombreEmpleado(String nombreEmpleado) { this.nombreEmpleado = nombreEmpleado; }

    public int getDiasNoLaborados() { return diasNoLaborados; }
    public void setDiasNoLaborados(int diasNoLaborados) { this.diasNoLaborados = diasNoLaborados; }

    public int getHorasExtrasSimples() { return horasExtrasSimples; }
    public void setHorasExtrasSimples(int horasExtrasSimples) { this.horasExtrasSimples = horasExtrasSimples; }

    public int getHorasExtrasDobles() { return horasExtrasDobles; }
    public void setHorasExtrasDobles(int horasExtrasDobles) { this.horasExtrasDobles = horasExtrasDobles; }

    public int getMes() { return mes; }
    public void setMes(int mes) { this.mes = mes; }

    public int getAnio() { return anio; }
    public void setAnio(int anio) { this.anio = anio; }

    public Integer getNumeroDequincena() { return numeroDequincena; }
    public void setNumeroDequincena(Integer numeroDequincena) { this.numeroDequincena = numeroDequincena; }

    public int getDiasTurnoAmbiguo() { return diasTurnoAmbiguo; }
    public void setDiasTurnoAmbiguo(int diasTurnoAmbiguo) { this.diasTurnoAmbiguo = diasTurnoAmbiguo; }
}
