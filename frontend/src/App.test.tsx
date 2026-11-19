import { useState } from 'react';
import axios from 'axios';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { useTasStore } from './tasStore';
import { useToastStore } from './toastStore';
import { DRAFT_UI_VERSION } from './tasDraft';
import { loadLocalCopy, startLocalCopy } from './localCopy';
import type { TasSession } from './tasTypes';

const mockCheckHealth = vi.hoisted(() => vi.fn());
const mockCheckDbHealth = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  checkHealth: mockCheckHealth,
  checkDbHealth: mockCheckDbHealth,
}));

const mockGetBackendStatus = vi.hoisted(() => vi.fn());

vi.mock('./backendStatus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backendStatus')>()),
  getBackendStatus: mockGetBackendStatus,
}));

const mockUploadTasFile = vi.hoisted(() => vi.fn());
const mockGetDraftSummary = vi.hoisted(() => vi.fn());
const mockResumeDraft = vi.hoisted(() => vi.fn());
const mockDeleteDraft = vi.hoisted(() => vi.fn());
const mockSaveDraft = vi.hoisted(() => vi.fn());
const mockSubmitInactiveReview = vi.hoisted(() => vi.fn());

vi.mock('./tasApi', () => ({
  uploadTasFile: mockUploadTasFile,
  getDraftSummary: mockGetDraftSummary,
  resumeDraft: mockResumeDraft,
  deleteDraft: mockDeleteDraft,
  saveDraft: mockSaveDraft,
  submitInactiveReview: mockSubmitInactiveReview,
}));

vi.mock('./components/EmptyState', () => ({
  default: ({ onTasFile, draft, onContinueDraft, onDiscardDraft }: {
    onTasFile: (file: File) => void;
    draft: { fileName: string | null; jobActive: boolean; resumable: boolean } | null;
    onContinueDraft: () => void;
    onDiscardDraft: () => void;
  }) => (
    <div data-testid="empty-state">
      <button onClick={() => onTasFile(new File(['x'], 'scans.csv'))}>
        Cargar TAS
      </button>
      {draft && (
        <div data-testid="draft-card">
          <span>{draft.fileName}</span>
          {draft.jobActive && <span>Envío en curso</span>}
          {!draft.resumable && <span>Otra versión</span>}
          <button onClick={onContinueDraft}>Continuar</button>
          <button onClick={onDiscardDraft}>Descartar</button>
        </div>
      )}
    </div>
  ),
}));
vi.mock('./components/TopAppBar', () => ({
  default: function MockTopAppBar({ tasView, currentView, onNewUpload, onDiscardSession, onViewChange }: {
    tasView: string;
    currentView: string;
    onNewUpload: () => void;
    onDiscardSession: () => void;
    onViewChange: (v: string) => void;
  }) {
    const [showConfirm, setShowConfirm] = useState(false);
    return (
      <div data-testid="top-app-bar">
        <button onClick={() => onViewChange('config')}>Configuración</button>
        {currentView === 'config' && tasView === 'idle' && (
          <button onClick={onNewUpload}>Nueva carga (config)</button>
        )}
        {tasView !== 'idle' && (
          <>
            <button onClick={() => setShowConfirm(true)}>Nueva carga</button>
            {showConfirm && (
              <button
                onClick={() => {
                  setShowConfirm(false);
                  onDiscardSession();
                }}
              >
                Sí, descartar
              </button>
            )}
          </>
        )}
      </div>
    );
  },
}));
vi.mock('./components/ConfigPage', () => ({
  default: () => <div data-testid="config-page" />,
}));
vi.mock('./components/tas/TasUploadFlow', () => ({
  default: ({ fileName }: { fileName: string }) => <div data-testid="tas-upload-flow">{fileName}</div>,
}));
vi.mock('./components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const {
  default: App, LOCAL_RECOVERED_MESSAGE, LOCAL_RECOVERED_REVIEW_MESSAGE, LOCAL_RECOVERY_FAILED_MESSAGE,
} = await import('./App');

