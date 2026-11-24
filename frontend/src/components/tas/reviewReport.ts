import type { AbsentEmployee, ResolvedRow, SessionSummary } from '../../tasTypes';

export type PrintMode = 'summary' | 'detail';

export interface ReportDay {
  date: string;
  session: SessionSummary | null;
  discarded: boolean;
  simples: number;
  dobles: number;
}

export interface ReportFigure {
  sumOfDays: number;
  calculated: number;
  final: number;
}

export interface ReportEmployee {
  code: string;
  name: string;
  days: ReportDay[];
  workedDates: number;
  absentDates: string[];
  diasCalculated: number;
  diasFinal: number;
  simples: ReportFigure;
  dobles: ReportFigure;
  accruesOvertime: boolean;
  estimatedDays: number;
  notes: string[];
  mismatch: boolean;
}

export interface ReportTotals {
  dias: number;
  simples: number;
  dobles: number;
}

export interface Report {
  employees: ReportEmployee[];
  excluded: { code: string; name: string }[];
  withoutScans: { code: string; name: string }[];
  totals: ReportTotals;
}

export interface ReportInput {
  rows: ResolvedRow[];
  sessionSummaries: Record<string, SessionSummary[]>;
  overtimeOverrides: Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>;
  nonWorkedDaysOverrides: Record<string, number>;
  duplicateCodes: string[];
  absentEmployees: AbsentEmployee[];
}

// Same rule as the backend: each day is cut to whole half hours before summing.
export function halfHours(minutes: number): number {
  return Math.floor(minutes / 30) / 2;
}

const byCode = (a: { code: string }, b: { code: string }) =>
  a.code.localeCompare(b.code, 'es', { numeric: true });

const sum = (values: number[]) => values.reduce((acc, v) => acc + v, 0);

export function formatHours(value: number): string {
  return value.toFixed(2);
}

const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const weekday = DAY_NAMES[new Date(y, m - 1, d).getDay()];
  return `${weekday} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

// A night shift ends the next day; "(+1)" keeps that from reading as a typo.
export function formatClock(iso: string | null, sessionDate: string): string {
  if (!iso) return '—';
  const [datePart, timePart = ''] = iso.includes('T') ? iso.split('T') : [sessionDate, iso];
  const clock = timePart.slice(0, 5);
  return datePart > sessionDate ? `${clock} (+1)` : clock;
}

function buildEmployee(row: ResolvedRow, input: ReportInput): ReportEmployee {
  const sessions = input.sessionSummaries[row.codigoEmpleado] ?? [];
  const worked: ReportDay[] = sessions.map(s => ({
    date: s.date,
    session: s,
    discarded: s.discarded === true,
    simples: halfHours(s.simplesMinutes),
    dobles: halfHours(s.doblesMinutes),
  }));
  const absent: ReportDay[] = row.fechasNoLaboradas.map(date => ({ date, session: null, discarded: false, simples: 0, dobles: 0 }));
  const days = [...worked, ...absent].sort((a, b) => a.date.localeCompare(b.date));

  const override = input.overtimeOverrides[row.codigoEmpleado];
  const diasOverride = input.nonWorkedDaysOverrides[row.codigoEmpleado];
  const simplesSum = sum(worked.map(d => d.simples));
  const doblesSum = sum(worked.map(d => d.dobles));

  // Submit drops overtime overrides for an employee who does not accrue overtime.
  const simplesOverride = row.accruesOvertime ? override?.horasExtrasSimples : undefined;
  const doblesOverride = row.accruesOvertime ? override?.horasExtrasDobles : undefined;
  const simples = { sumOfDays: simplesSum, calculated: row.horasExtrasSimples, final: simplesOverride ?? row.horasExtrasSimples };
  const dobles = { sumOfDays: doblesSum, calculated: row.horasExtrasDobles, final: doblesOverride ?? row.horasExtrasDobles };
  const diasFinal = diasOverride ?? row.diasNoLaborados;

  const expectedSimples = row.accruesOvertime ? simplesSum : 0;
  const expectedDobles = row.accruesOvertime ? doblesSum : 0;
  const mismatch = row.fechasNoLaboradas.length !== row.diasNoLaborados
    || expectedSimples !== row.horasExtrasSimples
    || expectedDobles !== row.horasExtrasDobles;

  const notes: string[] = [];
  if (diasOverride !== undefined) notes.push(`Días no laborados ajustados a mano (calculado: ${row.diasNoLaborados})`);
  if (simplesOverride !== undefined) notes.push(`Extras simples ajustadas a mano (calculado: ${formatHours(row.horasExtrasSimples)})`);
  if (doblesOverride !== undefined) notes.push(`Extras dobles ajustadas a mano (calculado: ${formatHours(row.horasExtrasDobles)})`);
  if (!row.accruesOvertime) notes.push('No acumula horas extra: se envían en cero');
  if (row.diasTurnoEstimado > 0) notes.push(`${row.diasTurnoEstimado} ${row.diasTurnoEstimado === 1 ? 'día' : 'días'} con turno estimado`);

  return {
    code: row.codigoEmpleado,
    name: row.nombreEmpleado,
    days,
    workedDates: new Set(worked.filter(d => !d.discarded).map(d => d.date)).size,
    absentDates: row.fechasNoLaboradas,
    diasCalculated: row.diasNoLaborados,
    diasFinal,
    simples,
    dobles,
    accruesOvertime: row.accruesOvertime,
    estimatedDays: row.diasTurnoEstimado,
    notes,
    mismatch,
  };
}

export function buildReport(input: ReportInput): Report {
  const duplicates = new Set(input.duplicateCodes);
  const employees = input.rows
    .filter(r => !duplicates.has(r.codigoEmpleado))
    .map(r => buildEmployee(r, input))
    .sort(byCode);
  const excluded = input.rows
    .filter(r => duplicates.has(r.codigoEmpleado))
    .map(r => ({ code: r.codigoEmpleado, name: r.nombreEmpleado }))
    .sort(byCode);
  const withoutScans = input.absentEmployees
    .filter(e => e.active !== false)
    .map(e => ({ code: e.employeeId, name: e.name }))
    .sort(byCode);
  return {
    employees,
    excluded,
    withoutScans,
    totals: {
      dias: sum(employees.map(e => e.diasFinal)),
      simples: sum(employees.map(e => e.simples.final)),
      dobles: sum(employees.map(e => e.dobles.final)),
    },
  };
}

// Letter paper, measured: about 42 summary rows on a page once the header, total, excluded list and
// sign-off are counted as rows; two employees' fortnights on each detail page.
export function estimatePages(mode: PrintMode, employees: number): number {
  const summary = Math.ceil((employees + 8) / 42);
  return mode === 'summary' ? summary : summary + Math.ceil(employees / 2);
}
