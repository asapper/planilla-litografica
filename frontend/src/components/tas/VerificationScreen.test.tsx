import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VerificationScreen from './VerificationScreen';
import { useTasStore } from '../../tasStore';
import * as tasApi from '../../tasApi';
import type { TasSession, TasResolveResult, TasPeriod } from '../../tasTypes';

const DEFAULT_PERIOD: TasPeriod = { anio: 2026, mes: 3, numeroDequincena: 1 };

vi.mock('../../tasApi');

const mockResolveVerification = vi.mocked(tasApi.resolveVerification);
const mockSubmitTas = vi.mocked(tasApi.submitTas);

function makeSession(overrides: Partial<TasSession> = {}): TasSession {
  return {
    sessionId: 1,
    employeeId: 'E1',
    employeeName: 'Ana López',
    date: '2026-03-15',
    scans: [],
    matchedShiftId: 'S1',
    assignedShiftId: 'S1',
    assignedShiftName: 'Turno Mañana',
    effectiveStart: null,
    lastScan: null,
    workedMinutes: 0,
    workedHours: 0,
    needsResolution: true,
    flags: ['MISSING_ENTRY'],
    ...overrides,
  };
}

const mockResult: TasResolveResult = {
  uploadToken: 'tok-2',
  resolvedRows: [
    { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
    { codigoEmpleado: 'E2', nombreEmpleado: 'Luis', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
  ],
  flaggedSessions: [],
  usedFallbackHolidays: false,
};

beforeEach(() => {
  useTasStore.getState().resetTas();
  vi.clearAllMocks();
});

describe('toHHMM via flagLabel rendering', () => {
  it('extracts HH:MM from a full ISO datetime string', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ flags: ['MISSING_ENTRY'], lastScan: '2026-03-10T15:10:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText(/Salida 15:10/)).toBeInTheDocument();
  });

  it('extracts HH:MM from a plain HH:MM:SS string', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ flags: ['MISSING_ENTRY'], lastScan: '15:10:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText(/Salida 15:10/)).toBeInTheDocument();
  });

  it('returns empty string for null', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ flags: ['MISSING_ENTRY'], lastScan: null }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta entrada')).toBeInTheDocument();
  });
});

describe('VerificationScreen rendering', () => {
  it('renders the heading', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Verificación de marcaciones')).toBeInTheDocument();
  });

  it('renders a session card with employee name', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getAllByText('Ana López').length).toBeGreaterThan(0);
  });

  it('renders formatted date', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('15 mar 2026')).toBeInTheDocument();
  });

  it('renders flag badge', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta entrada')).toBeInTheDocument();
  });

  it('shows the existing exit time when entry is missing', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_ENTRY'], effectiveStart: null, lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta entrada · Salida 17:00')).toBeInTheDocument();
  });

  it('shows the existing entry time when exit is missing', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_EXIT'], effectiveStart: '08:00:00', lastScan: null })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta salida · Entrada 08:00')).toBeInTheDocument();
  });

  it('shows plain missing-entry label when neither scan is present', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_ENTRY'], effectiveStart: null, lastScan: null })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta entrada')).toBeInTheDocument();
  });

  it('renders unrelated flag labels unchanged', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['SHIFT_MISMATCH'], effectiveStart: '08:00:00', lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    expect(screen.getByText('Cambio de turno')).toBeInTheDocument();
  });

  it('renders scans as pills', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ scans: ['08:00:00', '17:00:00'] })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('08:00')).toBeInTheDocument();
    expect(screen.getByText('17:00')).toBeInTheDocument();
  });

  it('renders pending count badge when there are unresolved sessions', () => {
    useTasStore.getState().setFlaggedSessions([makeSession(), makeSession({ sessionId: 2, employeeId: 'E2', employeeName: 'Luis' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText(/2 por resolver/)).toBeInTheDocument();
  });

  it('does not render pending badge when count is 0', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    useTasStore.getState().setResolvedSession(1, { resolvedStart: '08:00', resolvedEnd: '17:00' });
    render(<VerificationScreen />);
    expect(screen.queryByText(/por resolver/)).not.toBeInTheDocument();
  });
});