beforeEach(() => {
  localStorage.clear();
  useTasStore.getState().resetTas();
  useToastStore.setState({ toasts: [] });
  mockGetDraftSummary.mockReset().mockResolvedValue(null);
  mockResumeDraft.mockReset();
  mockDeleteDraft.mockReset().mockResolvedValue(undefined);
  mockSaveDraft.mockReset().mockResolvedValue(undefined);
  mockCheckHealth.mockResolvedValue(undefined);
  mockCheckDbHealth.mockResolvedValue(true);
  mockGetBackendStatus.mockResolvedValue(null);
  mockUploadTasFile.mockReset().mockResolvedValue({
    uploadToken: 'token-1',
    flaggedSessions: [],
    resolvedRows: [],
    inactiveEmployeesFound: [],
    absentActiveEmployees: [],
    usedFallbackHolidays: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startup', () => {
  it('shows starting screen while health check is pending', () => {
    mockCheckHealth.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('Iniciando aplicación...')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('transitions to app after health check passes', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    );
    expect(screen.queryByText('Iniciando aplicación...')).not.toBeInTheDocument();
  });

  it('shows error screen after max failed retries', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockRejectedValue(new Error('connection refused'));
    render(<App />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByText(/no se pudo conectar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });

  it('stops polling and explains a blocked port reported by the shell', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockRejectedValue(new Error('connection refused'));
    mockGetBackendStatus.mockResolvedValue({ state: 'port_blocked', port: 41301 });
    mockCheckHealth.mockClear();
    render(<App />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByText(/otro programa esté usando el puerto 41301/i)).toBeInTheDocument();
    expect(screen.getByText(/vuelva a abrir la aplicación/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
    expect(mockCheckHealth).toHaveBeenCalledTimes(1);
  });

  it('explains an early backend exit with its exit code', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockRejectedValue(new Error('connection refused'));
    mockGetBackendStatus.mockResolvedValue({ state: 'exited', exitCode: 1 });
    render(<App />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByText(/se detuvo inesperadamente al iniciar \(código 1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/\.planilla\\logs/)).toBeInTheDocument();
  });

  it('omits the exit code when the shell has none', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockRejectedValue(new Error('connection refused'));
    mockGetBackendStatus.mockResolvedValue({ state: 'exited', exitCode: null });
    render(<App />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByText('El servicio se detuvo inesperadamente al iniciar.')).toBeInTheDocument();
  });

  it('keeps polling while the shell reports the backend as running', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockRejectedValueOnce(new Error('not ready')).mockResolvedValue(undefined);
    mockGetBackendStatus.mockResolvedValue({ state: 'running' });
    render(<App />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('does not schedule another poll when the status arrives after unmount', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockRejectedValue(new Error('connection refused'));
    let resolveStatus: (s: unknown) => void = () => {};
    mockGetBackendStatus.mockReturnValue(new Promise(r => { resolveStatus = r; }));
    const { unmount } = render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockGetBackendStatus).toHaveBeenCalled();
    unmount();
    await act(async () => { resolveStatus(null); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a hint message after several failed health attempts', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockRejectedValue(new Error('not ready'));

    render(<App />);
    expect(screen.getByText('Iniciando aplicación...')).toBeInTheDocument();
    expect(screen.queryByText(/Esto puede tomar/)).not.toBeInTheDocument();

    // advanceTimersByTimeAsync flushes pending async poll() chains too
    for (let i = 0; i < 4; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    }

    expect(screen.getByText(/Esto puede tomar hasta 20 segundos/)).toBeInTheDocument();
  });

  it('retry button resets to starting state then transitions to app on success', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockRejectedValue(new Error('connection refused'));
    render(<App />);
    await act(async () => { await vi.runAllTimersAsync(); });

    mockCheckHealth.mockResolvedValue(undefined);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByText(/no se pudo conectar/i)).not.toBeInTheDocument();
  });
});

describe('db-health banner', () => {
  it('shows no banner when PostgreSQL is reachable', async () => {
    mockCheckDbHealth.mockResolvedValue(true);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByText(/base de datos no disponible/i)).not.toBeInTheDocument();
  });

  it('shows permanent error banner when PostgreSQL is unreachable', async () => {
    mockCheckDbHealth.mockResolvedValue(false);
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/base de datos no disponible/i)).toBeInTheDocument()
    );
  });

  it('suppresses the global banner on the review screen, where ReviewScreen owns its own indicator', async () => {
    mockCheckDbHealth.mockResolvedValue(false);
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/base de datos no disponible/i)).toBeInTheDocument()
    );
    act(() => { useTasStore.getState().setTasView('review'); });
    expect(screen.queryByText(/base de datos no disponible/i)).not.toBeInTheDocument();
  });

  it('clears banner when DB recovers on the next periodic poll', async () => {
    vi.useFakeTimers();
    mockCheckDbHealth.mockResolvedValue(false);
    render(<App />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByText(/base de datos no disponible/i)).toBeInTheDocument();

    mockCheckDbHealth.mockResolvedValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.queryByText(/base de datos no disponible/i)).not.toBeInTheDocument();
  });
});

