import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopAppBar from './TopAppBar';
import { useStore } from '../store';

const DEC_2024 = { mes: 12, anio: 2024 };

function makeRow(codigo: string) {
  return {
    codigoEmpleado: codigo, nombreEmpleado: 'Test',
    diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0,
    mes: 12, anio: 2024,
  };
}

beforeEach(() => {
  useStore.getState().reset();
});

describe('TopAppBar', () => {
  it('renders the app title', () => {
    render(<TopAppBar />);
    expect(screen.getByText('Cargador de Planilla')).toBeInTheDocument();
  });

  it('shows singular "empleado" when 1 row is loaded', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar />);
    expect(screen.getByText(/1 empleado cargados/)).toBeInTheDocument();
  });

  it('shows plural "empleados" when multiple rows are loaded', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2'), makeRow('3')], [DEC_2024], false, []);
    render(<TopAppBar />);
    expect(screen.getByText('3 empleados cargados')).toBeInTheDocument();
  });

  it('shows 0 empleados initially', () => {
    render(<TopAppBar />);
    expect(screen.getByText('0 empleados cargados')).toBeInTheDocument();
  });

  it('clicking Nueva carga resets the store', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    expect(useStore.getState().appState).toBe('empty');
    expect(useStore.getState().rows).toHaveLength(0);
  });

  it('renders the Nueva carga button', () => {
    render(<TopAppBar />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
  });
});
