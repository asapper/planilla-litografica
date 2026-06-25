import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AxiosError } from 'axios';
import ReviewScreen from './ReviewScreen';
import { useTasStore } from '../../tasStore';
import { useToastStore } from '../../toastStore';
import * as tasApi from '../../tasApi';
import '../../configApi';
import * as api from '../../api';
import type { ResolvedRow, SessionSummary } from '../../tasTypes';

vi.mock('../../tasApi');
vi.mock('../../configApi');
vi.mock('../../api');

const mockSubmitTas = vi.mocked(tasApi.submitTas);
const mockCheckDbHealth = vi.mocked(api.checkDbHealth);
const mockCheckDuplicates = vi.mocked(tasApi.checkDuplicates);

const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
];

const sessionSummaries: Record<string, SessionSummary[]> = {
  E1: [
    { date: '2026-06-02', shiftName: 'Mañana', entryTime: '2026-06-02T07:02:00', exitTime: '2026-06-02T15:05:00', workedHours: 8.0, simplesMinutes: 30, doblesMinutes: 0, scans: ['2026-06-02T07:02', '2026-06-02T15:05'] },
    { date: '2026-06-03', shiftName: 'Mañana', entryTime: '2026-06-03T07:00:00', exitTime: '2026-06-03T15:00:00', workedHours: 8.0, simplesMinutes: 0, doblesMinutes: 0, scans: ['2026-06-03T07:00', '2026-06-03T15:00'] },
  ],
  E2: [
    { date: '2026-06-02', shiftName: 'Tarde', entryTime: '2026-06-02T14:00:00', exitTime: '2026-06-02T22:00:00', workedHours: 8.0, simplesMinutes: 0, doblesMinutes: 60, scans: ['2026-06-02T14:00', '2026-06-02T22:00'] },
  ],
};

beforeEach(() => {
  useTasStore.getState().resetTas();
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
  mockCheckDbHealth.mockResolvedValue(true);
  mockCheckDuplicates.mockResolvedValue([]);
});

describe('ReviewScreen routing', () => {
  it('renders list view by default (heading visible)', () => {
    useTasStore.getState().setResolvedRows(rows);
    render(<ReviewScreen />);
    expect(screen.getByText(/revisión de registros/i)).toBeInTheDocument();
  });

  it('renders an Enviar button via list view', () => {
    render(<ReviewScreen />);
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });

  it('navigates to detail view when employee row is clicked', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    useTasStore.getState().setSessionSummaries(sessionSummaries);

    render(<ReviewScreen />);
    fireEvent.click(screen.getByText('Ana López'));

    await waitFor(() => {
      expect(screen.getByText(/volver a lista/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/revisión de registros/i)).not.toBeInTheDocument();
  });

  it('returns to list view when back button is clicked', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    useTasStore.getState().setSessionSummaries(sessionSummaries);

    render(<ReviewScreen />);
    fireEvent.click(screen.getByText('Ana López'));

    await waitFor(() => {
      expect(screen.getByText(/volver a lista/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/volver a lista/i));

    await waitFor(() => {
      expect(screen.getByText(/revisión de registros/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/volver a lista/i)).not.toBeInTheDocument();
  });
});

describe('ReviewScreen submit', () => {
  it('calls submitTas and advances to polling', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-final' });

    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('polling'));
    expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {}, {});
    expect(useTasStore.getState().jobId).toBe('job-final');
  });

  it('reverts to review and shows toast when submitTas throws', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    mockSubmitTas.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0].variant).toBe('error');
    expect(useTasStore.getState().tasView).toBe('review');
  });

  it('does nothing when uploadToken is null', () => {
    useTasStore.getState().setResolvedRows(rows);

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    expect(mockSubmitTas).not.toHaveBeenCalled();
    expect(useTasStore.getState().tasView).toBe('idle');
  });

  it('sends overrides in submit payload', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-override' });

    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E1: { horasExtrasSimples: 10 },
    }, {}));
  });

  it('does not send stashed overrides in submit payload', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    useTasStore.getState().stashOvertimeOverrides('E1');
    mockSubmitTas.mockResolvedValue({ jobId: 'job-stashed' });

    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {}, {}));
  });

  it('sends diasNoLaborados overrides in submit payload', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    useTasStore.getState().setDiasNoLaboradosOverride('E1', 3);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-dias' });

    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {}, { E1: 3 }));
  });
});