describe('App view routing', () => {
  it('shows EmptyState and TopAppBar in the default tas/idle view', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.getByTestId('top-app-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('config-page')).not.toBeInTheDocument();
  });

  it('shows TasUploadFlow after a TAS file is processed', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() => expect(screen.getByTestId('tas-upload-flow')).toBeInTheDocument());
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });
});

describe('TAS multi-period upload routing', () => {
  it('routes to verification when upload has multiple available periods even with no flagged sessions', async () => {
    mockUploadTasFile.mockResolvedValue({
      uploadToken: 'tok-1',
      flaggedSessions: [],
      resolvedRows: [],
      inactiveEmployeesFound: [],
      absentActiveEmployees: [],
      usedFallbackHolidays: false,
      warnings: [],
      availablePeriods: [
        { anio: 2026, mes: 4, numeroDequincena: 1 },
        { anio: 2026, mes: 4, numeroDequincena: 2 },
      ],
    });

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('verification'));
  });

  it('stores availablePeriods after a successful upload', async () => {
    mockUploadTasFile.mockResolvedValue({
      uploadToken: 'tok-1',
      flaggedSessions: [],
      resolvedRows: [],
      inactiveEmployeesFound: [],
      absentActiveEmployees: [],
      usedFallbackHolidays: false,
      warnings: [],
      availablePeriods: [{ anio: 2026, mes: 3, numeroDequincena: 1 }],
    });

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() =>
      expect(useTasStore.getState().availablePeriods).toEqual([
        { anio: 2026, mes: 3, numeroDequincena: 1 },
      ])
    );
  });

  it('stores availableShifts after a successful upload', async () => {
    const shifts = [{ id: 'noche', name: 'Noche', startTime: '19:00', endTime: '07:00', crossMidnight: true }];
    mockUploadTasFile.mockResolvedValue({
      uploadToken: 'tok-1',
      flaggedSessions: [],
      resolvedRows: [],
      inactiveEmployeesFound: [],
      absentActiveEmployees: [],
      usedFallbackHolidays: false,
      warnings: [],
      availablePeriods: [{ anio: 2026, mes: 3, numeroDequincena: 1 }],
      availableShifts: shifts,
    });

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() => expect(useTasStore.getState().availableShifts).toEqual(shifts));
  });
});

describe('TAS Nueva carga redirect', () => {
  it('returns to the upload screen after the TAS session is reset', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();

    act(() => useTasStore.getState().resetTas());

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });
});

describe('TAS upload error handling', () => {
  it('surfaces backend error message on upload failure', async () => {
    const axiosError = {
      isAxiosError: true,
      response: { status: 400, data: { code: 'UPLOAD_FAILED', message: 'Columnas requeridas no encontradas: [Fecha y hora].' } },
    };
    Object.defineProperty(axiosError, 'isAxiosError', { value: true });
    mockUploadTasFile.mockRejectedValue(axiosError);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() =>
      expect(useTasStore.getState().error).toBe('Columnas requeridas no encontradas: [Fecha y hora].')
    );
  });

  it('falls back to generic message when backend error has no message', async () => {
    mockUploadTasFile.mockRejectedValue(new Error('Network Error'));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() =>
      expect(useTasStore.getState().error).toBe('Ocurrió un error al procesar el archivo. Intente nuevamente.')
    );
  });
});

