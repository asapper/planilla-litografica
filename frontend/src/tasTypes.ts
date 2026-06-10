export type TasFlag = 'MISSING_ENTRY' | 'MISSING_EXIT' | 'SHIFT_MISMATCH' | 'SAME_DAY_DOUBLE' | 'START_CUTOFF' | 'END_CUTOFF'

export interface TasSession {
  sessionId: number
  employeeId: string
  employeeName: string
  date: string
  scans: string[]
  matchedShiftId: string | null
  matchedShiftName: string | null
  effectiveStart: string | null
  lastScan: string | null
  workedMinutes: number
  workedHours: number
  needsResolution: boolean
  flags: TasFlag[]
  consistentMismatch: boolean
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
}

export interface TasUploadResult {
  uploadToken: string
  resolvedRows?: ResolvedRow[]
  flaggedSessions: TasSession[]
  inactiveEmployeesFound: InactiveEmployee[]
  absentActiveEmployees: AbsentEmployee[]
  usedFallbackHolidays: boolean
  warnings: string[]
}

export interface TasResolveResult {
  uploadToken: string
  resolvedRows?: ResolvedRow[]
  flaggedSessions: TasSession[]
  usedFallbackHolidays: boolean
}

export type InactiveDecision = 'reactivate' | 'ignore'
export type TasView = 'idle' | 'processing' | 'inactiveReview' | 'verification' | 'review' | 'submitting' | 'result' | 'absentReview'
