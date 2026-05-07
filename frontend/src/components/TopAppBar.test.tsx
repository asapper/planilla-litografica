import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopAppBar from './TopAppBar';
import { useStore } from '../store';

const DEC_2024 = { mes: 12, anio: 2024 };

function makeRow(codigo: string) {
  return {
    codigoEmpleado: codigo, nombreEmpleado: `Empleado ${codigo}`,
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
    expect(screen.getByText('1 empleado')).toBeInTheDocument();
  });

  it('shows plural "empleados" when multiple rows are loaded', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2'), makeRow('3')], [DEC_2024], false, []);
    render(<TopAppBar />);
    expect(screen.getByText('3 empleados')).toBeInTheDocument();
  });

  it('does not show empleados count in empty state', () => {
    render(<TopAppBar />);
    expect(screen.queryByText(/empleado/i)).not.toBeInTheDocument();
  });

  it('does not show empleados count in result state', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.setState({ appState: 'result' });
    render(<TopAppBar />);
    expect(screen.queryByText(/empleado/i)).not.toBeInTheDocument();
  });

  it('does not show Nueva carga button in empty state', () => {
    render(<TopAppBar />);
    expect(screen.queryByRole('button', { name: /nueva carga/i })).not.toBeInTheDocument();
  });

  it('shows Nueva carga button when rows are loaded', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
  });

  it('clicking Nueva carga resets the store', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    expect(useStore.getState().appState).toBe('empty');
    expect(useStore.getState().rows).toHaveLength(0);
  });
});

describe('TopAppBar search', () => {
  it('does not show search input in empty state', () => {
    render(<TopAppBar />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('does not show search input in result state', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.setState({ appState: 'result' });
    render(<TopAppBar />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('shows search input when rows are loaded', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('reflects searchText from store', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setSearchText('garcia');
    render(<TopAppBar />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('garcia');
  });

  it('typing updates searchText in store', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lopez' } });
    expect(useStore.getState().searchText).toBe('lopez');
  });

  it('does not show clear button when search is empty', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<TopAppBar />);
    expect(screen.queryByRole('button', { name: /limpiar/i })).not.toBeInTheDocument();
  });

  it('shows clear button when search has text', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setSearchText('garcia');
    render(<TopAppBar />);
    expect(screen.getByRole('button', { name: /limpiar/i })).toBeInTheDocument();
  });

  it('clicking clear button resets searchText', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setSearchText('garcia');
    render(<TopAppBar />);
    fireEvent.click(screen.getByRole('button', { name: /limpiar/i }));
    expect(useStore.getState().searchText).toBe('');
  });
});
