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
    expect(screen.getByText('Ana López')).toBeInTheDocument();
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

describe('VerificationScreen filter chips', () => {
  it('renders Todos filter chip', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /todos/i })).toBeInTheDocument();
  });

  it('renders Falta entrada chip when relevant sessions exist', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ flags: ['MISSING_ENTRY'] })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /falta entrada/i })).toBeInTheDocument();
  });

  it('filters sessions by chip click', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, flags: ['MISSING_ENTRY'], employeeName: 'Ana' }),
      makeSession({ sessionId: 2, flags: ['MISSING_EXIT'], employeeName: 'Luis', employeeId: 'E2' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /falta entrada/i }));
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Luis')).not.toBeInTheDocument();
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

  it('collapses session card to summary row on confirm', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ effectiveStart: '08:00:00', lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(screen.getByText('Confirmado')).toBeInTheDocument();
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
  it('Enviar button is disabled until all sessions confirmed', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });

  it('calls resolveVerification then advances to review without auto-submitting', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([makeSession({ effectiveStart: '08:00:00', lastScan: '17:00:00' })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(useTasStore.getState().tasView).toBe('review');
    });
    expect(mockResolveVerification).toHaveBeenCalledOnce();
    expect(mockSubmitTas).not.toHaveBeenCalled();
    expect(useTasStore.getState().resolvedRowCount).toBe(2);
    expect(useTasStore.getState().resolvedRows).toHaveLength(2);
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
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

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
    expect(screen.getByText('Ana López')).toBeInTheDocument();
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
    expect(screen.getByText('Luis Soto')).toBeInTheDocument();
  });

  it('always shows the single-period submission note', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ date: '2026-03-10' })]);
    useTasStore.getState().setAvailablePeriods([p1]);
    render(<VerificationScreen />);
    expect(screen.getByText(/Solo se enviará el periodo seleccionado/)).toBeInTheDocument();
  });

  it('Enviar is enabled when the selected period has no flagged sessions even if other periods do', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, date: '2026-03-10', needsResolution: false }),
      makeSession({ sessionId: 2, date: '2026-03-20', needsResolution: true }),
    ]);
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    useTasStore.getState().setSelectedPeriod(p1);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
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
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

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
    expect(screen.getByText(/Turno asignado: Manana/)).toBeInTheDocument();
    expect(screen.getByText(/se aplicará Tarde/)).toBeInTheDocument();
  });

  it('renders scan pills when scans are present', () => {
    useTasStore.getState().setFlaggedSessions([mismatchSession({ scans: ['07:03:00', '15:05:00'] })]);
    render(<VerificationScreen />);
    expect(screen.getByText('07:03')).toBeInTheDocument();
    expect(screen.getByText('15:05')).toBeInTheDocument();
  });

  it('does not render Entrada/Salida inputs or Horas calculadas', () => {
    render(<VerificationScreen />);
    expect(screen.queryByLabelText('Entrada')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Salida')).not.toBeInTheDocument();
    expect(screen.queryByText(/Horas calculadas/)).not.toBeInTheDocument();
  });

  it('Confirmar is enabled by default', () => {
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeEnabled();
  });

  it('disables Confirmar when there is no matched shift and no shifts available', () => {
    useTasStore.getState().setFlaggedSessions([mismatchSession({ matchedShiftId: null, matchedShiftName: null })]);
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
  });

  it('confirming without choosing a different shift records the matched shift as accepted', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(useTasStore.getState().shiftAcceptances[1]).toBe('tarde');
  });

  it('clicking "Elegir otro turno" reveals a shift select with Aplicar/Cancelar', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /elegir otro turno/i }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /aplicar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument();
  });

  it('Cancelar collapses the dropdown without changing the displayed shift', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /elegir otro turno/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(/se aplicará Tarde/)).toBeInTheDocument();
  });

  it('includes acceptedShiftId in resolveVerification payload on submit', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([mismatchSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));

    const [, payload] = mockResolveVerification.mock.calls[0];
    expect(payload[0]).toEqual({ sessionId: 1, acceptedShiftId: 'tarde' });
  });

  it('Aplicar updates the confirmation message and records the chosen shift on confirm', () => {
    useTasStore.getState().setFlaggedSessions([mismatchSession()]);
    useTasStore.getState().setAvailableShifts([
      { id: 'tarde', name: 'Tarde', startTime: '15:00', endTime: '23:00' },
      { id: 'manana', name: 'Manana', startTime: '07:00', endTime: '15:00' },
    ]);
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /elegir otro turno/i }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'manana' } });
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }));
    expect(screen.getByText(/se aplicará Manana/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(useTasStore.getState().shiftAcceptances[1]).toBe('manana');
  });
});

describe('VerificationScreen empty state for selected period', () => {
  const periods: TasPeriod[] = [
    { anio: 2026, mes: 3, numeroDequincena: 1 },
    { anio: 2026, mes: 3, numeroDequincena: 2 },
  ];

  it('shows an empty-state message and hides chips/sessions when the selected period has nothing to resolve', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, employeeName: 'Ana', date: '2026-03-20' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[0]);

    render(<VerificationScreen />);

    expect(screen.getByText(/Este periodo no presenta inconsistencias/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /todos/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled();
  });

  it('hides the empty-state message and shows chips/sessions when the selected period has sessions to resolve', () => {
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, date: '2026-03-05' }),
    ]);
    useTasStore.getState().setAvailablePeriods(periods);
    useTasStore.getState().setSelectedPeriod(periods[0]);

    render(<VerificationScreen />);

    expect(screen.queryByText(/Este periodo no presenta inconsistencias/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /todos/i })).toBeInTheDocument();
    expect(screen.getByText('Ana López')).toBeInTheDocument();
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
    expect(screen.getAllByText(/Ana López/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Manana/)).toBeInTheDocument();
    expect(screen.getByText(/Tarde/)).toBeInTheDocument();
  });

  it('renders a radio per session plus "Mantener todas", defaulting to "Mantener todas"', () => {
    render(<VerificationScreen />);
    const keepAllRadio = screen.getByRole('radio', { name: /mantener todas/i });
    expect(keepAllRadio).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('Confirmar is enabled without any selection change', () => {
    render(<VerificationScreen />);
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeEnabled();
  });

  it('confirming with default selection records "all" for the group', () => {
    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(useTasStore.getState().sameDayDoubleResolutions['E1|2026-03-15']).toBe('all');
  });

  it('selecting a specific session and confirming records that session id', () => {
    render(<VerificationScreen />);
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]); // first session-specific radio
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(useTasStore.getState().sameDayDoubleResolutions['E1|2026-03-15']).toBe(1);
  });

  it('Enviar stays enabled after confirming the group while a non-"all" filter chip is active', () => {
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
      makeSession({ sessionId: 3, employeeId: 'E2', employeeName: 'Luis', flags: ['MISSING_ENTRY'], date: '2026-03-14' }),
    ]);

    render(<VerificationScreen />);

    fireEvent.click(screen.getAllByRole('button', { name: /confirmar/i })[0]);
    expect(useTasStore.getState().sameDayDoubleResolutions['E1|2026-03-15']).toBe('all');
    expect(screen.getByText('1 por resolver')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /falta entrada/i }));

    expect(screen.getByText('1 por resolver')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });

  it('includes employeeId/date/keepSessionId in resolveVerification payload on submit', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));

    const [, payload] = mockResolveVerification.mock.calls[0];
    expect(payload).toContainEqual({ employeeId: 'E1', date: '2026-03-15', keepSessionId: 'all' });
  });
});
