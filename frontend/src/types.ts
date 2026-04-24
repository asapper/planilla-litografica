export interface EmployeeRow {
  codigoEmpleado: string;
  nombreEmpleado: string;
  diasNoLaborados: number;
  horasExtrasSimples: number;
  horasExtrasDobles: number;
  mes: number;
  anio: number;
  numeroDequincena?: number;
}

export interface MonthOption {
  mes: number;
  anio: number;
}

export interface UploadResponse {
  rows: EmployeeRow[];
  monthOptions: MonthOption[];
  multiMonth: boolean;
  parseWarnings: string[];
}

export interface FieldError {
  field: string;
  message: string;
}

export interface RowValidationResult {
  codigoEmpleado: string;
  valid: boolean;
  duplicate: boolean;
  errors: FieldError[];
}

export interface ValidateResponse {
  allValid: boolean;
  hasDuplicates: boolean;
  rows: RowValidationResult[];
}

export interface RowSubmitResult {
  codigoEmpleado: string;
  submitted: boolean;
  skippedDuplicate: boolean;
  error?: string;
}

export interface SubmitResponse {
  totalSubmitted: number;
  totalSkippedDuplicates: number;
  totalFailed: number;
  rows: RowSubmitResult[];
}

export type AppState = 'empty' | 'loaded' | 'submitting' | 'result';

export const MONTH_NAMES: Record<number, string> = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
  5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
  9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
};
