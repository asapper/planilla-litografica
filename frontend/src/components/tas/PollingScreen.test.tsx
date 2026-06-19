import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import PollingScreen from './PollingScreen';
import { useTasStore } from '../../tasStore';
import * as tasApi from '../../tasApi';
import type { JobStatus } from '../../tasTypes';

vi.mock('../../tasApi');

const mockGetTasJobStatus = vi.mocked(tasApi.getTasJobStatus);

const inProgressStatus: JobStatus = {
  jobId: 'job-1',
  status: 'IN_PROGRESS',
  totalRows: 10,
  submitted: 3,
  skipped: 1,
  failed: 0,
  attemptNumber: 1,
  maxRetries: 3,
  failedRows: [],
};

const doneStatus: JobStatus = {
  jobId: 'job-1',
  status: 'DONE',
  totalRows: 10,
  submitted: 9,
  skipped: 1,
  failed: 0,
  attemptNumber: 1,
  maxRetries: 3,
  failedRows: [],
};

const doneWithErrorsStatus: JobStatus = {
  jobId: 'job-1',
  status: 'DONE_WITH_ERRORS',
  totalRows: 10,
  submitted: 7,
  skipped: 1,
  failed: 2,
  attemptNumber: 1,
  maxRetries: 3,
  failedRows: [
    { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', error: 'DB error' },
    { codigoEmpleado: 'E2', nombreEmpleado: 'Luis', error: 'Timeout' },
  ],
};

beforeEach(() => {
  useTasStore.getState().resetTas();
  useTasStore.getState().setJobId('job-1');
  useTasStore.getState().setTasView('polling');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PollingScreen progress', () => {
  it('renders progress bar with correct percentage', async () => {
    mockGetTasJobStatus.mockResolvedValue(inProgressStatus);

    render(<PollingScreen />);

    await waitFor(() => {
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '40');
    });
  });

  it('shows status text with row counts', async () => {
    mockGetTasJobStatus.mockResolvedValue(inProgressStatus);

    render(<PollingScreen />);

    await waitFor(() => {
      expect(screen.getByText(/4 de 10/)).toBeInTheDocument();
    });
  });

  it('updates progress on subsequent polls', async () => {
    mockGetTasJobStatus
      .mockResolvedValueOnce(inProgressStatus)
      .mockResolvedValueOnce({ ...inProgressStatus, submitted: 7, skipped: 1, failed: 0 });

    render(<PollingScreen />);

    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40'));

    await act(async () => { vi.advanceTimersByTime(2000); });

    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80'));
  });
});

describe('PollingScreen failed rows', () => {
  it('shows failed rows as they appear', async () => {
    mockGetTasJobStatus.mockResolvedValue(doneWithErrorsStatus);

    render(<PollingScreen />);

    await waitFor(() => {
      expect(screen.getByText('E1')).toBeInTheDocument();
      expect(screen.getByText('Ana')).toBeInTheDocument();
      expect(screen.getByText('DB error')).toBeInTheDocument();
      expect(screen.getByText('E2')).toBeInTheDocument();
    });
  });
});

describe('PollingScreen terminal states', () => {
  it('transitions to result on DONE', async () => {
    mockGetTasJobStatus.mockResolvedValue(doneStatus);

    render(<PollingScreen />);

    await waitFor(() => {
      expect(useTasStore.getState().tasView).toBe('result');
    });
    expect(useTasStore.getState().jobResult).toEqual({
      submitted: 9,
      skipped: 1,
      failed: 0,
      attemptNumber: 1,
      maxRetries: 3,
    });
  });

  it('transitions to result on DONE_WITH_ERRORS', async () => {
    mockGetTasJobStatus.mockResolvedValue(doneWithErrorsStatus);

    render(<PollingScreen />);

    await waitFor(() => {
      expect(useTasStore.getState().tasView).toBe('result');
    });
    expect(useTasStore.getState().jobResult).toEqual({
      submitted: 7,
      skipped: 1,
      failed: 2,
      attemptNumber: 1,
      maxRetries: 3,
    });
  });
});

describe('PollingScreen error handling', () => {
  it('shows error after 3 consecutive poll failures', async () => {
    mockGetTasJobStatus
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'));

    render(<PollingScreen />);

    await act(async () => { vi.advanceTimersByTime(0); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => { vi.advanceTimersByTime(2000); });

    await waitFor(() => {
      expect(screen.getAllByText(/error.*conexión|no se pudo conectar/i).length).toBeGreaterThan(0);
    });
  });

  it('resets failure counter on successful poll after failures', async () => {
    mockGetTasJobStatus
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(inProgressStatus);

    render(<PollingScreen />);

    await act(async () => { vi.advanceTimersByTime(0); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => { vi.advanceTimersByTime(2000); });

    await waitFor(() => {
      expect(screen.queryAllByText(/error.*conexión|no se pudo conectar/i)).toHaveLength(0);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  it('shows job-not-found message on 404', async () => {
    const error = new AxiosError('Not found', '404', undefined, undefined, {
      status: 404,
      data: {},
      statusText: 'Not Found',
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    mockGetTasJobStatus.mockRejectedValue(error);

    render(<PollingScreen />);

    await waitFor(() => {
      expect(screen.getByText(/no fue encontrado/i)).toBeInTheDocument();
    });
  });

  it('shows reset button on 404 that calls resetTas', async () => {
    const error = new AxiosError('Not found', '404', undefined, undefined, {
      status: 404,
      data: {},
      statusText: 'Not Found',
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    mockGetTasJobStatus.mockRejectedValue(error);

    render(<PollingScreen />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
    });
  });
});

describe('PollingScreen cleanup', () => {
  it('clears interval on unmount', async () => {
    mockGetTasJobStatus.mockResolvedValue(inProgressStatus);

    const { unmount } = render(<PollingScreen />);
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());

    unmount();

    const callCount = mockGetTasJobStatus.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(mockGetTasJobStatus.mock.calls.length).toBe(callCount);
  });
});