describe('VerificationScreen time inputs', () => {
  it('disables Confirmar when required entry is empty', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_ENTRY'], effectiveStart: null })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    const confirm = screen.getByRole('button', { name: /confirmar/i });
    expect(confirm).toBeDisabled();
  });

  it('enables Confirmar when required fields are filled', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_ENTRY'], effectiveStart: null, lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    const entryInput = screen.getByLabelText('Entrada');
    fireEvent.change(entryInput, { target: { value: '08:00' } });
    const confirm = screen.getByRole('button', { name: /confirmar/i });
    expect(confirm).not.toBeDisabled();
  });

  it('collapses the employee group once its only session is confirmed', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ effectiveStart: '08:00:00', lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(screen.getByText('✓ Resuelto')).toBeInTheDocument();
    expect(screen.queryByText('Confirmado')).not.toBeInTheDocument();
  });

  it('shows hours preview when both fields are filled', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_ENTRY', 'MISSING_EXIT'], effectiveStart: null, lastScan: null })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    const entryInput = screen.getByLabelText('Entrada');
    const exitInput  = screen.getByLabelText('Salida');
    fireEvent.change(entryInput, { target: { value: '08:00' } });
    fireEvent.change(exitInput,  { target: { value: '17:00' } });
    expect(screen.getByText(/Horas calculadas: 9\.0h/)).toBeInTheDocument();
  });

  it('pre-fills entry from effectiveStart', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ effectiveStart: '08:30:00', lastScan: null, flags: ['MISSING_EXIT'] })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    const input = screen.getByLabelText('Entrada') as HTMLInputElement;
    expect(input.value).toBe('08:30');
  });

  it('pre-fills exit from lastScan', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ lastScan: '17:45:00', effectiveStart: null, flags: ['MISSING_ENTRY'] })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    const input = screen.getByLabelText('Salida') as HTMLInputElement;
    expect(input.value).toBe('17:45');
  });
});

describe('VerificationScreen submit', () => {
  it('Revisar button is disabled until all sessions confirmed', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /revisar/i })).toBeDisabled();
  });

  it('calls resolveVerification then advances to review without auto-submitting', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([makeSession({ effectiveStart: '08:00:00', lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));

    await waitFor(() => {
      expect(useTasStore.getState().tasView).toBe('review');
    });
    expect(mockResolveVerification).toHaveBeenCalledOnce();
    expect(mockSubmitTas).not.toHaveBeenCalled();
    expect(useTasStore.getState().resolvedRowCount).toBe(2);
    expect(useTasStore.getState().resolvedRows).toHaveLength(2);
  });

  it('sends full datetime (date + time) for resolved session entries', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, date: '2026-03-15', effectiveStart: '2026-03-15T08:00:00', lastScan: '2026-03-15T17:00:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));

    await waitFor(() => expect(mockResolveVerification).toHaveBeenCalledOnce());
    const [, payload] = mockResolveVerification.mock.calls[0];
    expect(payload).toContainEqual({
      sessionId: 1,
      resolvedStart: '2026-03-15 08:00',
      resolvedEnd: '2026-03-15 17:00',
    });
  });

  it('clears resolvedSessions and stays in verification when resolve returns more flagged sessions', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([makeSession({ effectiveStart: '08:00:00', lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    const secondRoundResult = {
      ...mockResult,
      uploadToken: 'tok-3',
      flaggedSessions: [makeSession({ sessionId: 2, employeeId: 'E2', employeeName: 'Luis', needsResolution: true })],
    };
    mockResolveVerification.mockResolvedValue(secondRoundResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));

    await waitFor(() => {
      expect(useTasStore.getState().flaggedSessions[0].sessionId).toBe(2);
    });
    expect(useTasStore.getState().resolvedSessions).toEqual({});
    expect(mockSubmitTas).not.toHaveBeenCalled();
  });

});

