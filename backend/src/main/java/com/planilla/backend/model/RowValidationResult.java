package com.planilla.backend.model;

import java.util.ArrayList;
import java.util.List;

public class RowValidationResult {

    private String codigoEmpleado;
    private boolean valid;
    private boolean duplicate;
    private List<FieldError> errors = new ArrayList<>();

    public RowValidationResult(String codigoEmpleado) {
        this.codigoEmpleado = codigoEmpleado;
        this.valid = true;
        this.duplicate = false;
    }

    public void addError(String field, String message) {
        this.valid = false;
        this.errors.add(new FieldError(field, message));
    }

    public String getCodigoEmpleado() { return codigoEmpleado; }
    public boolean isValid() { return valid; }
    public boolean isDuplicate() { return duplicate; }
    public void setDuplicate(boolean duplicate) { this.duplicate = duplicate; }
    public List<FieldError> getErrors() { return errors; }

    public static class FieldError {
        private String field;
        private String message;

        public FieldError(String field, String message) {
            this.field = field;
            this.message = message;
        }

        public String getField() { return field; }
        public String getMessage() { return message; }
    }
}
