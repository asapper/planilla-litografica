import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { useStore } from './store';
import type { SubmitResponse } from './types';

// -----------------------------------------------------------------
// Mock api — checkHealth controls startup flow
// -----------------------------------------------------------------
const mockCheckHealth = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  checkHealth:  mockCheckHealth,
  uploadCsv:    vi.fn(),
  validateRows: vi.fn(),
  submitRows:   vi.fn(),
}));

// -----------------------------------------------------------------
// Mock child components
// -----------------------------------------------------------------
vi.mock('./components/EmptyState', () => ({
  default: () => <div data-testid="empty-state" />,
}));
vi.mock('./components/TopAppBar', () => ({
  default: () => <div data-testid="top-app-bar" />,
}));
vi.mock('./components/QuincenaBanner', () => ({
  default: () => <div data-testid="quincena-banner" />,
}));
vi.mock('./components/DataGrid', () => ({
  default: () => <div data-testid="data-grid" />,
}));
vi.mock('./components/ActionBar', () => ({
  default: () => <div data-testid="action-bar" />,
}));
vi.mock('./components/ResultScreen', () => ({
  default: () => <div data-testid="result-screen" />,
}));
vi.mock('./components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { default: App } = await import('./App');

const DEC_2024 = { mes: 12, anio: 2024 };

function makeRow() {
  return {
    codigoEmpleado: '1', nombreEmpleado: 'A',
    diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0,
    mes: 12, anio: 2024,
  };
}

beforeEach(() => {
  useStore.getState().reset();
  // Default: health resolves immediately so routing tests don't stall
  mockCheckHealth.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// -----------------------------------------------------------------
// Startup states
// -----------------------------------------------------------------

describe('startup', () => {
  it('shows starting screen while health check is pending', () => {
    mockCheckHealth.mockReturnValue(new Promise(() => {})); // never settles
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
    // wrap in act so React flushes state updates triggered by the timers
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByText(/no se pudo conectar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });

  it('retry button resets to starting state then transitions to app on success', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockRejectedValue(new Error('connection refused'));
    render(<App />);
    await act(async () => { await vi.runAllTimersAsync(); });

    // Make health pass on next attempt
    mockCheckHealth.mockResolvedValue(undefined);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByText(/no se pudo conectar/i)).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// App state routing (after backend is ready)
// -----------------------------------------------------------------

describe('App state routing', () => {
  it('shows EmptyState when appState is "empty"', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByTestId('top-app-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('result-screen')).not.toBeInTheDocument();
  });

  it('shows loaded UI (TopAppBar, DataGrid, ActionBar) when appState is "loaded"', async () => {
    useStore.getState().setLoaded([makeRow()], [DEC_2024], false, []);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('top-app-bar')).toBeInTheDocument());
    expect(screen.getByTestId('data-grid')).toBeInTheDocument();
    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('shows loaded UI when appState is "submitting"', async () => {
    useStore.getState().setLoaded([makeRow()], [DEC_2024], false, []);
    useStore.getState().setSubmitting();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('top-app-bar')).toBeInTheDocument());
    expect(screen.getByText(/enviando/i)).toBeInTheDocument();
  });

  it('shows spinner overlay during submitting state', async () => {
    useStore.getState().setLoaded([makeRow()], [DEC_2024], false, []);
    useStore.getState().setSubmitting();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Enviando...')).toBeInTheDocument());
  });

  it('shows ResultScreen when appState is "result"', async () => {
    const result: SubmitResponse = {
      totalSubmitted: 1, totalSkippedDuplicates: 0, totalFailed: 0, rows: [],
    };
    useStore.getState().setResult(result);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('result-screen')).toBeInTheDocument());
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('top-app-bar')).not.toBeInTheDocument();
  });

  it('does not show spinner overlay when appState is "loaded"', async () => {
    useStore.getState().setLoaded([makeRow()], [DEC_2024], false, []);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('top-app-bar')).toBeInTheDocument());
    expect(screen.queryByText('Enviando...')).not.toBeInTheDocument();
  });
});
