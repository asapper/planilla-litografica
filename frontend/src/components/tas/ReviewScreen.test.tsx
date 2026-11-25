import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { AxiosError } from 'axios';
import ReviewScreen from './ReviewScreen';
import { useTasStore } from '../../tasStore';
import { useToastStore } from '../../toastStore';
import * as tasApi from '../../tasApi';
import '../../configApi';
import * as api from '../../api';
import type { IncompletePeriod, ResolvedRow, SessionSummary } from '../../tasTypes';

vi.mock('../../tasApi');
vi.mock('../../configApi');
vi.mock('../../api');

const mockSubmitTas = vi.mocked(tasApi.submitTas);
const mockCheckDbHealth = vi.mocked(api.checkDbHealth);
const mockCheckDuplicates = vi.mocked(tasApi.checkDuplicates);
const mockGetIncompletePeriods = vi.mocked(tasApi.getIncompletePeriods);

const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, fechasNoLaboradas: [], horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, fechasNoLaboradas: ['2026-03-08'], horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
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

const approve = (...codes: string[]) => {
  for (const r of useTasStore.getState().resolvedRows.filter(r => codes.includes(r.codigoEmpleado))) {
    useTasStore.getState().approveOvertime(r);
  }
};
const rowOf = (code: string) => useTasStore.getState().resolvedRows.find(r => r.codigoEmpleado === code)!;
const both = { E1: { horasExtrasSimples: 2, horasExtrasDobles: 0 }, E2: { horasExtrasSimples: 0, horasExtrasDobles: 1 } };

async function clickEnviar() {
  await waitFor(() => expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
}

beforeEach(() => {
  useTasStore.getState().resetTas();
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
  mockCheckDbHealth.mockResolvedValue(true);
  mockCheckDuplicates.mockResolvedValue([]);
  mockGetIncompletePeriods.mockResolvedValue([]);
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
  beforeEach(() => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
  });

  it('sends every approved row and advances to polling', async () => {
    approve('E1', 'E2');
    mockSubmitTas.mockResolvedValue({ jobId: 'job-final' });
    render(<ReviewScreen />);
    await clickEnviar();

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('polling'));
    expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', both, {});
    expect(useTasStore.getState().jobId).toBe('job-final');
  });

  it('reverts to review and shows toast when submitTas throws', async () => {
    approve('E1', 'E2');
    mockSubmitTas.mockRejectedValue(new Error('network error'));
    render(<ReviewScreen />);
    await clickEnviar();

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0].variant).toBe('error');
    expect(useTasStore.getState().tasView).toBe('review');
  });

  it('does nothing when uploadToken is null', () => {
    useTasStore.getState().setUploadToken(null);
    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    expect(mockSubmitTas).not.toHaveBeenCalled();
    expect(useTasStore.getState().tasView).toBe('idle');
  });

  it('sends a typed value, with the untouched field as it showed', async () => {
    useTasStore.getState().setOvertimeField(rowOf('E1'), 'simples', 10);
    approve('E2');
    mockSubmitTas.mockResolvedValue({ jobId: 'job-override' });
    render(<ReviewScreen />);
    await clickEnviar();

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E1: { horasExtrasSimples: 10, horasExtrasDobles: 0 }, E2: both.E2,
    }, {}));
  });

  it('asks before sending overtime nobody approved, lists it, and sends it as zero', async () => {
    mockSubmitTas.mockResolvedValue({ jobId: 'job-zero' });
    render(<ReviewScreen />);
    await clickEnviar();

    const dialog = screen.getByRole('dialog', { name: 'Horas extra sin revisar' });
    expect(within(dialog).getByText('2 empleados se enviarán con 0 horas extra')).toBeInTheDocument();
    expect(within(dialog).getByText('E1 Ana López')).toBeInTheDocument();
    expect(within(dialog).getByText('calc. 2.00 simples · 0.00 dobles')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Volver a revisar' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Volver a revisar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockSubmitTas).not.toHaveBeenCalled();

    await clickEnviar();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar de todas formas' }));
    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E1: { horasExtrasSimples: 0, horasExtrasDobles: 0 }, E2: { horasExtrasSimples: 0, horasExtrasDobles: 0 },
    }, {}));
  });

  it('a typed zero is a decision: the confirm only lists rows nobody looked at', async () => {
    useTasStore.getState().setOvertimeField(rowOf('E1'), 'simples', 0);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-z' });
    render(<ReviewScreen />);
    await clickEnviar();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1 empleado se enviará con 0 horas extra')).toBeInTheDocument();
    expect(within(dialog).queryByText('E1 Ana López')).not.toBeInTheDocument();
  });

  it('lists an approval the calculation no longer matches, and a hand value made before it changed', async () => {
    approve('E1');
    useTasStore.getState().setOvertimeField(rowOf('E2'), 'dobles', 0.5);
    useTasStore.getState().setResolvedRows([{ ...rows[0], horasExtrasSimples: 5 }, { ...rows[1], horasExtrasDobles: 3 }]);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-c' });
    render(<ReviewScreen />);
    await clickEnviar();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1 empleado se enviará con 0 horas extra')).toBeInTheDocument();
    expect(within(dialog).getByText('1 ajuste se enviará como se escribió, aunque el cálculo cambió')).toBeInTheDocument();
    expect(within(dialog).getAllByText('· el cálculo cambió')).toHaveLength(2);
    expect(within(dialog).getByText('se envía 0.00 simples · 0.50 dobles · calc. ahora 0.00 simples · 3.00 dobles')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar de todas formas' }));
    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E1: { horasExtrasSimples: 0, horasExtrasDobles: 0 }, E2: { horasExtrasSimples: 0, horasExtrasDobles: 0.5 },
    }, {}));
  });

  it('a stashed decision is not sent: the row is back to unapproved', async () => {
    approve('E1', 'E2');
    useTasStore.getState().stashOvertimeDecision('E1');
    mockSubmitTas.mockResolvedValue({ jobId: 'job-stashed' });
    render(<ReviewScreen />);
    await clickEnviar();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar de todas formas' }));

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E1: { horasExtrasSimples: 0, horasExtrasDobles: 0 }, E2: both.E2,
    }, {}));
  });

  it('sends diasNoLaborados overrides in submit payload', async () => {
    approve('E1', 'E2');
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-dias' });
    render(<ReviewScreen />);
    await clickEnviar();

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', both, { E1: 3 }));
  });

  it('only sends the decisions of the fortnight being reviewed', async () => {
    const q1 = { anio: 2026, mes: 3, numeroDequincena: 1 };
    useTasStore.getState().setSelectedPeriod({ ...q1, numeroDequincena: 2 });
    useTasStore.getState().setOvertimeField(rowOf('E1'), 'simples', 9);
    useTasStore.getState().setNonWorkedDaysOverride('E1', 4);
    useTasStore.getState().setSelectedPeriod(q1);
    approve('E1', 'E2');
    mockSubmitTas.mockResolvedValue({ jobId: 'job-q' });
    render(<ReviewScreen />);
    await clickEnviar();

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', both, {}));
  });
});

