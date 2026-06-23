import type { TasUploadResult, TasResolveResult, ResolvedRow, SessionSummary, TasSession, InactiveEmployee, AbsentEmployee, TasPeriod, ShiftOption, JobStatus } from '../src/tasTypes';
import type { Shift, Employee, Holiday, GeneralConfig } from '../src/configTypes';

// ── Shared data ──────────────────────────────────────────────────────

export const SHIFTS: Shift[] = [
  { id: 'shift-1', name: 'Mañana', startTime: '06:00', endTime: '14:00', crossMidnight: false, detectionBeforeMinutes: 60, detectionAfterMinutes: 10 },
  { id: 'shift-2', name: 'Tarde', startTime: '14:00', endTime: '22:00', crossMidnight: false, detectionBeforeMinutes: 60, detectionAfterMinutes: 10 },
  { id: 'shift-3', name: 'Noche', startTime: '22:00', endTime: '06:00', crossMidnight: true, detectionBeforeMinutes: 60, detectionAfterMinutes: 10 },
];

export const SHIFT_OPTIONS: ShiftOption[] = SHIFTS.map(s => ({
  id: s.id, name: s.name, startTime: s.startTime, endTime: s.endTime,
}));

export const EMPLOYEES: Employee[] = [
  { id: 'emp-1', code: 'E001', name: 'García López, María Elena', shiftId: 'shift-1', shiftName: 'Mañana', active: true, accruesOvertime: true },
  { id: 'emp-2', code: 'E002', name: 'Hernández Ruiz, Carlos Alberto', shiftId: 'shift-1', shiftName: 'Mañana', active: true, accruesOvertime: true },
  { id: 'emp-3', code: 'E003', name: 'Morales Pérez, Ana Lucía', shiftId: 'shift-2', shiftName: 'Tarde', active: true, accruesOvertime: false },
  { id: 'emp-4', code: 'E004', name: 'López Castillo, Pedro José', shiftId: 'shift-2', shiftName: 'Tarde', active: true, accruesOvertime: true },
  { id: 'emp-5', code: 'E005', name: 'Ramírez Torres, Sofía', shiftId: 'shift-3', shiftName: 'Noche', active: false, accruesOvertime: true },
  { id: 'emp-6', code: 'E006', name: 'Castañeda Vega, Roberto', shiftId: 'shift-1', shiftName: 'Mañana', active: true, accruesOvertime: true },
  { id: 'emp-7', code: 'E007', name: 'Figueroa Mendoza, Laura', shiftId: null, shiftName: null, active: true, accruesOvertime: false },
];

export const HOLIDAYS: Holiday[] = [
  { id: 1, date: '2026-01-01', name: 'Año Nuevo', source: 'API' },
  { id: 2, date: '2026-04-09', name: 'Jueves Santo', source: 'API' },
  { id: 3, date: '2026-04-10', name: 'Viernes Santo', source: 'API' },
  { id: 4, date: '2026-04-11', name: 'Sábado Santo', source: 'API' },
  { id: 5, date: '2026-05-01', name: 'Día del Trabajo', source: 'API' },
  { id: 6, date: '2026-06-30', name: 'Día del Ejército', source: 'API' },
  { id: 7, date: '2026-09-15', name: 'Día de la Independencia', source: 'API' },
  { id: 8, date: '2026-10-20', name: 'Día de la Revolución', source: 'API' },
  { id: 9, date: '2026-11-01', name: 'Día de Todos los Santos', source: 'API' },
  { id: 10, date: '2026-12-24', name: 'Nochebuena', source: 'API' },
  { id: 11, date: '2026-12-25', name: 'Navidad', source: 'API' },
  { id: 12, date: '2026-12-31', name: 'Fin de Año', source: 'API' },
  { id: 13, date: '2026-08-15', name: 'Día de la Asunción (local)', source: 'Manual' },
];

export const GENERAL_CONFIG: GeneralConfig = {
  legalBreakAllowanceMinutes: 45,
  maxSessionSpanMinutes: 840,
};

// ── Inactive employee review ─────────────────────────────────────────

export const INACTIVE_EMPLOYEES: InactiveEmployee[] = [
  { employeeId: 'E005', name: 'Ramírez Torres, Sofía', sessionCount: 12 },
  { employeeId: 'E008', name: 'Vásquez Méndez, Juan Pablo', sessionCount: 8 },
];

// ── Absent employees ─────────────────────────────────────────────────

export const ABSENT_EMPLOYEES: AbsentEmployee[] = [
  { employeeId: 'E007', name: 'Figueroa Mendoza, Laura', active: true },
  { employeeId: 'E009', name: 'Estrada Morán, Diego', active: true },
];

