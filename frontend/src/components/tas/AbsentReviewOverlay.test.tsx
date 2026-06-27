import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AbsentReviewOverlay from './AbsentReviewOverlay';
import { useTasStore } from '../../tasStore';
import { useToastStore } from '../../toastStore';
import * as tasApi from '../../tasApi';

vi.mock('../../tasApi');

const mockSetActive = vi.mocked(tasApi.setAbsentEmployeesActive);

beforeEach(() => {
  useTasStore.getState().resetTas();
  vi.clearAllMocks();
});

function setup() {
  useTasStore.getState().setUploadToken('tok-1');
  useTasStore.getState().setAbsentEmployees([
    { employeeId: 'E1', name: 'Ana López' },
    { employeeId: 'E2', name: 'Luis García' },
  ]);
}

describe('AbsentReviewOverlay rendering', () => {
  it('renders the heading', () => {
    setup();
    render(<AbsentReviewOverlay />);
    expect(screen.getByText('Empleados sin marcaciones')).toBeInTheDocument();
  });

  it('renders each absent employee', () => {
    setup();
    render(<AbsentReviewOverlay />);
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Luis García')).toBeInTheDocument();
  });

  it('renders employee IDs', () => {
    setup();
    render(<AbsentReviewOverlay />);
    expect(screen.getByText('E1')).toBeInTheDocument();
    expect(screen.getByText('E2')).toBeInTheDocument();
  });

  it('renders Activo toggle for each employee', () => {
    setup();
    render(<AbsentReviewOverlay />);
    const toggles = screen.getAllByText('Activo');
    expect(toggles).toHaveLength(2);
  });

  it('renders Cerrar button', () => {
    setup();
    render(<AbsentReviewOverlay />);
    expect(screen.getByRole('button', { name: /cerrar/i })).toBeInTheDocument();
  });
});

describe('AbsentReviewOverlay deactivate', () => {
  it('calls setAbsentEmployeesActive with active=false for the clicked employee', async () => {
    setup();
    mockSetActive.mockResolvedValue({ updated: 1, notFound: [] });
    render(<AbsentReviewOverlay />);

    const anaBtn = screen.getByRole('button', { name: /desactivar Ana/i });
    fireEvent.click(anaBtn);

    await waitFor(() => {
      expect(mockSetActive).toHaveBeenCalledWith('tok-1', ['E1'], false);
    });
  });

  it('keeps the deactivated employee in the list, marked as inactive', async () => {
    setup();
    mockSetActive.mockResolvedValue({ updated: 1, notFound: [] });
    render(<AbsentReviewOverlay />);

    fireEvent.click(screen.getByRole('button', { name: /desactivar Ana/i }));

    await waitFor(() => {
      expect(useTasStore.getState().absentEmployees.find(e => e.employeeId === 'E1')?.active).toBe(false);
    });
    expect(useTasStore.getState().absentEmployees.find(e => e.employeeId === 'E2')).toBeDefined();
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reactivar Ana/i })).toBeInTheDocument();
  });

  it('toggling an inactive employee back to active calls setAbsentEmployeesActive with active=true', async () => {
    setup();
    useTasStore.getState().setAbsentEmployees([
      { employeeId: 'E1', name: 'Ana López', active: false },
      { employeeId: 'E2', name: 'Luis García' },
    ]);
    mockSetActive.mockResolvedValue({ updated: 1, notFound: [] });
    render(<AbsentReviewOverlay />);

    fireEvent.click(screen.getByRole('button', { name: /reactivar Ana/i }));

    await waitFor(() => {
      expect(mockSetActive).toHaveBeenCalledWith('tok-1', ['E1'], true);
    });
    expect(useTasStore.getState().absentEmployees.find(e => e.employeeId === 'E1')?.active).toBe(true);
  });

  it('shows an error message and keeps the employee active when the request fails', async () => {
    setup();
    mockSetActive.mockRejectedValue(new Error('network error'));
    render(<AbsentReviewOverlay />);

    fireEvent.click(screen.getByRole('button', { name: /desactivar Ana/i }));

    await waitFor(() => {
      expect(screen.getByText(/no se pudo actualizar el estado/i)).toBeInTheDocument();
    });
    expect(useTasStore.getState().absentEmployees.find(e => e.employeeId === 'E1')?.active).not.toBe(false);
  });

  it('toggling two employees in quick succession updates both', async () => {
    setup();
    mockSetActive.mockResolvedValue({ updated: 1, notFound: [] });
    render(<AbsentReviewOverlay />);

    fireEvent.click(screen.getByRole('button', { name: /desactivar Ana/i }));
    fireEvent.click(screen.getByRole('button', { name: /desactivar Luis/i }));

    await waitFor(() => {
      expect(useTasStore.getState().absentEmployees.find(e => e.employeeId === 'E1')?.active).toBe(false);
      expect(useTasStore.getState().absentEmployees.find(e => e.employeeId === 'E2')?.active).toBe(false);
    });
  });

  it('shows a warning toast when the backend reports notFound employees', async () => {
    setup();
    mockSetActive.mockResolvedValue({ updated: 0, notFound: ['E1'] });
    const showToast = vi.spyOn(useToastStore.getState(), 'showToast');
    render(<AbsentReviewOverlay />);

    fireEvent.click(screen.getByRole('button', { name: /desactivar Ana/i }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        '1 empleado no encontrado en el registro',
        'warning',
      );
    });
  });
});

describe('AbsentReviewOverlay close', () => {
  it('clicking Cerrar returns to result view', () => {
    setup();
    useTasStore.getState().setTasView('absentReview');
    render(<AbsentReviewOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(useTasStore.getState().tasView).toBe('result');
  });
});

describe('AbsentReviewOverlay backdrop', () => {
  it('clicking the backdrop closes the overlay', () => {
    setup();
    useTasStore.getState().setTasView('absentReview');
    render(<AbsentReviewOverlay />);
    const backdrop = screen.getByTestId('absent-review-backdrop');
    fireEvent.click(backdrop);
    expect(useTasStore.getState().tasView).toBe('result');
  });

  it('clicking inside the modal card does not close the overlay', () => {
    setup();
    useTasStore.getState().setTasView('absentReview');
    render(<AbsentReviewOverlay />);
    fireEvent.click(screen.getByText('Empleados sin marcaciones'));
    expect(useTasStore.getState().tasView).toBe('absentReview');
  });
});

describe('AbsentReviewOverlay escape key', () => {
  it('pressing Escape closes the overlay', () => {
    setup();
    useTasStore.getState().setTasView('absentReview');
    render(<AbsentReviewOverlay />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useTasStore.getState().tasView).toBe('result');
  });
});

describe('AbsentReviewOverlay pill width stability', () => {
  it('both active and inactive pills have the same min-width class', () => {
    setup();
    useTasStore.getState().setAbsentEmployees([
      { employeeId: 'E1', name: 'Ana López' },
      { employeeId: 'E2', name: 'Luis García', active: false },
    ]);
    render(<AbsentReviewOverlay />);
    const activePill = screen.getByRole('button', { name: /desactivar Ana/i });
    const inactivePill = screen.getByRole('button', { name: /reactivar Luis/i });
    expect(activePill.className).toContain('min-w-[7rem]');
    expect(inactivePill.className).toContain('min-w-[7rem]');
  });
});