describe('ReviewScreen error display', () => {
  it('renders the generic error message from a failed submit as a toast', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    mockSubmitTas.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
    expect(useToastStore.getState().toasts[0].message).toBe('Ocurrió un error al enviar. Intente nuevamente.');
    expect(useToastStore.getState().toasts[0].variant).toBe('error');
  });

  it('shows backend DB error message as a toast when submit returns a 502 with message', async () => {
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
    await waitFor(() => expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
    expect(useToastStore.getState().toasts[0].message).toBe('Base de datos remota no disponible.');
    expect(useToastStore.getState().toasts[0].variant).toBe('error');
    expect(useTasStore.getState().tasView).toBe('review');
  });
});

describe('ReviewScreen DB health check', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disables submit button before the first health check resolves', () => {
    mockCheckDbHealth.mockReturnValue(new Promise(() => {}));

    render(<ReviewScreen />);

    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });

  it('disables submit button and shows warning when DB is unreachable', async () => {
    mockCheckDbHealth.mockResolvedValue(false);

    render(<ReviewScreen />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
    });
    expect(screen.getByText(/no se pudo conectar a la base de datos remota/i)).toBeInTheDocument();
  });

  it('enables submit button when DB is reachable', async () => {
    mockCheckDbHealth.mockResolvedValue(true);

    render(<ReviewScreen />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled();
    });
    expect(screen.queryByText(/no se pudo conectar a la base de datos remota/i)).not.toBeInTheDocument();
  });

  it('re-checks DB health periodically and re-enables button when DB recovers', async () => {
    mockCheckDbHealth.mockResolvedValue(false);

    render(<ReviewScreen />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
    });

    mockCheckDbHealth.mockResolvedValue(true);
    await act(async () => { vi.advanceTimersByTime(5000); });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled();
    });
    expect(screen.queryByText(/no se pudo conectar a la base de datos remota/i)).not.toBeInTheDocument();
  });

  it('disables button when DB goes down after being up', async () => {
    mockCheckDbHealth.mockResolvedValue(true);

    render(<ReviewScreen />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled();
    });

    mockCheckDbHealth.mockResolvedValue(false);
    await act(async () => { vi.advanceTimersByTime(5000); });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
    });
    expect(screen.getByText(/no se pudo conectar a la base de datos remota/i)).toBeInTheDocument();
  });
});

describe('ReviewScreen duplicate detection', () => {
  beforeEach(() => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
  });

  it('calls checkDuplicates on mount with the upload token', async () => {
    mockCheckDuplicates.mockResolvedValue([]);
    render(<ReviewScreen />);
    await waitFor(() => expect(mockCheckDuplicates).toHaveBeenCalledWith('tok-1'));
  });

  it('renders duplicate banner when duplicates are found', async () => {
    mockCheckDuplicates.mockResolvedValue(['E1']);
    render(<ReviewScreen />);
    await waitFor(() => {
      expect(screen.getByText(/1 excluidos/i)).toBeInTheDocument();
    });
  });

  it('excludes duplicate employee codes from submit payload', async () => {
    mockCheckDuplicates.mockResolvedValue(['E1']);
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 10);
    useTasStore.getState().setOvertimeOverride('E2', 'horasExtrasDobles', 5);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-dup' });

    render(<ReviewScreen />);
    await waitFor(() => expect(mockCheckDuplicates).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E2: { horasExtrasDobles: 5 },
    }, {}));
  });

  it('excludes duplicate employee codes from diasNoLaborados submit payload', async () => {
    mockCheckDuplicates.mockResolvedValue(['E1']);
    useTasStore.getState().setDiasNoLaboradosOverride('E1', 2);
    useTasStore.getState().setDiasNoLaboradosOverride('E2', 4);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-dup-dias' });

    render(<ReviewScreen />);
    await waitFor(() => expect(mockCheckDuplicates).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /enviar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {}, { E2: 4 }));
  });

  it('shows error toast when checkDuplicates fails', async () => {
    mockCheckDuplicates.mockRejectedValue(new Error('network error'));
    render(<ReviewScreen />);
    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
    expect(useToastStore.getState().toasts[0].message).toMatch(/no se pudo verificar duplicados/i);
    expect(useToastStore.getState().toasts[0].variant).toBe('error');
  });

  it('disables submit button when all rows are duplicates', async () => {
    mockCheckDuplicates.mockResolvedValue(['E1', 'E2']);
    render(<ReviewScreen />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /todos los registros ya fueron enviados/i })).toBeDisabled();
    });
  });
});