// ── Flagged sessions (one per flag type for verification screenshots) ─

const PERIOD: TasPeriod = { anio: 2026, mes: 6, numeroDequincena: 1 };
const PERIOD_2: TasPeriod = { anio: 2026, mes: 6, numeroDequincena: 2 };

export const AVAILABLE_PERIODS: TasPeriod[] = [PERIOD, PERIOD_2];

export const FLAGGED_MISSING_ENTRY: TasSession = {
  sessionId: 1, employeeId: 'E001', employeeName: 'García López, María Elena',
  date: '2026-06-03', scans: ['2026-06-03T13:45:00'],
  matchedShiftId: 'shift-1', matchedShiftName: 'Mañana',
  assignedShiftId: 'shift-1', assignedShiftName: 'Mañana',
  effectiveStart: null, lastScan: '2026-06-03T13:45:00',
  workedMinutes: 0, workedHours: 0, needsResolution: true,
  flags: ['MISSING_ENTRY'],
};

export const FLAGGED_MISSING_EXIT: TasSession = {
  sessionId: 2, employeeId: 'E002', employeeName: 'Hernández Ruiz, Carlos Alberto',
  date: '2026-06-04', scans: ['2026-06-04T06:02:00'],
  matchedShiftId: 'shift-1', matchedShiftName: 'Mañana',
  assignedShiftId: 'shift-1', assignedShiftName: 'Mañana',
  effectiveStart: '2026-06-04T06:02:00', lastScan: null,
  workedMinutes: 0, workedHours: 0, needsResolution: true,
  flags: ['MISSING_EXIT'],
};

export const FLAGGED_SHIFT_MISMATCH: TasSession = {
  sessionId: 3, employeeId: 'E003', employeeName: 'Morales Pérez, Ana Lucía',
  date: '2026-06-05', scans: ['2026-06-05T06:05:00', '2026-06-05T14:10:00'],
  matchedShiftId: 'shift-1', matchedShiftName: 'Mañana',
  assignedShiftId: 'shift-2', assignedShiftName: 'Tarde',
  effectiveStart: '2026-06-05T06:05:00', lastScan: '2026-06-05T14:10:00',
  workedMinutes: 480, workedHours: 8, needsResolution: true,
  flags: ['SHIFT_MISMATCH'],
};

export const FLAGGED_SAME_DAY_DOUBLE_A: TasSession = {
  sessionId: 4, employeeId: 'E004', employeeName: 'López Castillo, Pedro José',
  date: '2026-06-06', scans: ['2026-06-06T06:00:00', '2026-06-06T10:00:00'],
  matchedShiftId: 'shift-1', matchedShiftName: 'Mañana',
  assignedShiftId: 'shift-2', assignedShiftName: 'Tarde',
  effectiveStart: '2026-06-06T06:00:00', lastScan: '2026-06-06T10:00:00',
  workedMinutes: 240, workedHours: 4, needsResolution: true,
  flags: ['SAME_DAY_DOUBLE'],
};

export const FLAGGED_SAME_DAY_DOUBLE_B: TasSession = {
  sessionId: 5, employeeId: 'E004', employeeName: 'López Castillo, Pedro José',
  date: '2026-06-06', scans: ['2026-06-06T14:00:00', '2026-06-06T22:00:00'],
  matchedShiftId: 'shift-2', matchedShiftName: 'Tarde',
  assignedShiftId: 'shift-2', assignedShiftName: 'Tarde',
  effectiveStart: '2026-06-06T14:00:00', lastScan: '2026-06-06T22:00:00',
  workedMinutes: 480, workedHours: 8, needsResolution: true,
  flags: ['SAME_DAY_DOUBLE'],
};

export const FLAGGED_SHORT_DAY: TasSession = {
  sessionId: 6, employeeId: 'E001', employeeName: 'García López, María Elena',
  date: '2026-06-07', scans: ['2026-06-07T06:00:00', '2026-06-07T10:30:00'],
  matchedShiftId: 'shift-1', matchedShiftName: 'Mañana',
  assignedShiftId: 'shift-1', assignedShiftName: 'Mañana',
  effectiveStart: '2026-06-07T06:00:00', lastScan: '2026-06-07T10:30:00',
  workedMinutes: 270, workedHours: 4.5, needsResolution: false,
  flags: ['SHORT_DAY'],
};

