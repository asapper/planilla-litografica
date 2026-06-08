import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AbsentReviewOverlay from './AbsentReviewOverlay';
import { useTasStore } from '../../tasStore';
import * as tasApi from '../../tasApi';

vi.mock('../../tasApi');

const mockDeactivate = vi.mocked(tasApi.deactivateAbsentEmployees);

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
  it('calls deactivateAbsentEmployees for the clicked employee', async () => {
    setup();
    mockDeactivate.mockResolvedValue(undefined);
    render(<AbsentReviewOverlay />);

    const anaBtn = screen.getByRole('button', { name: /desactivar Ana/i });
    fireEvent.click(anaBtn);

    await waitFor(() => {
      expect(mockDeactivate).toHaveBeenCalledWith('tok-1', ['E1']);
    });
  });

  it('removes deactivated employee from store', async () => {
    setup();
    mockDeactivate.mockResolvedValue(undefined);
    render(<AbsentReviewOverlay />);

    fireEvent.click(screen.getByRole('button', { name: /desactivar Ana/i }));

    await waitFor(() => {
      expect(useTasStore.getState().absentEmployees.find(e => e.employeeId === 'E1')).toBeUndefined();
    });
    expect(useTasStore.getState().absentEmployees.find(e => e.employeeId === 'E2')).toBeDefined();
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