describe('VerificationScreen period selector', () => {
  const p1: TasPeriod = { anio: 2026, mes: 3, numeroDequincena: 1 };
  const p2: TasPeriod = { anio: 2026, mes: 3, numeroDequincena: 2 };

  it('does not render the period dropdown when there is only one period', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ date: '2026-03-10' })]);
    useTasStore.getState().setAvailablePeriods([p1]);
    render(<VerificationScreen />);
    expect(screen.queryByLabelText('Periodo')).not.toBeInTheDocument();
  });

  it('renders the period dropdown with both periods when there are multiple', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, date: '2026-03-10' }),
      makeSession({ sessionId: 2, date: '2026-03-20' }),
    ]);
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    render(<VerificationScreen />);
    const select = screen.getByLabelText('Periodo');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Marzo 2026 - Quincena 1')).toBeInTheDocument();
    expect(screen.getByText('Marzo 2026 - Quincena 2')).toBeInTheDocument();
  });

  it('filters sessions to the selected period', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeName: 'Ana López', date: '2026-03-10' }),
      makeSession({ sessionId: 2, employeeName: 'Luis Soto', date: '2026-03-20' }),
    ]);
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    render(<VerificationScreen />);
    expect(screen.getAllByText('Ana López').length).toBeGreaterThan(0);
    expect(screen.queryByText('Luis Soto')).not.toBeInTheDocument();
  });

  it('switches filtered sessions when a different period is selected', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeName: 'Ana López', date: '2026-03-10' }),
      makeSession({ sessionId: 2, employeeName: 'Luis Soto', date: '2026-03-20' }),
    ]);
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    render(<VerificationScreen />);
    fireEvent.change(screen.getByLabelText('Periodo'), { target: { value: '2026-3-2' } });
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
    expect(screen.getAllByText('Luis Soto').length).toBeGreaterThan(0);
  });

  it('always shows the single-period submission note', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ date: '2026-03-10' })]);
    useTasStore.getState().setAvailablePeriods([p1]);
    render(<VerificationScreen />);
    expect(screen.getByText(/Solo se enviará el periodo seleccionado/)).toBeInTheDocument();
  });

  it('Revisar is enabled when the selected period has no flagged sessions even if other periods do', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, date: '2026-03-10', needsResolution: false }),
      makeSession({ sessionId: 2, date: '2026-03-20', needsResolution: true }),
    ]);
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    useTasStore.getState().setSelectedPeriod(p1);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeEnabled();
  });

  it('passes the selected period to resolveVerification on submit', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, date: '2026-03-10', effectiveStart: '08:00:00', lastScan: '17:00:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([p1]);
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));

    await waitFor(() => {
      expect(mockResolveVerification).toHaveBeenCalledWith('tok-1', expect.any(Array), p1);
    });
  });
});