export const FLAGGED_START_CUTOFF: TasSession = {
  sessionId: 7, employeeId: 'E006', employeeName: 'Castañeda Vega, Roberto',
  date: '2026-06-01', scans: ['2026-06-01T06:00:00', '2026-06-01T14:00:00'],
  matchedShiftId: 'shift-1', matchedShiftName: 'Mañana',
  assignedShiftId: 'shift-1', assignedShiftName: 'Mañana',
  effectiveStart: '2026-06-01T06:00:00', lastScan: '2026-06-01T14:00:00',
  workedMinutes: 480, workedHours: 8, needsResolution: true,
  flags: ['START_CUTOFF'],
};

export const FLAGGED_BEST_FIT: TasSession = {
  sessionId: 8, employeeId: 'E002', employeeName: 'Hernández Ruiz, Carlos Alberto',
  date: '2026-06-08', scans: ['2026-06-08T10:15:00', '2026-06-08T18:20:00'],
  matchedShiftId: 'shift-1', matchedShiftName: 'Mañana',
  assignedShiftId: 'shift-1', assignedShiftName: 'Mañana',
  effectiveStart: '2026-06-08T10:15:00', lastScan: '2026-06-08T18:20:00',
  workedMinutes: 480, workedHours: 8, needsResolution: false,
  flags: ['BEST_FIT_SHIFT'],
};

// All flagged sessions combined for verification screen
export const ALL_FLAGGED_SESSIONS: TasSession[] = [
  FLAGGED_MISSING_ENTRY,
  FLAGGED_MISSING_EXIT,
  FLAGGED_SHIFT_MISMATCH,
  FLAGGED_SAME_DAY_DOUBLE_A,
  FLAGGED_SAME_DAY_DOUBLE_B,
  FLAGGED_SHORT_DAY,
  FLAGGED_START_CUTOFF,
  FLAGGED_BEST_FIT,
];

// ── Resolved rows for review screen ──────────────────────────────────

