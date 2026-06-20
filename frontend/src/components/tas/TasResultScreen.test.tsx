import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TasResultScreen from './TasResultScreen';
import { useTasStore } from '../../tasStore';
import type { AbsentEmployee } from '../../tasTypes';
import * as tasApi from '../../tasApi';

vi.mock('../../tasApi');
const mockRetryTasJob = vi.mocked(tasApi.retryTasJob);

beforeEach(() => {
  useTasStore.getState().resetTas();
  vi.clearAllMocks();
});

describe('TasResultScreen', () => {
  it('renders Carga completada heading', () => {
    render(<TasResultScreen />);
    expect(screen.getByText('Carga completada')).toBeInTheDocument();
  });

  it('shows plural count of resolved rows', () => {
    useTasStore.getState().setResolvedRowCount(3);
    render(<TasResultScreen />);
    expect(screen.getByText(/Se enviaron 3 registros\./)).toBeInTheDocument();
  });

  it('uses singular form for 1 resolved row', () => {
    useTasStore.getState().setResolvedRowCount(1);
    render(<TasResultScreen />);
    expect(screen.getByText(/Se envió 1 registro\./)).toBeInTheDocument();
  });

  it('shows Nueva carga button', () => {
    render(<TasResultScreen />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
  });

  it('clicking Nueva carga resets TAS store', () => {
    useTasStore.getState().setTasView('result');
    render(<TasResultScreen />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    expect(useTasStore.getState().tasView).toBe('idle');
  });

  it('does not show absent employee message when none absent', () => {
    render(<TasResultScreen />);
    expect(screen.queryByText(/empleados activos no tuvieron/i)).not.toBeInTheDocument();
  });

  it('shows absent employee count message', () => {
    const absent: AbsentEmployee[] = [
      { employeeId: 'E1', name: 'Ana' },
      { employeeId: 'E2', name: 'Luis' },
    ];
    useTasStore.getState().setAbsentEmployees(absent);
    render(<TasResultScreen />);
    expect(screen.getByText(/2 empleados activos no tuvieron marcaciones/i)).toBeInTheDocument();
  });

  it('shows Revisar button when absent employees exist', () => {
    useTasStore.getState().setAbsentEmployees([{ employeeId: 'E1', name: 'Ana' }]);
    render(<TasResultScreen />);
    expect(screen.getByRole('button', { name: /revisar empleados sin marcaciones/i })).toBeInTheDocument();
  });

  it('clicking Revisar advances to absentReview view', () => {
    useTasStore.getState().setAbsentEmployees([{ employeeId: 'E1', name: 'Ana' }]);
    render(<TasResultScreen />);
    fireEvent.click(screen.getByRole('button', { name: /revisar empleados sin marcaciones/i }));
    expect(useTasStore.getState().tasView).toBe('absentReview');
  });

  it('uses singular form for one absent employee', () => {
    useTasStore.getState().setAbsentEmployees([{ employeeId: 'E1', name: 'Ana' }]);
    render(<TasResultScreen />);
    expect(screen.getByText(/1 empleado activo no tuvo marcaciones/i)).toBeInTheDocument();
  });
});

describe('TasResultScreen retry', () => {
  it('shows retry button when there are failed rows and retries remain', () => {
    useTasStore.getState().setJobResult({ submitted: 5, skipped: 0, failed: 2, attemptNumber: 1, maxRetries: 3 });
    render(<TasResultScreen />);
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });

  it('hides retry button when no rows failed', () => {
    useTasStore.getState().setJobResult({ submitted: 5, skipped: 0, failed: 0, attemptNumber: 1, maxRetries: 3 });
    render(<TasResultScreen />);
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
  });

  it('shows exhaustion message when max retries reached', () => {
    useTasStore.getState().setJobResult({ submitted: 5, skipped: 0, failed: 2, attemptNumber: 4, maxRetries: 3 });
    render(<TasResultScreen />);
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
    expect(screen.getByText(/se agotaron los reintentos/i)).toBeInTheDocument();
  });

  it('shows attempt counter when there are failed rows', () => {
    useTasStore.getState().setJobResult({ submitted: 5, skipped: 0, failed: 2, attemptNumber: 2, maxRetries: 3 });
    render(<TasResultScreen />);
    expect(screen.getByText(/intento 2 de 3/i)).toBeInTheDocument();
  });

  it('clicking retry calls API and navigates to polling', async () => {
    mockRetryTasJob.mockResolvedValue({ jobId: 'retry-job-1' });
    useTasStore.getState().setJobId('job-1');
    useTasStore.getState().setJobResult({ submitted: 5, skipped: 0, failed: 2, attemptNumber: 1, maxRetries: 3 });
    useTasStore.getState().setTasView('result');

    render(<TasResultScreen />);
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await waitFor(() => {
      expect(mockRetryTasJob).toHaveBeenCalledWith('job-1');
      expect(useTasStore.getState().jobId).toBe('retry-job-1');
      expect(useTasStore.getState().jobResult).toBeNull();
      expect(useTasStore.getState().tasView).toBe('polling');
    });
  });

  it('shows error message when retry API fails', async () => {
    mockRetryTasJob.mockRejectedValue(new Error('server error'));
    useTasStore.getState().setJobId('job-1');
    useTasStore.getState().setJobResult({ submitted: 5, skipped: 0, failed: 2, attemptNumber: 1, maxRetries: 3 });

    render(<TasResultScreen />);
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await waitFor(() => {
      expect(screen.getByText(/no se pudo reintentar/i)).toBeInTheDocument();
    });
  });
});
