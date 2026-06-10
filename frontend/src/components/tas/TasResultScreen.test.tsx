import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TasResultScreen from './TasResultScreen';
import { useTasStore } from '../../tasStore';
import type { AbsentEmployee } from '../../tasTypes';

beforeEach(() => {
  useTasStore.getState().resetTas();
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
