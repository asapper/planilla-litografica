import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { useTasStore } from './tasStore';

const mockCheckHealth = vi.hoisted(() => vi.fn());
const mockCheckDbHealth = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  checkHealth: mockCheckHealth,
  checkDbHealth: mockCheckDbHealth,
}));

const mockUploadTasFile = vi.hoisted(() => vi.fn());

vi.mock('./tasApi', () => ({
  uploadTasFile: mockUploadTasFile,
}));

vi.mock('./components/EmptyState', () => ({
  default: ({ onTasFile }: { onTasFile: (file: File) => void }) => (
    <div data-testid="empty-state">
      <button onClick={() => onTasFile(new File(['x'], 'scans.csv'))}>
        Cargar TAS
      </button>
    </div>
  ),
}));
vi.mock('./components/TopAppBar', () => ({
  default: ({ tasView, onNewUpload }: { tasView: string; onNewUpload: () => void }) => {
    const [showConfirm, setShowConfirm] = useState(false);
    return (
      <div data-testid="top-app-bar">
        {tasView !== 'idle' && (
          <>
            <button onClick={() => setShowConfirm(true)}>Nueva carga</button>
            {showConfirm && (
              <button
                onClick={() => {
                  setShowConfirm(false);
                  onNewUpload();
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
  default: () => <div data-testid="tas-upload-flow" />,
}));
vi.mock('./components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { default: App } = await import('./App');

beforeEach(() => {
  useTasStore.getState().resetTas();
  mockCheckHealth.mockResolvedValue(undefined);
  mockCheckDbHealth.mockResolvedValue(true);
  mockUploadTasFile.mockResolvedValue({
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