describe('upload error handling — view recovery', () => {
  it('returns to idle view on upload failure so the user can retry', async () => {
    mockCheckHealth.mockResolvedValue(undefined);
    mockUploadTasFile.mockRejectedValue(new Error('network failure'));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    await act(async () => {
      screen.getByRole('button', { name: /Cargar TAS/i }).click();
    });

    // After error: should return to empty-state (idle), not stay in TasUploadFlow
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('tas-upload-flow')).not.toBeInTheDocument();
  });
});

describe('upload processing stage messages', () => {
  it('sets processingMessage to first stage label immediately on upload start', async () => {
    vi.useFakeTimers();
    mockUploadTasFile.mockReturnValue(new Promise(() => {}));

    render(<App />);
    await act(async () => {});
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));
    });

    expect(useTasStore.getState().processingMessage).toBe('Leyendo el archivo...');
  });

  it('advances processingMessage to the second stage label after 5 seconds', async () => {
    vi.useFakeTimers();
    mockUploadTasFile.mockReturnValue(new Promise(() => {}));

    render(<App />);
    await act(async () => {});
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(useTasStore.getState().processingMessage).toBe('Verificando empleados...');
  });

  it('stops advancing processingMessage after upload completes', async () => {
    vi.useFakeTimers();
    mockUploadTasFile.mockResolvedValue({
      uploadToken: 'tok',
      flaggedSessions: [],
      resolvedRows: [],
      inactiveEmployeesFound: [],
      absentActiveEmployees: [],
      usedFallbackHolidays: false,
    });

    render(<App />);
    await act(async () => {});
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));
      await vi.advanceTimersByTimeAsync(100);
    });

    const messageAtCompletion = useTasStore.getState().processingMessage;

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });

    expect(useTasStore.getState().processingMessage).toBe(messageAtCompletion);
  });

  it('self-clears after all stage messages are exhausted with upload still pending', async () => {
    vi.useFakeTimers();
    mockUploadTasFile.mockReturnValue(new Promise(() => {}));

    render(<App />);
    await act(async () => {});
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));
    });

    // Advance through all 6 stage messages (5 intervals × 5 000 ms each)
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 5000); });
    expect(useTasStore.getState().processingMessage).toBe('Casi listo...');

    // Interval should have self-cleared — advancing further must not change the message
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(useTasStore.getState().processingMessage).toBe('Casi listo...');
  });

  it('stops advancing processingMessage after upload fails', async () => {
    vi.useFakeTimers();
    mockUploadTasFile.mockRejectedValue(new Error('network failure'));

    render(<App />);
    await act(async () => {});
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));
      await vi.advanceTimersByTimeAsync(100);
    });

    const messageAtCompletion = useTasStore.getState().processingMessage;

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });

    expect(useTasStore.getState().processingMessage).toBe(messageAtCompletion);
  });
});

describe('Top bar Nueva carga button', () => {
  it('resets the session and returns to the upload screen when confirmed', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });
});

