import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PollingScreen from './PollingScreen';
import { useStore } from '../store';
import * as api from '../api';
import type { JobResponse } from '../types';

vi.mock('../api');
const mockGetJob = vi.mocked(api.getJob);
const mockRetryJob = vi.mocked(api.retryJob);

function jobResponse(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    jobId: 'job-1',
    status: 'IN_PROGRESS',
    attemptNumber: 1,
    maxRetries: 3,
    parentJobId: null,
    totalRows: 4,
    processed: 2,
    submitted: 2,
    skipped: 0,
    failed: 0,
    rows: [],
    ...overrides,
  };
}

function setupPolling(jobId = 'job-1') {
  useStore.getState().setLoaded([], [], false, []);
  // Manually set polling state since we don't go through the full submit flow
  useStore.setState({ appState: 'polling', jobId, jobResponse: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Initial render ───────────────────────────────────────────────────────────

describe('PollingScreen initial state', () => {
  it('shows "Iniciando envío..." before first poll resolves', async () => {
    mockGetJob.mockReturnValue(new Promise(() => {})); // never resolves
    setupPolling();
    render(<PollingScreen />);
    expect(screen.getByText(/iniciando envío/i)).toBeInTheDocument();
  });
});

// ── In-progress polling ──────────────────────────────────────────────────────

describe('PollingScreen in-progress display', () => {
  it('shows progress after first poll', async () => {
    mockGetJob.mockResolvedValue(jobResponse({ processed: 2, totalRows: 4 }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText(/enviando registros/i)).toBeInTheDocument();
    expect(screen.getByText('2 de 4 registros')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('shows submitted counter when rows submitted', async () => {
    mockGetJob.mockResolvedValue(jobResponse({ submitted: 3, processed: 3, totalRows: 4 }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/enviados/i)).toBeInTheDocument();
  });

  it('shows failed counter when rows failed', async () => {
    mockGetJob.mockResolvedValue(jobResponse({
      status: 'IN_PROGRESS',
      failed: 1,
      processed: 2,
      totalRows: 4,
      rows: [{ codigoEmpleado: '1', nombreEmpleado: 'Ana', status: 'FAILED', error: 'DB error' }],
    }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText(/fallido/i)).toBeInTheDocument();
  });

  it('shows failed rows detail section', async () => {
    mockGetJob.mockResolvedValue(jobResponse({
      status: 'DONE_WITH_ERRORS',
      failed: 1,
      processed: 4,
      totalRows: 4,
      rows: [{ codigoEmpleado: '99', nombreEmpleado: 'Luis', status: 'FAILED', error: 'Base de datos remota no disponible.' }],
    }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('Luis')).toBeInTheDocument();
    expect(screen.getByText('Base de datos remota no disponible.')).toBeInTheDocument();
  });

  it('polls again after interval', async () => {
    mockGetJob.mockResolvedValue(jobResponse());
    setupPolling();
    render(<PollingScreen />);

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });      // initial poll
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });  // one interval

    expect(mockGetJob).toHaveBeenCalledTimes(2);
  });
});

// ── Completion → result ───────────────────────────────────────────────────────

describe('PollingScreen DONE transition', () => {
  it('calls setResult and transitions to result state when DONE', async () => {
    mockGetJob.mockResolvedValue(jobResponse({
      status: 'DONE',
      submitted: 4,
      processed: 4,
      totalRows: 4,
      rows: [],
    }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useStore.getState().appState).toBe('result');
    expect(useStore.getState().submitResult?.totalSubmitted).toBe(4);
  });

  it('converts DONE job to SubmitResponse correctly', async () => {
    mockGetJob.mockResolvedValue(jobResponse({
      status: 'DONE',
      submitted: 2,
      skipped: 1,
      failed: 0,
      processed: 3,
      totalRows: 3,
      rows: [
        { codigoEmpleado: '1', nombreEmpleado: 'A', status: 'SUBMITTED' },
        { codigoEmpleado: '2', nombreEmpleado: 'B', status: 'SKIPPED' },
        { codigoEmpleado: '3', nombreEmpleado: 'C', status: 'SUBMITTED' },
      ],
    }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    const result = useStore.getState().submitResult!;
    expect(result.totalSubmitted).toBe(2);
    expect(result.totalSkippedDuplicates).toBe(1);
    expect(result.rows[0].submitted).toBe(true);
    expect(result.rows[1].skippedDuplicate).toBe(true);
  });

  it('transitions to result when DONE_WITH_ERRORS and max retries reached', async () => {
    mockGetJob.mockResolvedValue(jobResponse({
      status: 'DONE_WITH_ERRORS',
      attemptNumber: 3,
      maxRetries: 3,
      failed: 1,
      processed: 4,
      totalRows: 4,
      rows: [{ codigoEmpleado: '1', nombreEmpleado: 'A', status: 'FAILED', error: 'err' }],
    }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useStore.getState().appState).toBe('result');
  });
});

// ── Retry ─────────────────────────────────────────────────────────────────────

describe('PollingScreen retry', () => {
  it('shows retry button when DONE_WITH_ERRORS and retries remain', async () => {
    mockGetJob.mockResolvedValue(jobResponse({
      status: 'DONE_WITH_ERRORS',
      attemptNumber: 1,
      maxRetries: 3,
      failed: 2,
      processed: 4,
      totalRows: 4,
      rows: [
        { codigoEmpleado: '1', nombreEmpleado: 'A', status: 'FAILED', error: 'err' },
        { codigoEmpleado: '2', nombreEmpleado: 'B', status: 'FAILED', error: 'err' },
      ],
    }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });

  it('does not show retry button when DONE_WITH_ERRORS but max retries reached', async () => {
    mockGetJob.mockResolvedValue(jobResponse({
      status: 'DONE_WITH_ERRORS',
      attemptNumber: 3,
      maxRetries: 3,
      failed: 1,
      processed: 4,
      totalRows: 4,
      rows: [{ codigoEmpleado: '1', nombreEmpleado: 'A', status: 'FAILED', error: 'err' }],
    }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
  });

  it('does not show retry button when status is IN_PROGRESS', async () => {
    mockGetJob.mockResolvedValue(jobResponse({ status: 'IN_PROGRESS', failed: 0 }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
  });

  it('clicking retry calls retryJob and starts polling new jobId', async () => {
    mockGetJob.mockResolvedValue(jobResponse({
      status: 'DONE_WITH_ERRORS',
      attemptNumber: 1,
      maxRetries: 3,
      failed: 1,
      processed: 4,
      totalRows: 4,
      rows: [{ codigoEmpleado: '1', nombreEmpleado: 'A', status: 'FAILED', error: 'err' }],
    }));
    mockRetryJob.mockResolvedValue({ jobId: 'job-retry-1', status: 'PENDING' });
    setupPolling('job-1');

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockRetryJob).toHaveBeenCalledWith('job-1');
    expect(useStore.getState().jobId).toBe('job-retry-1');
    expect(useStore.getState().appState).toBe('polling');
  });

  it('shows attempt number when attemptNumber > 1', async () => {
    mockGetJob.mockResolvedValue(jobResponse({
      status: 'IN_PROGRESS',
      attemptNumber: 2,
      maxRetries: 3,
    }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText(/intento 2 de 3/i)).toBeInTheDocument();
  });

  it('does not show attempt label on first attempt', async () => {
    mockGetJob.mockResolvedValue(jobResponse({ attemptNumber: 1 }));
    setupPolling();

    await act(async () => {
      render(<PollingScreen />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByText(/intento/i)).not.toBeInTheDocument();
  });
});

// ── Transient poll error ──────────────────────────────────────────────────────

describe('PollingScreen poll error handling', () => {
  it('ignores transient poll failure and retries on next interval', async () => {
    mockGetJob
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(jobResponse({ processed: 1 }));

    setupPolling();
    render(<PollingScreen />);

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });      // first poll fails silently
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });  // second poll succeeds

    expect(screen.getByText(/enviando registros/i)).toBeInTheDocument();
  });
});
