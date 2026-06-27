import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { useTasStore } from './tasStore';

const mockCheckHealth = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  checkHealth: mockCheckHealth,
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