describe('resume an interrupted session', () => {
  const summary = {
    fileName: '1era quincena octubre 2026.csv',
    view: 'review',
    periodLabel: 'Octubre 2026 - Quincena 1',
    savedAt: '2026-11-16T20:20:00Z',
    partialSubmit: false,
    resumable: true,
    uiVersion: DRAFT_UI_VERSION,
    jobActive: false,
  };
  const period = { anio: 2026, mes: 10, numeroDequincena: 2 };

  it('fetches the saved session once the backend is ready and shows the card', async () => {
    mockGetDraftSummary.mockResolvedValue(summary);
    render(<App />);
    expect(await screen.findByTestId('draft-card')).toHaveTextContent('1era quincena octubre 2026.csv');
  });

  it('shows no card when the summary request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetDraftSummary.mockRejectedValue(new Error('down'));
    render(<App />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByTestId('draft-card')).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it('Continuar restores the snapshot, the file name and the step', async () => {
    mockGetDraftSummary.mockResolvedValue(summary);
    mockResumeDraft.mockResolvedValue({
      uploadToken: 'tok-d',
      ui: {
        uiVersion: DRAFT_UI_VERSION,
        tasView: 'review',
        uploadToken: 'tok-d',
        stateRevision: 3,
        availablePeriods: [{ anio: 2026, mes: 10, numeroDequincena: 1 }, period],
        selectedPeriod: period,
        overtimeOverrides: { E1: { horasExtrasSimples: 2 } },
        jobId: 'stale',
      },
    });
    useTasStore.setState({ jobId: 'old-job' });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));
    const s = useTasStore.getState();
    expect(s.uploadToken).toBe('tok-d');
    expect(s.stateRevision).toBe(3);
    expect(s.selectedPeriod).toEqual(period);
    expect(s.overtimeOverrides).toEqual({ E1: { horasExtrasSimples: 2 } });
    expect(s.jobId).toBeNull();
    expect(screen.getByTestId('tas-upload-flow')).toHaveTextContent('1era quincena octubre 2026.csv');
  });

  it('shows the error toast, hides the card and stays idle when resume fails', async () => {
    mockGetDraftSummary.mockResolvedValue(summary);
    mockResumeDraft.mockRejectedValue(new Error('404'));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));

    await waitFor(() => expect(useToastStore.getState().toasts.map(t => t.message))
      .toContain('No se pudo recuperar la sesión anterior.'));
    expect(screen.queryByTestId('draft-card')).not.toBeInTheDocument();
    expect(useTasStore.getState().tasView).toBe('idle');
  });

  it.each([
    ['another', DRAFT_UI_VERSION + 1],
    ['no', undefined],
  ])('keeps the card as not resumable when the resumed snapshot has %s UI version', async (_, uiVersion) => {
    mockGetDraftSummary.mockResolvedValue(summary);
    mockResumeDraft.mockResolvedValue({ uploadToken: 'tok-d', ui: { uiVersion, tasView: 'review', stateRevision: 3 } });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Otra versión')).toBeInTheDocument();
    expect(useTasStore.getState().tasView).toBe('idle');
    expect(useTasStore.getState().uploadToken).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('keeps the card as not resumable when the backend answers DRAFT_OUTDATED', async () => {
    mockGetDraftSummary.mockResolvedValue(summary);
    mockResumeDraft.mockRejectedValue(new axios.AxiosError('409', undefined, undefined, undefined, {
      status: 409, data: { code: 'DRAFT_OUTDATED', message: 'otra versión' },
    } as never));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Otra versión')).toBeInTheDocument();
    expect(screen.getByTestId('draft-card')).toBeInTheDocument();
    expect(useTasStore.getState().tasView).toBe('idle');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('treats a snapshot with an unknown step as a failed resume', async () => {
    mockGetDraftSummary.mockResolvedValue(summary);
    mockResumeDraft.mockResolvedValue({ uploadToken: 'tok-d', ui: { uiVersion: DRAFT_UI_VERSION, tasView: 'polling' } });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));

    await waitFor(() => expect(useToastStore.getState().toasts.map(t => t.message))
      .toContain('No se pudo recuperar la sesión anterior.'));
    expect(useTasStore.getState().tasView).toBe('idle');
  });

  it('Descartar deletes the draft and hides the card', async () => {
    mockGetDraftSummary.mockResolvedValue(summary);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));

    expect(mockDeleteDraft).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByTestId('draft-card')).not.toBeInTheDocument());
  });

  it('Descartar still hides the card when the delete fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetDraftSummary.mockResolvedValue(summary);
    mockDeleteDraft.mockRejectedValue(new Error('down'));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByTestId('draft-card')).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it('a failed upload returns to idle and shows the card again', async () => {
    mockGetDraftSummary.mockResolvedValue(summary);
    mockUploadTasFile.mockRejectedValue(new Error('network'));
    render(<App />);
    await screen.findByTestId('draft-card');

    fireEvent.click(screen.getByRole('button', { name: /cargar tas/i }));

    await waitFor(() => expect(mockGetDraftSummary).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('draft-card')).toBeInTheDocument();
  });

  it('re-fetches the summary whenever the session returns to idle', async () => {
    render(<App />);
    await waitFor(() => expect(mockGetDraftSummary).toHaveBeenCalledTimes(1));
    act(() => { useTasStore.getState().setTasView('result'); });
    mockGetDraftSummary.mockResolvedValue({ ...summary, partialSubmit: true });

    act(() => { useTasStore.getState().resetTas(); });

    await waitFor(() => expect(mockGetDraftSummary).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('draft-card')).toBeInTheDocument();
  });

  it('re-polls while a submission is in progress and stops when it ends', async () => {
    vi.useFakeTimers();
    mockGetDraftSummary
      .mockResolvedValueOnce({ ...summary, jobActive: true })
      .mockResolvedValue({ ...summary, jobActive: false });
    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Envío en curso')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });

    expect(mockGetDraftSummary).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Envío en curso')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mockGetDraftSummary).toHaveBeenCalledTimes(2);
  });

  it('records the upload stateRevision and autosaves the session with its file name', async () => {
    mockUploadTasFile.mockResolvedValue({
      uploadToken: 'tok-up',
      stateRevision: 1,
      flaggedSessions: [],
      resolvedRows: [],
      inactiveEmployeesFound: [],
      absentActiveEmployees: [],
      usedFallbackHolidays: false,
      warnings: [],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /cargar tas/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));
    expect(useTasStore.getState().stateRevision).toBe(1);

    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalled(), { timeout: 2_000 });
    expect(mockSaveDraft.mock.calls[0][0]).toMatchObject({
      uploadToken: 'tok-up', stateRevision: 1, fileName: 'scans.csv', view: 'review',
    });
  });

  it('the confirmed Nueva carga deletes the draft before resetting', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /cargar tas/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));

    fireEvent.click(screen.getByRole('button', { name: /^nueva carga$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('idle'));
    expect(mockDeleteDraft).toHaveBeenCalledOnce();
  });

  it('the config-page Nueva carga only navigates and keeps the draft', async () => {
    mockGetDraftSummary.mockResolvedValue(summary);
    render(<App />);
    await screen.findByTestId('draft-card');

    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva carga (config)' }));

    expect(await screen.findByTestId('draft-card')).toBeInTheDocument();
    expect(mockDeleteDraft).not.toHaveBeenCalled();
  });
});

