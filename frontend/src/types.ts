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

export type JobRowStatus = 'PENDING' | 'SUBMITTED' | 'SKIPPED' | 'FAILED';
export type JobStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'DONE_WITH_ERRORS';

export interface JobRowResult {
  codigoEmpleado: string;
  nombreEmpleado: string;
  status: JobRowStatus;
  error?: string;
}

export interface JobResponse {
  jobId: string;
  status: JobStatus;
  attemptNumber: number;
  maxRetries: number;
  parentJobId: string | null;
  totalRows: number;
  processed: number;
  submitted: number;
  skipped: number;
  failed: number;
  rows: JobRowResult[];
}

export interface StartJobResponse {
  jobId: string;
  status: JobStatus;
}

export type AppState = 'empty' | 'loaded' | 'submitting' | 'polling' | 'result';
export type AppView = 'planilla' | 'config';

export const MONTH_NAMES: Record<number, string> = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
  5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
  9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
};