export const RESOLVED_ROWS: ResolvedRow[] = [
  { codigoEmpleado: 'E001', nombreEmpleado: 'García López, María Elena', diasNoLaborados: 1, horasExtrasSimples: 4, horasExtrasDobles: 2, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 1, accruesOvertime: true },
  { codigoEmpleado: 'E002', nombreEmpleado: 'Hernández Ruiz, Carlos Alberto', diasNoLaborados: 0, horasExtrasSimples: 6, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
  { codigoEmpleado: 'E003', nombreEmpleado: 'Morales Pérez, Ana Lucía', diasNoLaborados: 2, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: false },
  { codigoEmpleado: 'E004', nombreEmpleado: 'López Castillo, Pedro José', diasNoLaborados: 0, horasExtrasSimples: 8, horasExtrasDobles: 3, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
  { codigoEmpleado: 'E006', nombreEmpleado: 'Castañeda Vega, Roberto', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 2, accruesOvertime: true },
];

export const SESSION_SUMMARIES: Record<string, SessionSummary[]> = {
  'E001': [
    { date: '2026-06-02', shiftName: 'Mañana', entryTime: '2026-06-02T06:02:00', exitTime: '2026-06-02T14:05:00', workedHours: 8, simplesMinutes: 0, doblesMinutes: 0, scans: ['2026-06-02T06:02:00', '2026-06-02T10:15:00', '2026-06-02T14:05:00'], estimatedShift: false },
    { date: '2026-06-03', shiftName: 'Mañana', entryTime: '2026-06-03T05:55:00', exitTime: '2026-06-03T16:10:00', workedHours: 10, simplesMinutes: 120, doblesMinutes: 0, scans: ['2026-06-03T05:55:00', '2026-06-03T16:10:00'], estimatedShift: false },
    { date: '2026-06-04', shiftName: 'Mañana', entryTime: '2026-06-04T06:00:00', exitTime: '2026-06-04T14:00:00', workedHours: 8, simplesMinutes: 0, doblesMinutes: 0, scans: ['2026-06-04T06:00:00', '2026-06-04T14:00:00'], estimatedShift: false },
    { date: '2026-06-05', shiftName: 'Mañana', entryTime: '2026-06-05T10:20:00', exitTime: '2026-06-05T18:30:00', workedHours: 8, simplesMinutes: 0, doblesMinutes: 0, scans: ['2026-06-05T10:20:00', '2026-06-05T18:30:00'], estimatedShift: true },
    { date: '2026-06-06', shiftName: 'Mañana', entryTime: '2026-06-06T06:00:00', exitTime: '2026-06-06T18:00:00', workedHours: 12, simplesMinutes: 120, doblesMinutes: 120, scans: ['2026-06-06T06:00:00', '2026-06-06T10:00:00', '2026-06-06T10:30:00', '2026-06-06T18:00:00'], estimatedShift: false },
  ],
  'E002': [
    { date: '2026-06-02', shiftName: 'Mañana', entryTime: '2026-06-02T06:00:00', exitTime: '2026-06-02T14:00:00', workedHours: 8, simplesMinutes: 0, doblesMinutes: 0, scans: ['2026-06-02T06:00:00', '2026-06-02T14:00:00'], estimatedShift: false },
    { date: '2026-06-03', shiftName: 'Mañana', entryTime: '2026-06-03T06:00:00', exitTime: '2026-06-03T17:00:00', workedHours: 11, simplesMinutes: 180, doblesMinutes: 0, scans: ['2026-06-03T06:00:00', '2026-06-03T17:00:00'], estimatedShift: false },
    { date: '2026-06-04', shiftName: 'Mañana', entryTime: '2026-06-04T06:00:00', exitTime: '2026-06-04T17:00:00', workedHours: 11, simplesMinutes: 180, doblesMinutes: 0, scans: ['2026-06-04T06:00:00', '2026-06-04T17:00:00'], estimatedShift: false },
  ],
};

// ── Upload result variants ───────────────────────────────────────────

export const UPLOAD_RESULT_WITH_INACTIVE: TasUploadResult = {
  uploadToken: 'mock-token-001',
  flaggedSessions: ALL_FLAGGED_SESSIONS,
  inactiveEmployeesFound: INACTIVE_EMPLOYEES,
  absentActiveEmployees: ABSENT_EMPLOYEES,
  usedFallbackHolidays: false,
  warnings: [],
  availablePeriods: [PERIOD],
  availableShifts: SHIFT_OPTIONS,
  sessionSummaries: SESSION_SUMMARIES,
};

export const UPLOAD_RESULT_WITH_FLAGS: TasUploadResult = {
  uploadToken: 'mock-token-002',
  flaggedSessions: ALL_FLAGGED_SESSIONS,
  resolvedRows: RESOLVED_ROWS,
  inactiveEmployeesFound: [],
  absentActiveEmployees: ABSENT_EMPLOYEES,
  usedFallbackHolidays: false,
  warnings: ['Se utilizaron feriados almacenados localmente porque no se pudo conectar al servicio de feriados.'],
  availablePeriods: AVAILABLE_PERIODS,
  availableShifts: SHIFT_OPTIONS,
  sessionSummaries: SESSION_SUMMARIES,
};

export const RESOLVE_RESULT_TO_REVIEW: TasResolveResult = {
  uploadToken: 'mock-token-003',
  resolvedRows: RESOLVED_ROWS,
  flaggedSessions: ALL_FLAGGED_SESSIONS.map(s => ({ ...s, needsResolution: false })),
  usedFallbackHolidays: false,
  availablePeriods: [PERIOD],
  availableShifts: SHIFT_OPTIONS,
  sessionSummaries: SESSION_SUMMARIES,
};

// ── Job status variants ──────────────────────────────────────────────

export const JOB_STATUS_SUCCESS: JobStatus = {
  jobId: 'job-001', status: 'DONE', totalRows: 5, submitted: 5, skipped: 0, failed: 0,
  attemptNumber: 1, maxRetries: 3, failedRows: [],
};

export const JOB_STATUS_PARTIAL: JobStatus = {
  jobId: 'job-002', status: 'DONE_WITH_ERRORS', totalRows: 5, submitted: 3, skipped: 0, failed: 2,
  attemptNumber: 1, maxRetries: 3,
  failedRows: [
    { codigoEmpleado: 'E003', nombreEmpleado: 'Morales Pérez, Ana Lucía', error: 'Timeout al conectar con la base de datos' },
    { codigoEmpleado: 'E004', nombreEmpleado: 'López Castillo, Pedro José', error: 'Error de constraint: código duplicado' },
  ],
};

export const JOB_STATUS_RETRIES_EXHAUSTED: JobStatus = {
  jobId: 'job-003', status: 'DONE_WITH_ERRORS', totalRows: 5, submitted: 3, skipped: 0, failed: 2,
  attemptNumber: 4, maxRetries: 3,
  failedRows: [
    { codigoEmpleado: 'E003', nombreEmpleado: 'Morales Pérez, Ana Lucía', error: 'Timeout al conectar con la base de datos' },
    { codigoEmpleado: 'E004', nombreEmpleado: 'López Castillo, Pedro José', error: 'Error de constraint: código duplicado' },
  ],
};

export const JOB_STATUS_IN_PROGRESS: JobStatus = {
  jobId: 'job-004', status: 'IN_PROGRESS', totalRows: 5, submitted: 2, skipped: 0, failed: 0,
  attemptNumber: 1, maxRetries: 3, failedRows: [],
};
