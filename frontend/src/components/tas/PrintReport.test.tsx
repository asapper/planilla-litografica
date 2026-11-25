import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PrintReport from './PrintReport';
import { buildReport, type ReportInput } from './reviewReport';
import { approvedDecision } from '../../overtime';
import type { IncompletePeriod, ResolvedRow, SessionSummary } from '../../tasTypes';

const row = (over: Partial<ResolvedRow>): ResolvedRow => ({
  codigoEmpleado: '1', nombreEmpleado: 'Ana', diasNoLaborados: 0, fechasNoLaboradas: [],
  horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 11, anio: 2026, numeroDequincena: 1,
  diasTurnoEstimado: 0, accruesOvertime: true, ...over,
});

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  date: '2026-11-02', shiftName: 'Mañana', entryTime: '2026-11-02T07:00:00', exitTime: '2026-11-02T16:00:00',
  workedHours: 9, simplesMinutes: 60, doblesMinutes: 0, scans: ['2026-11-02T07:00', '2026-11-02T16:00'], ...over,
});

const baseInput: ReportInput = {
  rows: [
    row({ codigoEmpleado: '3', nombreEmpleado: 'JOSE DIEGUEZ', horasExtrasSimples: 1, diasNoLaborados: 1, fechasNoLaboradas: ['2026-11-03'] }),
    row({ codigoEmpleado: '16', nombreEmpleado: 'ARGELIA HERNANDEZ', accruesOvertime: false, diasTurnoEstimado: 1 }),
  ],
  sessionSummaries: {
    '3': [session({})],
    '16': [session({
      date: '2026-11-02', shiftName: 'Noche', entryTime: '2026-11-02T22:00:00', exitTime: '2026-11-03T06:00:00',
      scans: ['2026-11-02T22:00', '2026-11-03T06:00'], estimatedShift: true, breakDeductionMinutes: 15, simplesMinutes: 90,
    })],
  },
  overtimeDecisions: {},
  nonWorkedDaysOverrides: {},
  duplicateCodes: [],
  absentEmployees: [],
};

// Every row approved unless the test decides otherwise.
function decisionsFor(input: Partial<ReportInput> = {}) {
  return input.overtimeDecisions ?? Object.fromEntries((input.rows ?? baseInput.rows).map(r => [r.codigoEmpleado, approvedDecision(r)]));
}

function renderReport(opts: {
  input?: Partial<ReportInput>; mode?: 'summary' | 'detail'; incomplete?: IncompletePeriod[]; fallback?: boolean; period?: null; unverified?: boolean;
} = {}) {
  return render(
    <PrintReport
      report={buildReport({ ...baseInput, ...opts.input, overtimeDecisions: decisionsFor(opts.input) })}
      mode={opts.mode ?? 'detail'}
      period={opts.period === null ? null : { anio: 2026, mes: 11, numeroDequincena: 1 }}
      generatedAt={new Date(2026, 10, 24, 9, 5)}
      incompletePeriods={opts.incomplete ?? []}
      coverageUnverified={opts.unverified ?? false}
      usedFallbackHolidays={opts.fallback ?? false}
    />,
  );
}

