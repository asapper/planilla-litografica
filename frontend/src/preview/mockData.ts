import type { EmployeeRow, ValidateResponse, SubmitResponse } from '../types';

export const mockRows: EmployeeRow[] = [
  { codigoEmpleado: '3',  nombreEmpleado: 'DIEGUEZ EQUITE, JOSE ARMANDO',       diasNoLaborados: 0, horasExtrasSimples: 46, horasExtrasDobles: 0,  mes: 12, anio: 2025 },
  { codigoEmpleado: '16', nombreEmpleado: 'HERNANDEZ HERNANDEZ, ARGELIA',        diasNoLaborados: 0, horasExtrasSimples: 43, horasExtrasDobles: 0,  mes: 12, anio: 2025 },
  { codigoEmpleado: '18', nombreEmpleado: 'YOC, RIGOBERTO',                      diasNoLaborados: 2, horasExtrasSimples: 32, horasExtrasDobles: 0,  mes: 12, anio: 2025 },
  { codigoEmpleado: '20', nombreEmpleado: 'URIZAR CRUZ, IZABEL FRANCISCO',       diasNoLaborados: 0, horasExtrasSimples: 23, horasExtrasDobles: 0,  mes: 12, anio: 2025 },
  { codigoEmpleado: '23', nombreEmpleado: 'BOBADILLA AREVALO, DORIS NOEMI',      diasNoLaborados: 1, horasExtrasSimples: 38, horasExtrasDobles: 4,  mes: 12, anio: 2025 },
  { codigoEmpleado: '27', nombreEmpleado: 'GARCIA LOPEZ, MARIO ALBERTO',         diasNoLaborados: 0, horasExtrasSimples: 51, horasExtrasDobles: 0,  mes: 12, anio: 2025 },
  { codigoEmpleado: '31', nombreEmpleado: 'MENDOZA CIFUENTES, ANA PATRICIA',     diasNoLaborados: 3, horasExtrasSimples: 0,  horasExtrasDobles: 0,  mes: 12, anio: 2025 },
  { codigoEmpleado: '34', nombreEmpleado: 'PEREZ MONTERROSO, CARLOS ENRIQUE',    diasNoLaborados: 0, horasExtrasSimples: 29, horasExtrasDobles: 8,  mes: 12, anio: 2025 },
];

export const mockRowsMultiMonth: EmployeeRow[] = mockRows.map((r, i) => ({
  ...r,
  mes: i < 4 ? 11 : 12,
}));

export const mockValidationWithErrors: ValidateResponse = {
  allValid: false,
  hasDuplicates: false,
  rows: mockRows.map((r, i) => ({
    codigoEmpleado: r.codigoEmpleado,
    valid: i !== 2 && i !== 5,
    duplicate: false,
    errors: i === 2
      ? [{ field: 'horas_extras_simples', message: 'Debe ser un número entero mayor o igual a 0.' }]
      : i === 5
      ? [{ field: 'dias_no_laborados', message: 'El campo es obligatorio.' }]
      : [],
  })),
};

export const mockValidationWithDuplicates: ValidateResponse = {
  allValid: false,
  hasDuplicates: true,
  rows: mockRows.map((r, i) => ({
    codigoEmpleado: r.codigoEmpleado,
    valid: true,
    duplicate: i === 1 || i === 4,
    errors: [],
  })),
};

export const mockSubmitSuccess: SubmitResponse = {
  totalSubmitted: 8,
  totalSkippedDuplicates: 0,
  totalFailed: 0,
  rows: mockRows.map(r => ({ codigoEmpleado: r.codigoEmpleado, submitted: true, skippedDuplicate: false })),
};

export const mockSubmitPartial: SubmitResponse = {
  totalSubmitted: 6,
  totalSkippedDuplicates: 1,
  totalFailed: 1,
  rows: mockRows.map((r, i) => ({
    codigoEmpleado: r.codigoEmpleado,
    submitted: i !== 2 && i !== 4,
    skippedDuplicate: i === 4,
    error: i === 2 ? 'Error al procesar el registro.' : undefined,
  })),
};

export const mockSubmitFailure: SubmitResponse = {
  totalSubmitted: 0,
  totalSkippedDuplicates: 0,
  totalFailed: 8,
  rows: mockRows.map(r => ({ codigoEmpleado: r.codigoEmpleado, submitted: false, skippedDuplicate: false, error: 'Error al procesar el registro.' })),
};
