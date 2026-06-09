import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopAppBar from './TopAppBar';
import { useStore } from '../store';
import type { AppView } from '../types';

const DEC_2024 = { mes: 12, anio: 2024 };

function makeRow(codigo: string) {
  return {
    codigoEmpleado: codigo, nombreEmpleado: `Empleado ${codigo}`,
    diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0,
    mes: 12, anio: 2024,
  };
}

const noop = vi.fn<[AppView], void>();

beforeEach(() => {
  useStore.getState().reset();
  noop.mockClear();
});

describe('TopAppBar', () => {
  it('renders the app title', () => {
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.getByText('Cargador de Planilla')).toBeInTheDocument();
  });

  it('shows singular "empleado" when 1 row is loaded', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.getByText('1 empleado')).toBeInTheDocument();
  });

  it('shows plural "empleados" when multiple rows are loaded', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2'), makeRow('3')], [DEC_2024], false, []);
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.getByText('3 empleados')).toBeInTheDocument();
  });

  it('does not show empleados count in empty state', () => {
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.queryByText(/empleado/i)).not.toBeInTheDocument();
  });

  it('does not show empleados count in result state', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.setState({ appState: 'result' });
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.queryByText(/empleado/i)).not.toBeInTheDocument();
  });

  it('does not show Nueva carga button in empty state', () => {
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.queryByRole('button', { name: /nueva carga/i })).not.toBeInTheDocument();
  });

  it('shows Nueva carga button when rows are loaded', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
  });

  it('clicking Nueva carga resets the store', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    expect(useStore.getState().appState).toBe('empty');
    expect(useStore.getState().rows).toHaveLength(0);
  });

  it('does not show Nueva carga button when in config view', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar currentView="config" onViewChange={noop} />);
    expect(screen.queryByRole('button', { name: /nueva carga/i })).not.toBeInTheDocument();
  });

  it('does not render a Planilla nav button', () => {
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.queryByRole('button', { name: /^planilla$/i })).not.toBeInTheDocument();
  });

  it('renders the Configuración button', () => {
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.getByRole('button', { name: /configuración/i })).toBeInTheDocument();
  });

  it('highlights Configuración button when currentView is config', () => {
    render(<TopAppBar currentView="config" onViewChange={noop} />);
    expect(screen.getByRole('button', { name: /configuración/i })).toHaveClass('bg-white');
  });

  it('calls onViewChange with "config" when Configuración is clicked', () => {
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /configuración/i }));
    expect(noop).toHaveBeenCalledWith('config');
  });
});

describe('TopAppBar search', () => {
  it('does not show search input in empty state', () => {
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.queryByLabelText('Buscar empleado')).not.toBeInTheDocument();
  });

  it('does not show search input in result state', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.setState({ appState: 'result' });
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.queryByLabelText('Buscar empleado')).not.toBeInTheDocument();
  });

  it('shows search input when rows are loaded', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.getByLabelText('Buscar empleado')).toBeInTheDocument();
  });

  it('does not show search input when in config view even if rows are loaded', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar currentView="config" onViewChange={noop} />);
    expect(screen.queryByLabelText('Buscar empleado')).not.toBeInTheDocument();
  });

  it('reflects searchText from store', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setSearchText('garcia');
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect((screen.getByLabelText('Buscar empleado') as HTMLInputElement).value).toBe('garcia');
  });

  it('typing updates searchText in store', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    fireEvent.change(screen.getByLabelText('Buscar empleado'), { target: { value: 'lopez' } });
    expect(useStore.getState().searchText).toBe('lopez');
  });

  it('does not show clear button when search is empty', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.queryByRole('button', { name: /limpiar/i })).not.toBeInTheDocument();
  });

  it('shows clear button when search has text', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setSearchText('garcia');
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    expect(screen.getByRole('button', { name: /limpiar/i })).toBeInTheDocument();
  });

  it('clicking clear button resets searchText', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setSearchText('garcia');
    render(<TopAppBar currentView="planilla" onViewChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /limpiar/i }));
    expect(useStore.getState().searchText).toBe('');
  });
});