describe('VerificationScreen shift mismatch card', () => {
  function mismatchSession(overrides: Partial<TasSession> = {}): TasSession {
    return makeSession({
      flags: ['SHIFT_MISMATCH'],
      effectiveStart: '2026-03-10T07:03:00',
      lastScan: '2026-03-10T15:05:00',
      matchedShiftId: 'tarde',
      matchedShiftName: 'Tarde',
      assignedShiftId: 'manana',
      assignedShiftName: 'Manana',
      ...overrides,
    });
  }

  beforeEach(() => {
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    useTasStore.getState().setFlaggedSessions([mismatchSession()]);
  });

  it('shows the assigned and matched shift confirmation message', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    expect(screen.getByText(/Turno asignado: Manana/)).toBeInTheDocument();
    expect(screen.getByText(/se aplicará Tarde/)).toBeInTheDocument();
  });

  it('renders scan pills when scans are present', () => {
    useTasStore.getState().setFlaggedSessions([mismatchSession({ scans: ['07:03:00', '15:05:00'] })]);
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    expect(screen.getByText('07:03')).toBeInTheDocument();
    expect(screen.getByText('15:05')).toBeInTheDocument();
  });

  it('does not render Entrada/Salida inputs or Horas calculadas', () => {
    render(<VerificationScreen />);
    expect(screen.queryByLabelText('Entrada')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Salida')).not.toBeInTheDocument();
    expect(screen.queryByText(/Horas calculadas/)).not.toBeInTheDocument();
  });

  it('shows a note that the displayed shift will apply automatically unless changed', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    expect(screen.getByText(/se aplicará automáticamente si no realiza ningún cambio/i)).toBeInTheDocument();
  });

  it('has no Confirmar button', () => {
    render(<VerificationScreen />);
    expect(screen.queryByRole('button', { name: /confirmar/i })).not.toBeInTheDocument();
  });

  it('falls back to an empty acceptedShiftId when there is no matched shift', () => {
    useTasStore.getState().setFlaggedSessions([mismatchSession({ matchedShiftId: null, matchedShiftName: null })]);
    render(<VerificationScreen />);
    expect(useTasStore.getState().shiftAcceptances[1]).toBeUndefined();
  });

  it('clicking "Elegir otro turno" reveals a shift select with Aplicar/Cancelar', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    fireEvent.click(screen.getByRole('button', { name: /elegir otro turno/i }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /aplicar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument();
  });

  it('Cancelar collapses the dropdown without changing the displayed shift', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    fireEvent.click(screen.getByRole('button', { name: /elegir otro turno/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(/se aplicará Tarde/)).toBeInTheDocument();
  });

  it('includes the matched shift as acceptedShiftId in resolveVerification payload on submit by default', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([mismatchSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));

    const [, payload] = mockResolveVerification.mock.calls[0];
    expect(payload[0]).toEqual({ sessionId: 1, acceptedShiftId: 'tarde' });
  });

  it('Aplicar updates the confirmation message and records the chosen shift', () => {
    useTasStore.getState().setFlaggedSessions([mismatchSession()]);
    useTasStore.getState().setAvailableShifts([
      { id: 'tarde', name: 'Tarde', startTime: '15:00', endTime: '23:00' },
      { id: 'manana', name: 'Manana', startTime: '07:00', endTime: '15:00' },
    ]);
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    fireEvent.click(screen.getByRole('button', { name: /elegir otro turno/i }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'manana' } });
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }));
    expect(screen.getByText(/se aplicará Manana/)).toBeInTheDocument();

    expect(useTasStore.getState().shiftAcceptances[1]).toBe('manana');
  });
});

describe('VerificationScreen empty state for selected period', () => {
  const periods: TasPeriod[] = [
    { anio: 2026, mes: 3, numeroDequincena: 1 },
    { anio: 2026, mes: 3, numeroDequincena: 2 },
  ];

  it('shows an empty-state message and hides the session list when the selected period has nothing to resolve', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeName: 'Ana', date: '2026-03-20' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[0]);

    render(<VerificationScreen />);

    expect(screen.getByText(/Este periodo no presenta inconsistencias/i)).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revisar/i })).not.toBeDisabled();
  });

  it('hides the empty-state message and shows the employee group when the selected period has sessions to resolve', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, date: '2026-03-05' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[0]);

    render(<VerificationScreen />);

    expect(screen.queryByText(/Este periodo no presenta inconsistencias/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('Ana López').length).toBeGreaterThan(0);
  });

  it('toggles between empty state and session list when switching periods', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, date: '2026-03-05' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[0]);

    render(<VerificationScreen />);

    expect(screen.queryByText(/Este periodo no presenta inconsistencias/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/periodo/i), { target: { value: '2026-3-2' } });

    expect(screen.getByText(/Este periodo no presenta inconsistencias/i)).toBeInTheDocument();
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  });
});

