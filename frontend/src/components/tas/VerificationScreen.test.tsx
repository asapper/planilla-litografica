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
    matchedShiftName: 'Turno Mañana',
    effectiveStart: null,
    lastScan: null,
    workedMinutes: 0,
    workedHours: 0,
    needsResolution: true,
    flags: ['MISSING_ENTRY'],
    consistentMismatch: false,
    ...overrides,
  };
}

const mockResult: TasResolveResult = {
  uploadToken: 'tok-2',
  resolvedRows: [
    { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0 },
    { codigoEmpleado: 'E2', nombreEmpleado: 'Luis', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0 },
  ],
  flaggedSessions: [],
  usedFallbackHolidays: false,
};

beforeEach(() => {
  useTasStore.getState().resetTas();
  vi.clearAllMocks();
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

  it('renders shift name', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText(/Turno Mañana/)).toBeInTheDocument();
  });

  it('renders flag badge', () => {
    useTasStore.getState().setFlaggedSessions([makeSession()]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText('Falta entrada')).toBeInTheDocument();
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

describe('VerificationScreen consistent mismatch banner', () => {
  it('renders mismatch banner when consistentMismatch is true', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ consistentMismatch: true })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.getByText(/¿Desea actualizar su turno asignado/i)).toBeInTheDocument();
  });

  it('does not render mismatch banner when consistentMismatch is false', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ consistentMismatch: false })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    expect(screen.queryByText(/¿Desea actualizar su turno asignado/i)).not.toBeInTheDocument();
  });

  it('stores Sí decision in local component state', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ consistentMismatch: true })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    const yesBtn = screen.getByRole('button', { name: /sí, actualizar turno/i });
    fireEvent.click(yesBtn);
    expect(yesBtn).toHaveClass('bg-amber-600');
  });

  it('stores No decision in local component state', () => {
    useTasStore.getState().setFlaggedSessions([makeSession({ consistentMismatch: true })]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    render(<VerificationScreen />);
    const noBtn = screen.getByRole('button', { name: /no, mantener/i });
    fireEvent.click(noBtn);
    expect(noBtn).toHaveClass('bg-surface-container');
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

  it('includes updateShift in resolveVerification payload when mismatchChoice is update', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, consistentMismatch: true, effectiveStart: '08:00:00', lastScan: '17:00:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /sí, actualizar turno/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));

    const [, payload] = mockResolveVerification.mock.calls[0];
    expect(payload[0].updateShift).toBe(true);
  });

  it('includes updateShift false in resolveVerification payload when mismatchChoice is keep', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setFlaggedSessions([
      makeSession({ sessionId: 1, consistentMismatch: true, effectiveStart: '08:00:00', lastScan: '17:00:00' }),
    ]);
    useTasStore.getState().setAvailablePeriods([DEFAULT_PERIOD]);
    mockResolveVerification.mockResolvedValue(mockResult);

    render(<VerificationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /no, mantener/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));

    const [, payload] = mockResolveVerification.mock.calls[0];
    expect(payload[0].updateShift).toBe(false);
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