describe('ReviewScreen error display', () => {
  it('renders the generic error message from a failed submit as a toast', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    approve('E1', 'E2');
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
    approve('E1', 'E2');
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

  it('still sends a duplicate\'s overtime, since the job decides duplicates, but does not ask about it', async () => {
    mockCheckDuplicates.mockResolvedValue(['E1']);
    useTasStore.getState().setOvertimeField(rowOf('E2'), 'dobles', 5);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-dup' });

    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByText(/1 excluidos/i)).toBeInTheDocument());
    await clickEnviar();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E1: { horasExtrasSimples: 0, horasExtrasDobles: 0 }, E2: { horasExtrasSimples: 0, horasExtrasDobles: 5 },
    }, {}));
  });

  it('excludes duplicate employee codes from diasNoLaborados submit payload', async () => {
    mockCheckDuplicates.mockResolvedValue(['E1']);
    useTasStore.getState().setNonWorkedDaysOverride('E1', 2);
    useTasStore.getState().setNonWorkedDaysOverride('E2', 4);
    approve('E2');
    mockSubmitTas.mockResolvedValue({ jobId: 'job-dup-dias' });

    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByText(/1 excluidos/i)).toBeInTheDocument());
    await clickEnviar();

    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E1: { horasExtrasSimples: 0, horasExtrasDobles: 0 }, E2: both.E2,
    }, { E2: 4 }));
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