describe('VerificationScreen same-day double group', () => {
  function doubleSession(overrides: Partial<TasSession> = {}): TasSession {
    return makeSession({
      flags: ['SAME_DAY_DOUBLE'],
      scans: ['2026-03-15T07:00:00', '2026-03-15T15:00:00'],
      effectiveStart: '2026-03-15T07:00:00',
      lastScan: '2026-03-15T15:00:00',
      matchedShiftId: 'manana',
      matchedShiftName: 'Manana',
      assignedShiftId: 'manana',
      assignedShiftName: 'Manana',
      ...overrides,
    });
  }

  beforeEach(() => {
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    useTasStore.getState().setFlaggedSessions([
      doubleSession({ sessionId: 1, matchedShiftId: 'manana', matchedShiftName: 'Manana' }),
      doubleSession({
        sessionId: 2,
        scans: ['2026-03-15T15:02:00', '2026-03-15T23:00:00'],
        effectiveStart: '2026-03-15T15:02:00',
        lastScan: '2026-03-15T23:00:00',
        matchedShiftId: 'tarde',
        matchedShiftName: 'Tarde',
      }),
    ]);
  });

  it('renders one group card for both sessions on the same employee/date', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    expect(screen.getAllByText(/Ana López/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Manana/)).toBeInTheDocument();
    expect(screen.getByText(/Tarde/)).toBeInTheDocument();
  });

  it('renders a radio per session plus "Mantener todas", defaulting to "Mantener todas"', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    const keepAllRadio = screen.getByRole('radio', { name: /mantener todas/i });
    expect(keepAllRadio).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('shows a note that the default selection will apply automatically unless changed', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    expect(screen.getByText(/se aplicará automáticamente si no realiza ningún cambio/i)).toBeInTheDocument();
  });

  it('has no Confirmar button', () => {
    render(<VerificationScreen />);
    expect(screen.queryByRole('button', { name: /confirmar/i })).not.toBeInTheDocument();
  });

  it('selecting a specific session records that session id', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]); // first session-specific radio
    expect(useTasStore.getState().sameDayDoubleResolutions['E1|2026-03-15']).toBe(1);
  });

  it('Revisar stays enabled with the default same-day-double selection', () => {
    useTasStore.getState().setFlaggedSessions([
      doubleSession({ sessionId: 1, matchedShiftId: 'manana', matchedShiftName: 'Manana' }),
      doubleSession({
        sessionId: 2,
        scans: ['2026-03-15T15:02:00', '2026-03-15T23:00:00'],
        effectiveStart: '2026-03-15T15:02:00',
        lastScan: '2026-03-15T23:00:00',
        matchedShiftId: 'tarde',
        matchedShiftName: 'Tarde',
      }),
    ]);

    render(<VerificationScreen />);

    expect(screen.getByRole('button', { name: /revisar/i })).not.toBeDisabled();
  });

  it('includes employeeId/date/keepSessionId in resolveVerification payload on submit by default', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));

    const [, payload] = mockResolveVerification.mock.calls[0];
    expect(payload).toContainEqual({ employeeId: 'E1', date: '2026-03-15', keepSessionId: 'all' });
  });
});

