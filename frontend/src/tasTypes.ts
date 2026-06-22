export type TasFlag = 'MISSING_ENTRY' | 'MISSING_EXIT' | 'SHIFT_MISMATCH' | 'SAME_DAY_DOUBLE' | 'START_CUTOFF' | 'END_CUTOFF' | 'BEST_FIT_SHIFT' | 'SHORT_DAY'

export interface TasSession {
  sessionId: number
  employeeId: string
  employeeName: string
  date: string
  scans: string[]
  matchedShiftId: string | null
  matchedShiftName: string | null
  assignedShiftId: string | null
  assignedShiftName: string | null
  effectiveStart: string | null
  lastScan: string | null
  workedMinutes: number
  workedHours: number
  needsResolution: boolean
  flags: TasFlag[]
}

export interface ShiftOption {
  id: string
  name: string
  startTime: string
  endTime: string
}

export interface TasPeriod {
  anio: number
  mes: number
  numeroDequincena: number
}

export interface InactiveEmployee { employeeId: string; name: string; sessionCount: number }
export interface AbsentEmployee { employeeId: string; name: string; active?: boolean }

export interface ResolvedRow {
  codigoEmpleado: string
  nombreEmpleado: string
  diasNoLaborados: number
  horasExtrasSimples: number
  horasExtrasDobles: number
  mes: number
  anio: number
  numeroDequincena: number | null
  diasTurnoEstimado: number
  accruesOvertime: boolean
}

export interface SessionSummary {
  date: string
  shiftName: string | null
  entryTime: string | null
  exitTime: string | null
  workedHours: number
  simplesMinutes: number
  doblesMinutes: number
  scans: string[]
}

export interface TasUploadResult {
  uploadToken: string
  resolvedRows?: ResolvedRow[]
  flaggedSessions: TasSession[]
  inactiveEmployeesFound: InactiveEmployee[]
  absentActiveEmployees: AbsentEmployee[]
  usedFallbackHolidays: boolean
  warnings: string[]
  availablePeriods?: TasPeriod[]
  availableShifts: ShiftOption[]
  sessionSummaries?: Record<string, SessionSummary[]>
}

export interface TasResolveResult {
  uploadToken: string
  resolvedRows?: ResolvedRow[]
  flaggedSessions: TasSession[]
  usedFallbackHolidays: boolean
  availablePeriods?: TasPeriod[]
  availableShifts: ShiftOption[]
  sessionSummaries?: Record<string, SessionSummary[]>
}

export type InactiveDecision = 'reactivate' | 'ignore'
export type TasView = 'idle' | 'processing' | 'inactiveReview' | 'verification' | 'review' | 'submitting' | 'polling' | 'result' | 'absentReview'

export interface JobFailedRow {
  codigoEmpleado: string;
  nombreEmpleado: string;
  error: string;
}

export interface JobStatus {
  jobId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'DONE_WITH_ERRORS';
  totalRows: number;
  submitted: number;
  skipped: number;
  failed: number;
  attemptNumber: number;
  maxRetries: number;
  failedRows: JobFailedRow[];
}
