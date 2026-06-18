import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import ReviewScreen from './ReviewScreen';
import { useTasStore } from '../../tasStore';
import * as tasApi from '../../tasApi';
import * as configApi from '../../configApi';
import type { ResolvedRow, SessionSummary } from '../../tasTypes';

vi.mock('../../tasApi');
vi.mock('../../configApi');

const mockSubmitTas = vi.mocked(tasApi.submitTas);
const mockRecomputeTas = vi.mocked(tasApi.recomputeTas);
const mockUpdateAccruesOvertime = vi.mocked(configApi.updateAccruesOvertime);

const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
];

const sessionSummaries: Record<string, SessionSummary[]> = {
  E1: [
    { date: '2026-06-02', shiftName: 'Mañana', entryTime: '2026-06-02T07:02:00', exitTime: '2026-06-02T15:05:00', workedHours: 8.0, simplesMinutes: 30, doblesMinutes: 0 },
    { date: '2026-06-03', shiftName: 'Mañana', entryTime: '2026-06-03T07:00:00', exitTime: '2026-06-03T15:00:00', workedHours: 8.0, simplesMinutes: 0, doblesMinutes: 0 },
  ],
  E2: [
    { date: '2026-06-02', shiftName: 'Tarde', entryTime: '2026-06-02T14:00:00', exitTime: '2026-06-02T22:00:00', workedHours: 8.0, simplesMinutes: 0, doblesMinutes: 60 },
  ],
};

beforeEach(() => {
  useTasStore.getState().resetTas();
  vi.clearAllMocks();
});

describe('ReviewScreen rendering', () => {
  it('renders a heading', () => {
    render(<ReviewScreen />);
    expect(screen.getByText(/revisión de registros/i)).toBeInTheDocument();
  });

  it('renders a row per resolved employee', () => {
    useTasStore.getState().setResolvedRows(rows);
    render(<ReviewScreen />);
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Luis García')).toBeInTheDocument();
  });

  it('shows the resolved row count, plural', () => {
    useTasStore.getState().setResolvedRows(rows);
    render(<ReviewScreen />);
    expect(screen.getByText(/se procesaron 2 registros/i)).toBeInTheDocument();
  });

  it('shows the ambiguous-shift badge when diasTurnoAmbiguo > 0', () => {
    useTasStore.getState().setResolvedRows([
      { ...rows[0], diasTurnoAmbiguo: 2, accruesOvertime: true },
      rows[1],
    ]);
    render(<ReviewScreen />);
    expect(screen.getByText('2 sin turno')).toBeInTheDocument();
  });

  it('does not show the ambiguous-shift badge when diasTurnoAmbiguo is 0', () => {
    useTasStore.getState().setResolvedRows(rows);
    render(<ReviewScreen />);
    expect(screen.queryByText(/sin turno/)).not.toBeInTheDocument();
  });

  it('shows the resolved row count, singular', () => {
    useTasStore.getState().setResolvedRows([rows[0]]);
    render(<ReviewScreen />);
    expect(screen.getByText(/se procesó 1 registro\b/i)).toBeInTheDocument();
  });

  it('renders an Enviar button', () => {
    render(<ReviewScreen />);
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });
});

describe('ReviewScreen submit', () => {
  it('calls submitTas and advances to result', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-final' });

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('result'));
    expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {});
    expect(useTasStore.getState().jobId).toBe('job-final');
  });

  it('reverts to review and sets error when submitTas throws', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    mockSubmitTas.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().error).not.toBeNull());
    expect(useTasStore.getState().tasView).toBe('review');
  });

  it('does nothing when uploadToken is null', () => {
    useTasStore.getState().setResolvedRows(rows);

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    expect(mockSubmitTas).not.toHaveBeenCalled();
    expect(useTasStore.getState().tasView).toBe('idle');
  });
});

describe('ReviewScreen error display', () => {
  it('shows error alert when store has an error', () => {
    useTasStore.getState().setResolvedRows(rows);
    useTasStore.getState().setError('Ocurrió un error al enviar. Intente nuevamente.');
    render(<ReviewScreen />);
    expect(screen.getByText('Ocurrió un error al enviar. Intente nuevamente.')).toBeInTheDocument();
  });

  it('renders the generic error message from a failed submit', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    mockSubmitTas.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(screen.getByText('Ocurrió un error al enviar. Intente nuevamente.')).toBeInTheDocument();
    });
  });

  it('shows backend DB error message when submit returns a 502 with message', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    const axiosError = new AxiosError('Request failed', '502', undefined, undefined, {
      data: { code: 'DB_ERROR', message: 'Base de datos remota no disponible.' },
      status: 502,
      statusText: 'Bad Gateway',
      headers: {},
      config: {} as never,
    });
    mockSubmitTas.mockRejectedValue(axiosError);

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(screen.getByText('Base de datos remota no disponible.')).toBeInTheDocument();
    });
    expect(useTasStore.getState().tasView).toBe('review');
  });
});