describe('ReviewScreen incomplete quincena', () => {
  const october: IncompletePeriod = {
    anio: 2026, mes: 10, numeroDequincena: 1,
    periodStart: '2026-10-01', periodEnd: '2026-10-15',
    dataStart: '2026-09-28', dataEnd: '2026-10-11',
    missingWorkingDays: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'],
  };

  const renderReady = async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    approve('E1', 'E2');
    mockSubmitTas.mockResolvedValue({ jobId: 'job-1' });
    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled());
  };

  it('fetches coverage for the upload token on mount', async () => {
    await renderReady();
    expect(mockGetIncompletePeriods).toHaveBeenCalledWith('tok-1');
  });

  it('does not fetch coverage without an upload token', () => {
    render(<ReviewScreen />);
    expect(mockGetIncompletePeriods).not.toHaveBeenCalled();
  });

  it('shows a warning banner naming the missing days', async () => {
    mockGetIncompletePeriods.mockResolvedValue([october]);
    await renderReady();
    expect(await screen.findByText(/quincena incompleta \(octubre 2026 · q1\).*del 12 al 15 de octubre \(4 días laborables\)/i)).toBeInTheDocument();
  });

  it('asks for confirmation before submitting and does not submit on cancel', async () => {
    mockGetIncompletePeriods.mockResolvedValue([october]);
    await renderReady();
    await screen.findByText(/quincena incompleta \(/i);

    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    expect(screen.getByText(/si envía ahora, esos días se registrarán como no laborados/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(screen.queryByText(/si envía ahora/i)).not.toBeInTheDocument();
    expect(mockSubmitTas).not.toHaveBeenCalled();
    expect(useTasStore.getState().tasView).not.toBe('polling');
  });

  it('submits after confirming', async () => {
    mockGetIncompletePeriods.mockResolvedValue([october]);
    await renderReady();
    await screen.findByText(/quincena incompleta \(/i);

    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    fireEvent.click(screen.getByRole('button', { name: /enviar de todas formas/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('polling'));
    expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', both, {});
  });

  it('asks about the incomplete fortnight first, then about overtime nobody approved', async () => {
    mockGetIncompletePeriods.mockResolvedValue([october]);
    await renderReady();
    act(() => useTasStore.getState().clearOvertimeDecision('E1'));
    await screen.findByText(/quincena incompleta \(/i);

    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    expect(screen.queryByRole('dialog', { name: 'Horas extra sin revisar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /enviar de todas formas/i }));
    expect(screen.getByRole('dialog', { name: 'Horas extra sin revisar' })).toBeInTheDocument();
    expect(mockSubmitTas).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /enviar de todas formas/i }));
    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith('tok-1', {
      E1: { horasExtrasSimples: 0, horasExtrasDobles: 0 }, E2: both.E2,
    }, {}));
  });

  it('submits without confirmation when the file covers the quincena', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('polling'));
    expect(screen.queryByText(/quincena incompleta/i)).not.toBeInTheDocument();
  });

  it('shows an error toast and asks for confirmation when the coverage check fails', async () => {
    mockGetIncompletePeriods.mockRejectedValue(new Error('boom'));
    await renderReady();
    expect(useToastStore.getState().toasts.map(t => t.message))
      .toContain('No se pudo verificar que el archivo cubra la quincena completa.');

    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    expect(screen.getByText('Quincena sin verificar')).toBeInTheDocument();
    expect(mockSubmitTas).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /enviar de todas formas/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('polling'));
  });

  it('keeps Enviar disabled until the coverage check answers', async () => {
    let resolve!: (v: IncompletePeriod[]) => void;
    mockGetIncompletePeriods.mockReturnValue(new Promise(r => { resolve = r; }));
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    render(<ReviewScreen />);
    await waitFor(() => expect(mockCheckDbHealth).toHaveBeenCalled());
    await act(async () => {});

    expect(screen.getByRole('button', { name: /^enviar$/i })).toBeDisabled();
    await act(async () => { resolve([october]); });
    await waitFor(() => expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled());
  });

  it('focuses Cancelar in the confirmation so Enter does not submit', async () => {
    mockGetIncompletePeriods.mockResolvedValue([october]);
    await renderReady();
    await screen.findByText(/quincena incompleta \(/i);

    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    const cancel = screen.getByRole('button', { name: /cancelar/i });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Enter' });
    expect(mockSubmitTas).not.toHaveBeenCalled();
  });

  it('ignores a coverage result that arrives after unmount', async () => {
    let resolve!: (v: IncompletePeriod[]) => void;
    mockGetIncompletePeriods.mockReturnValue(new Promise(r => { resolve = r; }));
    useTasStore.getState().setUploadToken('tok-1');
    const { unmount } = render(<ReviewScreen />);
    unmount();
    await act(async () => { resolve([october]); });
    expect(screen.queryByText(/quincena incompleta/i)).not.toBeInTheDocument();
  });

  it('ignores a coverage failure that arrives after unmount', async () => {
    let reject!: (e: Error) => void;
    mockGetIncompletePeriods.mockReturnValue(new Promise((_, r) => { reject = r; }));
    useTasStore.getState().setUploadToken('tok-1');
    const { unmount } = render(<ReviewScreen />);
    unmount();
    await act(async () => { reject(new Error('late')); });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('ReviewScreen printing', () => {
  const printRows: ResolvedRow[] = [
    { ...rows[0], mes: 6 },
    { ...rows[1], mes: 6, fechasNoLaboradas: ['2026-06-03'] },
  ];

  async function renderWithRows(duplicates: string[] = []) {
    mockCheckDuplicates.mockResolvedValue(duplicates);
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(printRows);
    useTasStore.getState().setSessionSummaries(sessionSummaries);
    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Imprimir…' })).not.toBeDisabled());
  }

  afterEach(() => { vi.restoreAllMocks(); });

  it('prints the chosen report with the manual adjustments, then removes it', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(screen.getByTestId('print-report')).toBeInTheDocument();
    });
    await renderWithRows();
    act(() => {
      useTasStore.getState().setOvertimeField(rowOf('E1'), 'simples', 3);
      approve('E2');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir…' }));
    expect(screen.getByText(/Incluye 2 empleados a enviar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /^Resumen y detalle/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));

    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const report = screen.getByTestId('print-report');
    expect(within(report).getByRole('region', { name: 'Detalle E1 Ana López' })).toBeInTheDocument();
    expect(within(report).getByText('Total · 2 empleados').parentElement).toHaveTextContent('3.00');

    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(screen.queryByTestId('print-report')).not.toBeInTheDocument();
  });

  it('leaves duplicates out of the count and the report', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    await renderWithRows(['E2']);
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir…' }));
    expect(screen.getByText(/Incluye 1 empleado a enviar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    const report = screen.getByTestId('print-report');
    expect(within(report).getByText('1 a enviar · 1 excluido')).toBeInTheDocument();
    expect(within(report).queryByText('Detalle por empleado')).not.toBeInTheDocument();
  });

  it('closes the dialog without printing on Cancelar', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await renderWithRows();
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
  });

  it('prints the same employees and figures that submit sends', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    mockSubmitTas.mockResolvedValue({ jobId: 'job-1' });
    const three: ResolvedRow[] = [
      { ...printRows[0], codigoEmpleado: 'E1', horasExtrasSimples: 0.5 },
      { ...printRows[1], codigoEmpleado: 'E2', accruesOvertime: false, horasExtrasDobles: 0 },
      { ...printRows[0], codigoEmpleado: 'E3', nombreEmpleado: 'Dup' },
    ];
    mockCheckDuplicates.mockResolvedValue(['E3']);
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(three);
    useTasStore.getState().setSessionSummaries(sessionSummaries);
    useTasStore.getState().setOvertimeField(rowOf('E1'), 'simples', 4);
    useTasStore.getState().setOvertimeField(rowOf('E2'), 'simples', 9);
    useTasStore.getState().setOvertimeField(rowOf('E3'), 'simples', 7);
    useTasStore.getState().setNonWorkedDaysOverride('E3', 5);
    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Imprimir…' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    const summary = within(screen.getByTestId('print-report')).getAllByRole('table')[0];
    expect(within(summary).getAllByRole('row').slice(1).map(r => r.textContent)).toEqual([
      'E1Ana López04.000.00Ajustado',
      'E2Luis García10.000.00No acumula extras',
      'Total · 2 empleados14.000.00',
    ]);

    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    // E2 does not accrue, so nothing is sent for it; the duplicate E3 still carries its value to the job, which skips it.
    await waitFor(() => expect(mockSubmitTas).toHaveBeenCalledWith(
      'tok-1', { E1: { horasExtrasSimples: 4, horasExtrasDobles: 0 }, E3: { horasExtrasSimples: 7, horasExtrasDobles: 0 } }, {}));
  });

  it('opens the print dialog once under StrictMode', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    mockCheckDuplicates.mockResolvedValue([]);
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(printRows);
    render(<StrictMode><ReviewScreen /></StrictMode>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Imprimir…' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('cannot print until the fortnight coverage is known, then warns if it could not be checked', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    let reject!: (e: Error) => void;
    mockGetIncompletePeriods.mockReturnValue(new Promise((_, r) => { reject = r; }));
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(printRows);
    render(<ReviewScreen />);
    await waitFor(() => expect(mockCheckDuplicates).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Imprimir…' })).toBeDisabled();

    await act(async () => { reject(new Error('down')); });
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(within(screen.getByTestId('print-report')).getByText(/No se pudo verificar que el archivo cubra/)).toBeInTheDocument();
  });

  it('cannot print while duplicates are still being checked, nor with nothing to send', async () => {
    let resolve!: (v: string[]) => void;
    mockCheckDuplicates.mockReturnValue(new Promise(r => { resolve = r; }));
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(printRows);
    render(<ReviewScreen />);
    expect(screen.getByRole('button', { name: 'Imprimir…' })).toBeDisabled();
    await act(async () => { resolve(['E1', 'E2']); });
    expect(screen.getByRole('button', { name: 'Imprimir…' })).toBeDisabled();
  });
});