describe('PrintReport', () => {
  it('renders into document.body, outside the app root', () => {
    renderReport();
    expect(screen.getByTestId('print-report').parentElement).toBe(document.body);
  });

  it('heads the report with the period range and generation time', () => {
    renderReport();
    expect(screen.getByText('Noviembre 2026 · Quincena 1 (del 1 al 15)')).toBeInTheDocument();
    expect(screen.getByText('Generado: 24/11/2026 09:05')).toBeInTheDocument();
    expect(screen.getByText('2 a enviar')).toBeInTheDocument();
  });

  it('gives the second fortnight its real last day', () => {
    render(
      <PrintReport report={buildReport(baseInput)} mode="summary" period={{ anio: 2028, mes: 2, numeroDequincena: 2 }}
        generatedAt={new Date()} incompletePeriods={[]} coverageUnverified={false} usedFallbackHolidays={false} />,
    );
    expect(screen.getByText('Febrero 2028 · Quincena 2 (del 16 al 29)')).toBeInTheDocument();
  });

  it('says when no period is selected', () => {
    renderReport({ period: null });
    expect(screen.getByText('Sin quincena seleccionada')).toBeInTheDocument();
  });

  it('lists every employee by code with what will be sent and a total row', () => {
    renderReport({ mode: 'summary' });
    const table = screen.getAllByRole('table')[0];
    const rows = within(table).getAllByRole('row');
    expect(rows.map(r => r.textContent)).toEqual([
      'CódigoNombreDías no laboradosExtras simplesExtras doblesObservaciones',
      '3JOSE DIEGUEZ11.000.00Aprobado',
      '16ARGELIA HERNANDEZ00.000.00No acumula extras · 1 turno est.',
      'Total · 2 empleados11.000.00',
    ]);
    expect(screen.queryByText('Detalle por empleado')).not.toBeInTheDocument();
  });

  it('marks adjusted rows in the summary', () => {
    renderReport({ mode: 'summary', input: { overtimeDecisions: { '3': { kind: 'adjusted', simples: 4, dobles: 0, calcSimples: 1, calcDobles: 0 } } } });
    expect(screen.getByText('Ajustado')).toBeInTheDocument();
    expect(screen.getByText('Total · 2 empleados').parentElement).toHaveTextContent('4.00');
  });

  it('flags a row that does not add up', () => {
    renderReport({ input: { rows: [row({ horasExtrasSimples: 7 })], sessionSummaries: { '1': [session({})] } } });
    expect(screen.getByText('Aprobado · ⚠ No cuadra')).toBeInTheDocument();
    expect(screen.getByText(/Los días no cuadran con el total calculado/)).toBeInTheDocument();
    expect(screen.getByText('Extras simples: los días suman 1.00, se envía 7.00 (no coincide con la suma de los días).')).toBeInTheDocument();
  });

  it('fades zeros and bolds the figures that matter', () => {
    renderReport({ mode: 'summary' });
    const first = within(screen.getAllByRole('table')[0]).getAllByRole('row')[1];
    expect(within(first).getByText('1.00')).toHaveClass('pr-nonzero');
    expect(within(first).getByText('0.00')).toHaveClass('pr-zero');
  });

  it('lists excluded duplicates apart from the employees sent', () => {
    renderReport({ mode: 'summary', input: { duplicateCodes: ['16'] } });
    expect(screen.getByText('1 a enviar · 1 excluido')).toBeInTheDocument();
    expect(screen.getByText('16 ARGELIA HERNANDEZ')).toBeInTheDocument();
    expect(screen.getByText('Total · 1 empleado')).toBeInTheDocument();
  });

  it('warns about an incomplete fortnight and fallback holidays', () => {
    renderReport({
      fallback: true,
      incomplete: [{ anio: 2026, mes: 11, numeroDequincena: 1, periodStart: '2026-11-01', periodEnd: '2026-11-15', dataStart: '2026-11-01', dataEnd: '2026-11-13', missingWorkingDays: ['2026-11-14'] }],
    });
    expect(screen.getByText(/Quincena incompleta: el archivo no tiene marcaciones del 14 de noviembre/)).toBeInTheDocument();
    expect(screen.getByText(/Feriados tomados de la lista guardada/)).toBeInTheDocument();
  });

  it('shows each day, the absences in place, and the sums per employee', () => {
    renderReport();
    const ana = screen.getByRole('region', { name: 'Detalle 3 JOSE DIEGUEZ' });
    const rows = within(ana).getAllByRole('row').map(r => r.textContent);
    expect(rows).toEqual([
      'FechaTurnoEntradaSalidaMarcacionesHoras trab.SimplesDobles',
      'lun 02/11Mañana07:0016:0007:00 · 16:009.001.000.00',
      'mar 03/11No laboró——',
      'Suma de los días (1 día trabajado)9.001.000.00',
    ]);
    expect(within(ana).getByText('Días no laborados (1): mar 03/11.')).toBeInTheDocument();
  });

  it('explains the night, the estimated shift, the lunch deduction and the zeroed overtime', () => {
    renderReport();
    const argelia = screen.getByRole('region', { name: 'Detalle 16 ARGELIA HERNANDEZ' });
    expect(within(argelia).getByText('06:00 (+1)')).toBeInTheDocument();
    expect(within(argelia).getByText('22:00 · 06:00 (+1)')).toBeInTheDocument();
    expect(within(argelia).getByText('turno estimado')).toBeInTheDocument();
    expect(within(argelia).getByText('almuerzo −15 min')).toBeInTheDocument();
    expect(within(argelia).getByText('Sin días no laborados.')).toBeInTheDocument();
    expect(within(argelia).getByText('Extras simples: los días suman 1.50, se envía 0.00 (no acumula horas extra).')).toBeInTheDocument();
    expect(within(argelia).getByText(/1 día con turno estimado: las marcaciones/)).toBeInTheDocument();
  });

  it('marks a day with a single scan', () => {
    renderReport({ input: { sessionSummaries: { ...baseInput.sessionSummaries, '3': [session({ exitTime: null, scans: ['2026-11-02T07:00'], workedHours: 0, simplesMinutes: 0, incomplete: true })] } } });
    const jose = screen.getByRole('region', { name: 'Detalle 3 JOSE DIEGUEZ' });
    expect(within(jose).getByText('marcación incompleta: sin horas extra')).toBeInTheDocument();
  });

  it('says what was adjusted by hand in the detail', () => {
    renderReport({ input: { overtimeDecisions: { '3': { kind: 'adjusted', simples: 1, dobles: 2, calcSimples: 1, calcDobles: 0 } }, nonWorkedDaysOverrides: { '3': 0 } } });
    const ana = screen.getByRole('region', { name: 'Detalle 3 JOSE DIEGUEZ' });
    expect(within(ana).getByText('Días no laborados (1): mar 03/11. Se envía 0 (ajustado a mano).')).toBeInTheDocument();
    expect(within(ana).getByText('Extras dobles: los días suman 0.00, se envía 2.00 (ajustado a mano).')).toBeInTheDocument();
  });

  it('pluralizes estimated days and worked days, and handles an employee without sessions', () => {
    renderReport({
      input: {
        rows: [row({ diasTurnoEstimado: 2, horasExtrasSimples: 2 }), row({ codigoEmpleado: '9', nombreEmpleado: 'Sin' })],
        sessionSummaries: { '1': [session({ shiftName: null, scans: undefined as unknown as string[] }), session({ date: '2026-11-03' })] },
      },
    });
    const ana = screen.getByRole('region', { name: 'Detalle 1 Ana' });
    expect(within(ana).getByText('Suma de los días (2 días trabajados)')).toBeInTheDocument();
    expect(within(ana).getByText(/2 días con turno estimado/)).toBeInTheDocument();
    expect(within(ana).getAllByRole('row')[1].textContent).toContain('lun 02/11—07:00');
    const sin = screen.getByRole('region', { name: 'Detalle 9 Sin' });
    expect(within(sin).getByText('Sin sesiones en la quincena.')).toBeInTheDocument();
  });

  it('names a discarded same-day session instead of counting it as a day worked', () => {
    renderReport({
      input: {
        rows: [row({ horasExtrasSimples: 1 })],
        sessionSummaries: { '1': [session({}), session({ simplesMinutes: 0, workedHours: 0, discarded: true })] },
      },
    });
    const ana = screen.getByRole('region', { name: 'Detalle 1 Ana' });
    expect(within(ana).getByText('descartada (doble jornada)').closest('tr')).toHaveClass('pr-discarded-row');
    expect(within(ana).getByText('Suma de los días (1 día trabajado)')).toBeInTheDocument();
  });

  it('says in the summary and the detail which overtime goes as zero for lack of approval', () => {
    renderReport({ input: { overtimeDecisions: {} } });
    expect(screen.getByText('Sin aprobar · calc. 1.00 / 0.00')).toBeInTheDocument();
    const jose = screen.getByRole('region', { name: 'Detalle 3 JOSE DIEGUEZ' });
    expect(within(jose).getByText('Extras simples: los días suman 1.00, se envía 0.00 (sin aprobar).')).toBeInTheDocument();
  });

  it('marks an approval the calculation no longer matches', () => {
    renderReport({ mode: 'summary', input: { overtimeDecisions: { '3': { kind: 'approved', simples: 3, dobles: 0, calcSimples: 3, calcDobles: 0 } } } });
    expect(screen.getByText('Cálculo cambió · calc. 1.00 / 0.00')).toBeInTheDocument();
  });

  it('warns when the fortnight coverage could not be checked', () => {
    renderReport({ unverified: true });
    expect(screen.getByText(/No se pudo verificar que el archivo cubra la quincena completa/)).toBeInTheDocument();
  });

  it('lists the active employees with no punches, who are not sent', () => {
    renderReport({ mode: 'summary', input: { absentEmployees: [{ employeeId: '77', name: 'PEDRO SIN MARCAS' }] } });
    expect(screen.getByText('Activos sin marcaciones en el archivo · no se envían')).toBeInTheDocument();
    expect(screen.getByText('77 PEDRO SIN MARCAS')).toBeInTheDocument();
  });

  it('explains how the detail adds up only when the detail is printed', () => {
    const { unmount } = renderReport({ mode: 'summary' });
    expect(screen.getByText('Las horas extra sin aprobar se envían en cero. Los domingos y feriados no cuentan como días no laborados.')).toBeInTheDocument();
    expect(screen.queryByText(/suma de los días da lo que se envía/)).not.toBeInTheDocument();
    unmount();
    renderReport({ mode: 'detail' });
    expect(screen.getByText(/en el detalle, la suma de los días da lo que se envía, salvo los ajustes indicados/)).toBeInTheDocument();
  });
});
