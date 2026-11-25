import { describe, it, expect } from 'vitest';
import { buildReport, estimatePages, formatClock, formatDay, formatHours, halfHours, type ReportInput } from './reviewReport';
import { approvedDecision, type OvertimeDecision } from '../../overtime';
import type { ResolvedRow, SessionSummary } from '../../tasTypes';

const row = (over: Partial<ResolvedRow>): ResolvedRow => ({
  codigoEmpleado: '1', nombreEmpleado: 'Ana', diasNoLaborados: 0, fechasNoLaboradas: [],
  horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 11, anio: 2026, numeroDequincena: 1,
  diasTurnoEstimado: 0, accruesOvertime: true, ...over,
});

const day = (date: string, simplesMinutes: number, doblesMinutes = 0): SessionSummary => ({
  date, shiftName: 'Mañana', entryTime: `${date}T07:00:00`, exitTime: `${date}T15:00:00`,
  workedHours: 8, simplesMinutes, doblesMinutes, scans: [`${date}T07:00`, `${date}T15:00`],
});

// Every row approved unless the test decides otherwise, so a test about the days reads what was calculated.
const input = (over: Partial<ReportInput>): ReportInput => ({
  rows: [], sessionSummaries: {}, nonWorkedDaysOverrides: {}, duplicateCodes: [], absentEmployees: [], ...over,
  overtimeDecisions: {
    ...Object.fromEntries((over.rows ?? []).map(r => [r.codigoEmpleado, approvedDecision(r)])),
    ...over.overtimeDecisions,
  },
});

const adjusted = (simples: number, dobles: number, calcSimples: number, calcDobles: number): OvertimeDecision =>
  ({ kind: 'adjusted', simples, dobles, calcSimples, calcDobles });

describe('halfHours', () => {
  it.each([[0, 0], [29, 0], [30, 0.5], [59, 0.5], [60, 1], [95, 1.5]])('%i min → %f h', (min, h) => {
    expect(halfHours(min)).toBe(h);
  });
});

describe('formatting', () => {
  it('prints hours with two decimals', () => {
    expect(formatHours(41.5)).toBe('41.50');
    expect(formatHours(0)).toBe('0.00');
  });

  it('prints the weekday and day/month of an ISO date', () => {
    expect(formatDay('2026-11-02')).toBe('lun 02/11');
    expect(formatDay('2026-11-08')).toBe('dom 08/11');
  });

  it('marks a clock time on the following day', () => {
    expect(formatClock('2026-11-02T22:00:00', '2026-11-02')).toBe('22:00');
    expect(formatClock('2026-11-03T06:00:00', '2026-11-02')).toBe('06:00 (+1)');
    expect(formatClock('07:15:00', '2026-11-02')).toBe('07:15');
    expect(formatClock(null, '2026-11-02')).toBe('—');
  });
});