describe('ReviewScreen accruesOvertime toggle', () => {
  beforeEach(() => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
  });

  it('renders the Acumula horas extra column with a switch per row', () => {
    render(<ReviewScreen />);
    expect(screen.getByText('Acumula horas extra')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('toggles off: calls updateAccruesOvertime then recomputeTas, and replaces resolvedRows', async () => {
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    const newRows: ResolvedRow[] = [
      { ...rows[0], accruesOvertime: false, horasExtrasSimples: 0, horasExtrasDobles: 0 },
      rows[1],
    ];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: newRows });

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().resolvedRows).toEqual(newRows));
    expect(mockUpdateAccruesOvertime).toHaveBeenCalledWith('E1', false);
    expect(mockRecomputeTas).toHaveBeenCalledWith('tok-1');
  });

  it('toggles on: calls updateAccruesOvertime with true', async () => {
    const offRows: ResolvedRow[] = [
      { ...rows[0], accruesOvertime: false },
      rows[1],
    ];
    useTasStore.getState().setResolvedRows(offRows);
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: true,
    });
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: rows });

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(mockUpdateAccruesOvertime).toHaveBeenCalledWith('E1', true));
    expect(mockRecomputeTas).toHaveBeenCalledWith('tok-1');
  });

  it('reverts and shows error when updateAccruesOvertime fails', async () => {
    mockUpdateAccruesOvertime.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().error).not.toBeNull());
    expect(useTasStore.getState().resolvedRows).toEqual(rows);
    expect(mockRecomputeTas).not.toHaveBeenCalled();
  });

  it('reverts and shows error when recomputeTas fails', async () => {
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    mockRecomputeTas.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().error).not.toBeNull());
    expect(useTasStore.getState().resolvedRows).toEqual(rows);
  });

  it('disables switches while a toggle request is in flight, then re-enables', async () => {
    let resolveRecompute: (value: { uploadToken: string; resolvedRows: ResolvedRow[] }) => void;
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    mockRecomputeTas.mockImplementation(() => new Promise(resolve => {
      resolveRecompute = resolve;
    }));

    render(<ReviewScreen />);
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);

    await waitFor(() => expect(switches[0]).toBeDisabled());
    expect(switches[1]).toBeDisabled();

    resolveRecompute!({ uploadToken: 'tok-1', resolvedRows: rows });

    await waitFor(() => expect(switches[0]).not.toBeDisabled());
    expect(switches[1]).not.toBeDisabled();
  });

  it('shows session-expired messaging when recompute fails due to expired uploadToken', async () => {
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    mockRecomputeTas.mockRejectedValue(new Error('Upload token not found'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().error).toMatch(/sesión.*expir|vuelve a subir/i));
  });
});

describe('ReviewScreen overtime override', () => {
  beforeEach(() => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
  });

  it('renders number inputs for overtime columns', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(4); // 2 employees × 2 fields
  });

  it('displays computed values by default', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(2);  // E1 simples
    expect(inputs[1]).toHaveValue(0);  // E1 dobles
    expect(inputs[2]).toHaveValue(0);  // E2 simples
    expect(inputs[3]).toHaveValue(1);  // E2 dobles
  });

  it('updates store when user types a new value', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '7' } });
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 7 },
    });
  });

  it('displays override value instead of computed value', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(10);
  });

  it('applies visual indicator class when value is overridden', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveClass('text-blue-600');
    expect(inputs[1]).not.toHaveClass('text-blue-600');
  });

  it('overrides persist after accruesOvertime recompute', async () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    const newRows: ResolvedRow[] = [
      { ...rows[0], accruesOvertime: false, horasExtrasSimples: 0, horasExtrasDobles: 0 },
      rows[1],
    ];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: newRows });

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().resolvedRows).toEqual(newRows));
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 10 },
    });
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(10);
  });

  it('rejects negative values by clamping to 0', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '-3' } });
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 0 },
    });
  });

  it('treats empty input as 0', () => {
    render(<ReviewScreen />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '' } });
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 0 },
    });
  });

  it('sends overrides in submit payload', async () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-override' });

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E1: { horasExtrasSimples: 10 },
    }));
  });
});

describe('ReviewScreen expandable session details', () => {
  beforeEach(() => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    useTasStore.getState().setSessionSummaries(sessionSummaries);
  });

  it('renders an expand button for each employee row', () => {
    render(<ReviewScreen />);
    const expandButtons = screen.getAllByRole('button', { name: /detalles/i });
    expect(expandButtons).toHaveLength(2);
  });

  it('does not show session details by default', () => {
    render(<ReviewScreen />);
    expect(screen.queryByText('Mañana')).not.toBeInTheDocument();
    expect(screen.queryByText('Tarde')).not.toBeInTheDocument();
  });

  it('shows session details when expand button is clicked', () => {
    render(<ReviewScreen />);
    const expandButtons = screen.getAllByRole('button', { name: /detalles/i });
    fireEvent.click(expandButtons[0]);

    expect(screen.getAllByText('Mañana')).toHaveLength(2);
    expect(screen.getByText('07:02')).toBeInTheDocument();
    expect(screen.getByText('15:05')).toBeInTheDocument();
  });

  it('hides session details when collapse button is clicked', () => {
    render(<ReviewScreen />);
    const expandButtons = screen.getAllByRole('button', { name: /detalles/i });
    fireEvent.click(expandButtons[0]);
    expect(screen.getAllByText('Mañana')).toHaveLength(2);

    fireEvent.click(expandButtons[0]);
    expect(screen.queryByText('07:02')).not.toBeInTheDocument();
  });

  it('shows empty message when employee has no sessions', () => {
    useTasStore.getState().setSessionSummaries({ E1: [], E2: sessionSummaries.E2 });
    render(<ReviewScreen />);
    const expandButtons = screen.getAllByRole('button', { name: /detalles/i });
    fireEvent.click(expandButtons[0]);

    expect(screen.getByText(/sin sesiones registradas/i)).toBeInTheDocument();
  });
});
