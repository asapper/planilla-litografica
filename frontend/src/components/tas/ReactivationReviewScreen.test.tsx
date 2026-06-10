import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReactivationReviewScreen from './ReactivationReviewScreen';
import { useTasStore } from '../../tasStore';
import * as tasApi from '../../tasApi';
import type { TasUploadResult } from '../../tasTypes';

vi.mock('../../tasApi');

const mockSubmitInactiveReview = vi.mocked(tasApi.submitInactiveReview);
const mockSubmitTas = vi.mocked(tasApi.submitTas);

const mockResult: TasUploadResult = {
  uploadToken: 'tok-2',
  flaggedSessions: [],
  inactiveEmployeesFound: [],
  absentActiveEmployees: [],
  usedFallbackHolidays: false,
  warnings: [],
};

beforeEach(() => {
  useTasStore.getState().resetTas();
  vi.clearAllMocks();
});

function setup() {
  useTasStore.getState().setUploadToken('tok-1');
  useTasStore.getState().setInactiveEmployees([
    { employeeId: 'E1', name: 'Ana López', sessionCount: 3 },
    { employeeId: 'E2', name: 'Luis García', sessionCount: 1 },
  ]);
}

describe('ReactivationReviewScreen rendering', () => {
  it('renders the heading', () => {
    setup();
    render(<ReactivationReviewScreen />);
    expect(screen.getByText('Empleados inactivos detectados')).toBeInTheDocument();
  });

  it('renders each inactive employee name', () => {
    setup();
    render(<ReactivationReviewScreen />);
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Luis García')).toBeInTheDocument();
  });

  it('renders session counts', () => {
    setup();
    render(<ReactivationReviewScreen />);
    expect(screen.getByText('3 sesiones')).toBeInTheDocument();
    expect(screen.getByText('1 sesiones')).toBeInTheDocument();
  });

  it('defaults all decisions to Ignorar', () => {
    setup();
    render(<ReactivationReviewScreen />);
    const ignoreButtons = screen.getAllByRole('button', { name: /ignorar/i });
    expect(ignoreButtons).toHaveLength(2);
  });

  it('renders a Continuar button', () => {
    setup();
    render(<ReactivationReviewScreen />);
    expect(screen.getByRole('button', { name: /continuar/i })).toBeInTheDocument();
  });
});

describe('ReactivationReviewScreen decisions', () => {
  it('toggles an employee decision to reactivate', () => {
    setup();
    render(<ReactivationReviewScreen />);
    const reactivateButtons = screen.getAllByRole('button', { name: /reactivar/i });
    fireEvent.click(reactivateButtons[0]);
    expect(useTasStore.getState().inactiveDecisions['E1']).toBe('reactivate');
  });

  it('toggles an employee back to ignore', () => {
    setup();
    render(<ReactivationReviewScreen />);
    const reactivateButtons = screen.getAllByRole('button', { name: /reactivar/i });
    fireEvent.click(reactivateButtons[0]);
    const ignoreButtons = screen.getAllByRole('button', { name: /ignorar/i });
    fireEvent.click(ignoreButtons[0]);
    expect(useTasStore.getState().inactiveDecisions['E1']).toBe('ignore');
  });
});

describe('ReactivationReviewScreen continue', () => {
  it('calls submitInactiveReview with correct split of decisions', async () => {
    setup();
    mockSubmitInactiveReview.mockResolvedValue(mockResult);
    render(<ReactivationReviewScreen />);

    const reactivateButtons = screen.getAllByRole('button', { name: /reactivar/i });
    fireEvent.click(reactivateButtons[0]);

    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));

    await waitFor(() => {
      expect(mockSubmitInactiveReview).toHaveBeenCalledWith('tok-1', ['E1'], ['E2']);
    });
  });

  it('advances to verification when flaggedSessions need resolution', async () => {
    setup();
    mockSubmitInactiveReview.mockResolvedValue({
      ...mockResult,
      flaggedSessions: [
        {
          sessionId: 1, employeeId: 'E1', employeeName: 'Ana', date: '2026-03-01',
          scans: [], matchedShiftId: null, matchedShiftName: null,
          effectiveStart: null, lastScan: null, workedMinutes: 0, workedHours: 0,
          needsResolution: true, flags: ['MISSING_ENTRY'], consistentMismatch: false,
        },
      ],
    });
    render(<ReactivationReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('verification'));
  });

  it('advances to review when no sessions need resolution', async () => {
    setup();
    mockSubmitInactiveReview.mockResolvedValue({ ...mockResult, resolvedRows: [
      { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1 },
    ] });
    render(<ReactivationReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));
    expect(useTasStore.getState().resolvedRows).toHaveLength(1);
    expect(mockSubmitTas).not.toHaveBeenCalled();
  });

  it('updates the store with new token from result', async () => {
    setup();
    mockSubmitInactiveReview.mockResolvedValue({ ...mockResult, uploadToken: 'tok-new' });
    render(<ReactivationReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await waitFor(() => expect(useTasStore.getState().uploadToken).toBe('tok-new'));
  });

  it('reverts to inactiveReview and sets error when submitInactiveReview throws', async () => {
    setup();
    mockSubmitInactiveReview.mockRejectedValue(new Error('server error'));
    render(<ReactivationReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('inactiveReview'));
    expect(useTasStore.getState().error).not.toBeNull();
  });
});