describe('VerificationScreen employee grouping', () => {
  it('renders one collapsible group per employee', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana López' }),
      makeSession({ sessionId: 2, employeeId: 'E2', employeeName: 'Luis Soto' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /Ana López/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Luis Soto/ })).toBeInTheDocument();
  });

  it('expands a group with pending sessions by default', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana López' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /Ana López/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument();
  });

  it('collapses a group once its only session is confirmed', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana López', effectiveStart: '08:00:00', lastScan: '17:00:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    const groupHeader = screen.getByRole('button', { name: /Ana López/ });
    expect(groupHeader).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/Resuelto/)).toBeInTheDocument();
  });

  it('clicking a collapsed resolved group header expands it again', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana López', effectiveStart: '08:00:00', lastScan: '17:00:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    const groupHeader = screen.getByRole('button', { name: /Ana López/ });
    expect(groupHeader).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(groupHeader);
    expect(groupHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Confirmado')).toBeInTheDocument();
  });

  it('keeps a resolved group in its original position instead of sinking it to the bottom', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana López', effectiveStart: '08:00:00', lastScan: '17:00:00' }),
      makeSession({ sessionId: 2, employeeId: 'E2', employeeName: 'Luis Soto' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);

    // Initial order: Ana first (alphabetical, both pending)
    let headers = screen.getAllByRole('button', { name: /Ana López|Luis Soto/ });
    expect(headers[0]).toHaveTextContent('Ana López');
    expect(headers[1]).toHaveTextContent('Luis Soto');

    // Confirm Ana's session — her pendingCount drops to 0
    fireEvent.click(screen.getAllByRole('button', { name: /confirmar/i })[0]);

    // Ana's group should still appear first (collapsed in-place), not sink behind Luis
    headers = screen.getAllByRole('button', { name: /Ana López|Luis Soto/ });
    expect(headers[0]).toHaveTextContent('Ana López');
    expect(headers[1]).toHaveTextContent('Luis Soto');
    expect(headers[0]).toHaveAttribute('aria-expanded', 'false');
  });

  it('resets group order when switching periods so each period starts with its own initial sort', () => {
    const p1: TasPeriod = { anio: 2026, mes: 3, numeroDequincena: 1 };
    const p2: TasPeriod = { anio: 2026, mes: 3, numeroDequincena: 2 };
    useTasStore.getState().setFlaggedSessions([
      // P1 employees (dates 1–15): Zoe first alphabetically is wrong — Beto < Zoe
      makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Zoe Vargas', date: '2026-03-05' }),
      makeSession({ sessionId: 2, employeeId: 'E2', employeeName: 'Beto Cruz', date: '2026-03-05' }),
      // P2 employees (dates 16–31)
      makeSession({ sessionId: 3, employeeId: 'E3', employeeName: 'Marta Ríos', date: '2026-03-20' }),
      makeSession({ sessionId: 4, employeeId: 'E4', employeeName: 'Ana López', date: '2026-03-20' }),
    ]);
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    useTasStore.getState().setSelectedPeriod(p1);

    render(<VerificationScreen />);

    // P1: Beto Cruz before Zoe Vargas (alphabetical, both pending)
    let headers = screen.getAllByRole('button', { name: /Beto Cruz|Zoe Vargas/ });
    expect(headers[0]).toHaveTextContent('Beto Cruz');
    expect(headers[1]).toHaveTextContent('Zoe Vargas');

    // Switch to P2
    fireEvent.change(screen.getByLabelText('Periodo'), { target: { value: '2026-3-2' } });

    // P2: Ana López before Marta Ríos (alphabetical, both pending) — not influenced by P1 order
    headers = screen.getAllByRole('button', { name: /Ana López|Marta Ríos/ });
    expect(headers[0]).toHaveTextContent('Ana López');
    expect(headers[1]).toHaveTextContent('Marta Ríos');
  });

  it('orders groups with pending sessions before fully resolved groups', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Zoe Vargas' }),
      makeSession({ sessionId: 2, employeeId: 'E2', employeeName: 'Beto Cruz' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    useTasStore.getState().setResolvedSession(1, { resolvedStart: '08:00', resolvedEnd: '17:00' });
    render(<VerificationScreen />);
    const headers = screen.getAllByRole('button', { name: /Vargas|Cruz/ });
    expect(headers[0]).toHaveTextContent('Beto Cruz');
    expect(headers[1]).toHaveTextContent('Zoe Vargas');
  });

  it('collapses a group by default when it contains only a shift-mismatch session', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({
        sessionId: 1, employeeId: 'E1', employeeName: 'Ana López', date: '2026-03-10',
        flags: ['SHIFT_MISMATCH'],
        effectiveStart: '2026-03-10T07:03:00', lastScan: '2026-03-10T15:05:00',
        matchedShiftId: 'tarde', matchedShiftName: 'Tarde',
        assignedShiftId: 'manana', assignedShiftName: 'Manana',
      }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    const header = screen.getByRole('button', { name: /Ana López/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('✓ Resuelto')).toBeInTheDocument();
    expect(screen.queryByText(/Turno asignado: Manana/)).not.toBeInTheDocument();
  });

  it('groups a regular session and a shift-mismatch session for the same employee under one header', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana López', date: '2026-03-05', flags: ['MISSING_ENTRY'] }),
      makeSession({
        sessionId: 2, employeeId: 'E1', employeeName: 'Ana López', date: '2026-03-10',
        flags: ['SHIFT_MISMATCH'],
        effectiveStart: '2026-03-10T07:03:00', lastScan: '2026-03-10T15:05:00',
        matchedShiftId: 'tarde', matchedShiftName: 'Tarde',
        assignedShiftId: 'manana', assignedShiftName: 'Manana',
      }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getAllByRole('button', { name: /Ana López/ })).toHaveLength(1);
    expect(screen.getByText(/Turno asignado: Manana/)).toBeInTheDocument();
  });
});