describe('rebuild from the copy on this PC', () => {
  const SCANS = ['2026-10-03T07:02:00'];
  const day = (sessionId: number): TasSession => ({
    sessionId, employeeId: 'E1', employeeName: 'Ana', date: '2026-10-03', scans: SCANS, matchedShiftId: 'm',
    matchedShiftName: 'Mañana', assignedShiftId: 'm', assignedShiftName: 'Mañana', effectiveStart: SCANS[0],
    lastScan: null, workedMinutes: 0, workedHours: 0, crossMidnight: false, needsResolution: true, flags: ['MISSING_EXIT'],
  });
  const keepCopy = (snapshot: Record<string, unknown> = {}) => startLocalCopy('oct.csv', new Uint8Array([0x6f, 0x6b]), {
    tasView: 'verification', flaggedSessions: [day(1)], cardInputs: { 1: { entry: '07:02', exit: '15:', swapped: false } },
    ...snapshot,
  });
  const rebuilt = { uploadToken: 'tok-r', stateRevision: 1, flaggedSessions: [day(10)], resolvedRows: [],
    inactiveEmployeesFound: [], absentActiveEmployees: [], usedFallbackHolidays: false, availablePeriods: [] };
  const toasts = () => useToastStore.getState().toasts.map(t => [t.variant, t.message]);

  it('an upload keeps a copy of the file on this PC', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /cargar tas/i }));
    await waitFor(() => expect(loadLocalCopy()?.fileName).toBe('scans.csv'));
    expect(atob(loadLocalCopy()!.fileBase64)).toBe('x');
  });

  it('is offered when the backend has no saved session, and Continuar rebuilds it with its decisions', async () => {
    keepCopy();
    mockUploadTasFile.mockResolvedValue(rebuilt);
    render(<App />);
    expect(await screen.findByTestId('draft-card')).toHaveTextContent('oct.csv');

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('verification'));
    expect(mockUploadTasFile.mock.calls[0][0].name).toBe('oct.csv');
    expect(useTasStore.getState().cardInputs).toEqual({ 10: { entry: '07:02', exit: '15:', swapped: false } });
    expect(toasts()).toEqual([['success', LOCAL_RECOVERED_MESSAGE]]);
  });

  it('is offered when the backend cannot even be asked (its database is down)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    keepCopy();
    mockGetDraftSummary.mockRejectedValue(new Error('down'));
    render(<App />);
    expect(await screen.findByTestId('draft-card')).toHaveTextContent('oct.csv');
    warn.mockRestore();
  });

  it('replaces a backend session from another version, which could only be discarded', async () => {
    keepCopy({ tasView: 'review' });
    mockGetDraftSummary.mockResolvedValue({ fileName: 'old.csv', view: 'review', periodLabel: null, savedAt: '2026-11-19T10:00:00Z',
      partialSubmit: false, resumable: false, uiVersion: 1, jobActive: false });
    mockUploadTasFile.mockResolvedValue(rebuilt);
    render(<App />);
    const card = await screen.findByTestId('draft-card');
    expect(card).toHaveTextContent('oct.csv');
    expect(card).not.toHaveTextContent('Otra versión');

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(toasts()).toEqual([['success', LOCAL_RECOVERED_REVIEW_MESSAGE]]));
  });

  it('takes over when resuming the backend session fails', async () => {
    keepCopy();
    mockGetDraftSummary.mockResolvedValue({ fileName: 'oct.csv', view: 'verification', periodLabel: null,
      savedAt: '2026-11-19T10:00:00Z', partialSubmit: false, resumable: true, uiVersion: DRAFT_UI_VERSION, jobActive: false });
    mockResumeDraft.mockRejectedValue(new Error('404'));
    mockUploadTasFile.mockResolvedValue(rebuilt);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(useTasStore.getState().uploadToken).toBe('tok-r'));
    expect(toasts()).toEqual([['success', LOCAL_RECOVERED_MESSAGE]]);
  });

  it('takes over when the resumed backend session is from another version', async () => {
    keepCopy();
    mockGetDraftSummary.mockResolvedValue({ fileName: 'oct.csv', view: 'verification', periodLabel: null,
      savedAt: '2026-11-19T10:00:00Z', partialSubmit: false, resumable: true, uiVersion: DRAFT_UI_VERSION, jobActive: false });
    mockResumeDraft.mockResolvedValue({ uploadToken: 'tok-d', ui: { uiVersion: DRAFT_UI_VERSION + 1, tasView: 'verification' } });
    mockUploadTasFile.mockResolvedValue(rebuilt);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(useTasStore.getState().uploadToken).toBe('tok-r'));
  });

  it('a resumable backend session is used first', async () => {
    keepCopy();
    mockGetDraftSummary.mockResolvedValue({ fileName: 'oct.csv', view: 'verification', periodLabel: null,
      savedAt: '2026-11-19T10:00:00Z', partialSubmit: false, resumable: true, uiVersion: DRAFT_UI_VERSION, jobActive: false });
    mockResumeDraft.mockResolvedValue({ uploadToken: 'tok-d', ui: { uiVersion: DRAFT_UI_VERSION, tasView: 'verification', stateRevision: 2 } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(useTasStore.getState().uploadToken).toBe('tok-d'));
    expect(mockUploadTasFile).not.toHaveBeenCalled();
  });

  it('says which decisions could not be carried over', async () => {
    keepCopy({ resolvedSessions: { 1: { resolvedStart: '07:02', resolvedEnd: '15:00' }, 2: { resolvedStart: '07:00', resolvedEnd: '15:00' } } });
    mockUploadTasFile.mockResolvedValue(rebuilt);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(toasts()).toHaveLength(2));
    expect(toasts()[1]).toEqual(['warning', '1 decisión no se pudo recuperar porque esos días cambiaron. Revíselos.']);
  });

  it('a failed rebuild says so and keeps the copy for another try', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    keepCopy();
    mockUploadTasFile.mockRejectedValue(new Error('down'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(toasts()).toEqual([['error', LOCAL_RECOVERY_FAILED_MESSAGE]]));
    expect(useTasStore.getState().tasView).toBe('idle');
    expect(loadLocalCopy()).not.toBeNull();
    warn.mockRestore();
  });

  it('Descartar drops the copy too', async () => {
    keepCopy();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(loadLocalCopy()).toBeNull());
    expect(screen.queryByTestId('draft-card')).not.toBeInTheDocument();
  });
});

