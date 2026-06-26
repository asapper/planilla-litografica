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
  availableShifts: [],
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

describe('ReactivationReviewScreen search filter', () => {
  it('renders a search input', () => {
    setup();
    render(<ReactivationReviewScreen />);
    expect(screen.getByLabelText(/buscar empleado/i)).toBeInTheDocument();
  });

  it('filters rows by employee name', () => {
    setup();
    render(<ReactivationReviewScreen />);
    fireEvent.change(screen.getByLabelText(/buscar empleado/i), { target: { value: 'ana' } });
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.queryByText('Luis García')).not.toBeInTheDocument();
  });

  it('filters rows by employee ID', () => {
    setup();
    render(<ReactivationReviewScreen />);
    fireEvent.change(screen.getByLabelText(/buscar empleado/i), { target: { value: 'E2' } });
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
    expect(screen.getByText('Luis García')).toBeInTheDocument();
  });

  it('matches accent-insensitively', () => {
    setup();
    render(<ReactivationReviewScreen />);
    fireEvent.change(screen.getByLabelText(/buscar empleado/i), { target: { value: 'garcia' } });
    expect(screen.getByText('Luis García')).toBeInTheDocument();
  });

  it('shows empty state when no rows match', () => {
    setup();
    render(<ReactivationReviewScreen />);
    fireEvent.change(screen.getByLabelText(/buscar empleado/i), { target: { value: 'xyz' } });
    expect(screen.getByText(/no se encontraron empleados/i)).toBeInTheDocument();
  });

  it('shows a clear button when search has text', () => {
    setup();
    render(<ReactivationReviewScreen />);
    expect(screen.queryByLabelText(/limpiar búsqueda/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/buscar empleado/i), { target: { value: 'ana' } });
    expect(screen.getByLabelText(/limpiar búsqueda/i)).toBeInTheDocument();
  });

  it('clears search when clear button is clicked', () => {
    setup();
    render(<ReactivationReviewScreen />);
    fireEvent.change(screen.getByLabelText(/buscar empleado/i), { target: { value: 'ana' } });
    expect(screen.queryByText('Luis García')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/limpiar búsqueda/i));
    expect(screen.getByText('Luis García')).toBeInTheDocument();
    expect(screen.getByText('Ana López')).toBeInTheDocument();
  });

  it('does not alter inactiveDecisions in the store', () => {
    setup();
    useTasStore.getState().setInactiveDecision('E1', 'reactivate');
    render(<ReactivationReviewScreen />);
    fireEvent.change(screen.getByLabelText(/buscar empleado/i), { target: { value: 'luis' } });
    expect(useTasStore.getState().inactiveDecisions['E1']).toBe('reactivate');
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
          assignedShiftId: null, assignedShiftName: null,
          effectiveStart: null, lastScan: null, workedMinutes: 0, workedHours: 0,
          crossMidnight: false, needsResolution: true, flags: ['MISSING_ENTRY'],
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
      { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
    ] });
    render(<ReactivationReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('review'));
    expect(useTasStore.getState().resolvedRows).toHaveLength(1);
    expect(mockSubmitTas).not.toHaveBeenCalled();
  });

  it('advances to verification when multiple availablePeriods even with no flagged sessions', async () => {
    setup();
    mockSubmitInactiveReview.mockResolvedValue({
      ...mockResult,
      availablePeriods: [
        { anio: 2026, mes: 4, numeroDequincena: 1 },
        { anio: 2026, mes: 4, numeroDequincena: 2 },
      ],
    });
    render(<ReactivationReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await waitFor(() => expect(useTasStore.getState().tasView).toBe('verification'));
  });

  it('stores availablePeriods from result', async () => {
    setup();
    mockSubmitInactiveReview.mockResolvedValue({
      ...mockResult,
      availablePeriods: [{ anio: 2026, mes: 3, numeroDequincena: 1 }],
    });
    render(<ReactivationReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await waitFor(() =>
      expect(useTasStore.getState().availablePeriods).toEqual([
        { anio: 2026, mes: 3, numeroDequincena: 1 },
      ])
    );
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