describe('SHORT_DAY sessions', () => {
  function makeShortDaySession(overrides: Partial<TasSession> = {}): TasSession {
    return {
      sessionId: 99,
      employeeId: 'E9',
      employeeName: 'Carlos Díaz',
      date: '2026-03-10',
      scans: ['2026-03-10T07:00:00', '2026-03-10T11:00:00'],
      matchedShiftId: 'S1',
      assignedShiftId: 'S1',
      assignedShiftName: 'Turno Mañana',
      effectiveStart: '2026-03-10T07:00:00',
      lastScan: '2026-03-10T11:00:00',
      workedMinutes: 240,
      workedHours: 4.0,
      needsResolution: false,
      flags: ['SHORT_DAY'],
      ...overrides,
    };
  }

  it('shows Jornada corta badge for SHORT_DAY sessions', () => {
    useTasStore.getState().setFlaggedSessions([makeShortDaySession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Jornada corta')).toBeInTheDocument();
  });

  it('exit time input is editable for SHORT_DAY sessions', () => {
    useTasStore.getState().setFlaggedSessions([makeShortDaySession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    const exitInput = screen.getByLabelText('Salida');
    expect(exitInput).not.toHaveAttribute('readonly');
    expect(exitInput).not.toHaveAttribute('readOnly');
  });

  it('Registrar corrección button appears only when exit is changed', () => {
    useTasStore.getState().setFlaggedSessions([makeShortDaySession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.queryByRole('button', { name: 'Registrar corrección' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Salida'), { target: { value: '13:00' } });
    expect(screen.getByRole('button', { name: 'Registrar corrección' })).toBeInTheDocument();
  });

  it('does not show Jornadas cortas section when there are no SHORT_DAY sessions', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ flags: ['MISSING_ENTRY'], needsResolution: true }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.queryByText('Jornadas cortas')).not.toBeInTheDocument();
  });

  it('clicking Registrar corrección saves the override to the store', () => {
    useTasStore.getState().setFlaggedSessions([makeShortDaySession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);

    fireEvent.change(screen.getByLabelText('Salida'), { target: { value: '13:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar corrección' }));

    const resolved = useTasStore.getState().resolvedSessions[99];
    expect(resolved).toEqual({ resolvedStart: '07:00', resolvedEnd: '13:00' });
  });
});

describe('VerificationScreen error display', () => {
  it('shows error alert when store has an error', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    useTasStore.getState().setError('Ocurrió un error al enviar. Intente nuevamente.');
    render(<VerificationScreen />);
    expect(screen.getByText('Ocurrió un error al enviar. Intente nuevamente.')).toBeInTheDocument();
  });

  it('does not show error alert when there is no error', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it('renders the error message from a failed resolve call', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, effectiveStart: '08:00:00', lastScan: '17:00:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    mockResolveVerification.mockRejectedValue(new Error('network error'));

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));

    await waitFor(() => {
      expect(screen.getByText('Ocurrió un error al enviar. Intente nuevamente.')).toBeInTheDocument();
    });
  });
});

describe('VerificationScreen completion state', () => {
  it('shows green banner and enables green Revisar button when all sessions are confirmed', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, effectiveStart: '08:00:00', lastScan: '17:00:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);

    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    expect(screen.getByText(/Todos los grupos están resueltos/)).toBeInTheDocument();
    const enviar = screen.getByRole('button', { name: /revisar/i });
    expect(enviar).not.toBeDisabled();
    expect(enviar).toHaveTextContent('✓ Revisar');
  });

  it('does not show green banner when there are still pending sessions', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1 }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);

    expect(screen.queryByText(/Todos los grupos están resueltos/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revisar/i })).toBeDisabled();
  });

  it('does not show green banner when totalToResolve is 0 (empty state — no inconsistencies)', () => {
    useTasStore.getState().setFlaggedSessions([]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);

    expect(screen.queryByText(/Todos los grupos están resueltos/)).not.toBeInTheDocument();
    const enviar = screen.getByRole('button', { name: /revisar/i });
    expect(enviar).not.toBeDisabled();
    expect(enviar).toHaveTextContent('Revisar');
    expect(enviar).not.toHaveTextContent('✓ Revisar');
  });
});