describe('buildReport', () => {
  it('sorts employees by code numerically, not as text', () => {
    const report = buildReport(input({ rows: [row({ codigoEmpleado: '101' }), row({ codigoEmpleado: '3' }), row({ codigoEmpleado: '20' })] }));
    expect(report.employees.map(e => e.code)).toEqual(['3', '20', '101']);
  });

  it('interleaves the absent dates with the worked days in date order', () => {
    const report = buildReport(input({
      rows: [row({ diasNoLaborados: 1, fechasNoLaboradas: ['2026-11-03'] })],
      sessionSummaries: { '1': [day('2026-11-02', 0), day('2026-11-04', 0)] },
    }));
    expect(report.employees[0].days.map(d => [d.date, d.session === null])).toEqual([
      ['2026-11-02', false], ['2026-11-03', true], ['2026-11-04', false],
    ]);
  });

  it('sums each day cut to half hours, matching the backend total', () => {
    const report = buildReport(input({
      rows: [row({ horasExtrasSimples: 1.5, horasExtrasDobles: 1 })],
      sessionSummaries: { '1': [day('2026-11-02', 59, 0), day('2026-11-03', 61, 60)] },
    }));
    const e = report.employees[0];
    expect(e.days.map(d => d.simples)).toEqual([0.5, 1]);
    expect(e.simples).toEqual({ sumOfDays: 1.5, calculated: 1.5, final: 1.5 });
    expect(e.dobles).toEqual({ sumOfDays: 1, calculated: 1, final: 1 });
    expect(e.mismatch).toBe(false);
    expect(e.notes).toEqual([]);
  });

  it('sends the manual adjustments and says what was calculated', () => {
    const report = buildReport(input({
      rows: [row({ horasExtrasSimples: 2, horasExtrasDobles: 1, diasNoLaborados: 1, fechasNoLaboradas: ['2026-11-03'] })],
      sessionSummaries: { '1': [day('2026-11-02', 120, 60)] },
      overtimeDecisions: { '1': adjusted(3, 0, 2, 1) },
      nonWorkedDaysOverrides: { '1': 0 },
    }));
    const e = report.employees[0];
    expect([e.diasFinal, e.simples.final, e.dobles.final]).toEqual([0, 3, 0]);
    expect(e.overtimeStatus).toBe('adjusted');
    expect(e.notes).toEqual([
      'Días no laborados ajustados a mano (calculado: 1)',
      'Extras simples ajustadas a mano (calculado: 2.00)',
      'Extras dobles ajustadas a mano (calculado: 1.00)',
    ]);
    expect(e.mismatch).toBe(false);
  });

  it('expects zero overtime from an employee who does not accrue it', () => {
    const report = buildReport(input({
      rows: [row({ accruesOvertime: false, diasTurnoEstimado: 1 })],
      sessionSummaries: { '1': [day('2026-11-02', 120)] },
    }));
    const e = report.employees[0];
    expect(e.simples).toEqual({ sumOfDays: 2, calculated: 0, final: 0 });
    expect(e.mismatch).toBe(false);
    expect(e.notes).toEqual(['No acumula horas extra: se envían en cero', '1 día con turno estimado']);
  });

  it('pluralizes estimated days', () => {
    const report = buildReport(input({ rows: [row({ diasTurnoEstimado: 2 })] }));
    expect(report.employees[0].notes).toEqual(['2 días con turno estimado']);
  });

  it.each([
    ['the days do not add up to the overtime', { horasExtrasSimples: 5 }],
    ['the dobles do not add up', { horasExtrasDobles: 1 }],
    ['the absent dates do not match the count', { diasNoLaborados: 2 }],
  ])('flags a row where %s', (_, over) => {
    const report = buildReport(input({ rows: [row(over)], sessionSummaries: { '1': [day('2026-11-02', 0)] } }));
    expect(report.employees[0].mismatch).toBe(true);
  });

  it('leaves duplicates out of the employees and totals and lists them apart', () => {
    const report = buildReport(input({
      rows: [
        row({ codigoEmpleado: '2', nombreEmpleado: 'Bea', horasExtrasSimples: 1, diasNoLaborados: 1, fechasNoLaboradas: ['2026-11-03'] }),
        row({ codigoEmpleado: '10', nombreEmpleado: 'Dup', horasExtrasSimples: 9 }),
        row({ codigoEmpleado: '1', nombreEmpleado: 'Ana', horasExtrasDobles: 0.5, diasNoLaborados: 2, fechasNoLaboradas: ['2026-11-03', '2026-11-04'] }),
      ],
      sessionSummaries: { '2': [day('2026-11-02', 60)], '1': [day('2026-11-02', 0, 30)] },
      overtimeDecisions: { '1': adjusted(0.5, 0.5, 0, 0.5) },
      duplicateCodes: ['10'],
    }));
    expect(report.employees.map(e => e.code)).toEqual(['1', '2']);
    expect(report.excluded).toEqual([{ code: '10', name: 'Dup' }]);
    expect(report.totals).toEqual({ dias: 3, simples: 1.5, dobles: 0.5 });
  });

  it('handles an employee with no session summaries', () => {
    const report = buildReport(input({ rows: [row({ diasNoLaborados: 1, fechasNoLaboradas: ['2026-11-02'] })] }));
    expect(report.employees[0].days).toEqual([{ date: '2026-11-02', session: null, discarded: false, simples: 0, dobles: 0 }]);
    expect(report.employees[0].workedDates).toBe(0);
  });

  it('sends zero overtime for an employee who does not accrue it, whatever override is stored, as submit does', () => {
    const report = buildReport(input({
      rows: [row({ accruesOvertime: false, diasNoLaborados: 1, fechasNoLaboradas: ['2026-11-03'] })],
      sessionSummaries: { '1': [day('2026-11-02', 120, 60)] },
      overtimeDecisions: { '1': adjusted(3, 2, 0, 0) },
      nonWorkedDaysOverrides: { '1': 0 },
    }));
    const e = report.employees[0];
    expect([e.simples.final, e.dobles.final, e.diasFinal]).toEqual([0, 0, 0]);
    expect(e.notes).toEqual(['Días no laborados ajustados a mano (calculado: 1)', 'No acumula horas extra: se envían en cero']);
    expect(report.totals).toEqual({ dias: 0, simples: 0, dobles: 0 });
  });

  it('counts a date once and leaves a discarded same-day session out of the days worked', () => {
    const kept = day('2026-11-02', 60);
    const discarded = { ...day('2026-11-02', 0), discarded: true };
    const both = [day('2026-11-03', 0), day('2026-11-03', 30)];
    const report = buildReport(input({
      rows: [row({ horasExtrasSimples: 1.5 })],
      sessionSummaries: { '1': [kept, discarded, ...both] },
    }));
    const e = report.employees[0];
    expect(e.days.map(d => d.discarded)).toEqual([false, true, false, false]);
    expect(e.workedDates).toBe(2);
    expect(e.simples.sumOfDays).toBe(1.5);
    expect(e.mismatch).toBe(false);
  });

  it('sends overtime nobody approved as zero and says what was calculated', () => {
    const report = buildReport({
      ...input({ rows: [row({ horasExtrasSimples: 1, horasExtrasDobles: 0.5 })], sessionSummaries: { '1': [day('2026-11-02', 60, 30)] } }),
      overtimeDecisions: {},
    });
    const e = report.employees[0];
    expect([e.simples.final, e.dobles.final, e.overtimeStatus]).toEqual([0, 0, 'pending']);
    expect(e.mismatch).toBe(false);
    expect(e.notes).toEqual(['Horas extra sin aprobar: se envían en cero (calculado: 1.00 simples, 0.50 dobles)']);
    expect(report.totals).toEqual({ dias: 0, simples: 0, dobles: 0 });
  });

  it('sends zero when the calculation changed after it was approved', () => {
    const report = buildReport(input({
      rows: [row({ horasExtrasSimples: 12 })],
      overtimeDecisions: { '1': { kind: 'approved', simples: 3.5, dobles: 0, calcSimples: 3.5, calcDobles: 0 } },
    }));
    const e = report.employees[0];
    expect([e.simples.final, e.overtimeStatus]).toEqual([0, 'stale']);
    expect(e.notes).toEqual(['El cálculo cambió después de aprobarlas: se envían en cero (calculado ahora: 12.00 simples, 0.00 dobles)']);
  });

  it('keeps a hand adjustment when the calculation changed, and says so', () => {
    const report = buildReport(input({ rows: [row({ horasExtrasSimples: 4 })], overtimeDecisions: { '1': adjusted(2, 0, 3, 0) } }));
    const e = report.employees[0];
    expect(e.simples.final).toBe(2);
    expect(e.notes).toEqual(['Extras simples ajustadas a mano (calculado: 4.00)', 'El cálculo cambió después del ajuste']);
  });

  it('lists active employees without punches, leaving out those marked inactive', () => {
    const report = buildReport(input({
      absentEmployees: [
        { employeeId: '50', name: 'Zoe' },
        { employeeId: '7', name: 'Leo', active: true },
        { employeeId: '9', name: 'Gone', active: false },
      ],
    }));
    expect(report.withoutScans).toEqual([{ code: '7', name: 'Leo' }, { code: '50', name: 'Zoe' }]);
  });
});

describe('estimatePages', () => {
  it.each([
    ['summary', 1, 1],
    ['summary', 34, 1],
    ['summary', 35, 2],
    ['summary', 42, 2],
    ['detail', 1, 2],
    ['detail', 42, 23],
  ] as const)('%s of %i employees ≈ %i pages', (mode, employees, pages) => {
    expect(estimatePages(mode, employees)).toBe(pages);
  });
});
