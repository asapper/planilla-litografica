import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuincenaBanner from './QuincenaBanner';
import { useStore } from '../store';
import type { MonthOption } from '../types';

const DEC_2024: MonthOption = { mes: 12, anio: 2024 };
const NOV_2024: MonthOption = { mes: 11, anio: 2024 };

function setupSingleMonth() {
  useStore.getState().setLoaded(
    [{ codigoEmpleado: '1', nombreEmpleado: 'A', diasNoLaborados: 0,
       horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 12, anio: 2024 }],
    [DEC_2024],
    false,
    []
  );
}

function setupMultiMonth() {
  useStore.getState().setLoaded(
    [{ codigoEmpleado: '1', nombreEmpleado: 'A', diasNoLaborados: 0,
       horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 11, anio: 2024 },
     { codigoEmpleado: '2', nombreEmpleado: 'B', diasNoLaborados: 0,
       horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 12, anio: 2024 }],
    [NOV_2024, DEC_2024],
    true,
    []
  );
}

beforeEach(() => {
  useStore.getState().reset();
});

// -----------------------------------------------------------------
// Quincena buttons
// -----------------------------------------------------------------

describe('QuincenaBanner quincena selection', () => {
  it('renders Quincena 1 and Quincena 2 buttons', () => {
    setupSingleMonth();
    render(<QuincenaBanner />);
    expect(screen.getByRole('button', { name: /quincena 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quincena 2/i })).toBeInTheDocument();
  });

  it('clicking Quincena 1 selects it in the store', () => {
    setupSingleMonth();
    render(<QuincenaBanner />);
    fireEvent.click(screen.getByRole('button', { name: /quincena 1/i }));
    expect(useStore.getState().selectedQuincena).toBe(1);
  });

  it('clicking Quincena 2 selects it in the store', () => {
    setupSingleMonth();
    render(<QuincenaBanner />);
    fireEvent.click(screen.getByRole('button', { name: /quincena 2/i }));
    expect(useStore.getState().selectedQuincena).toBe(2);
  });
});

// -----------------------------------------------------------------
// Single-month display
// -----------------------------------------------------------------

describe('QuincenaBanner single-month mode', () => {
  it('shows the auto-selected month as a read-only chip', () => {
    setupSingleMonth();
    render(<QuincenaBanner />);
    expect(screen.getByText('Diciembre 2024')).toBeInTheDocument();
  });

  it('does not render clickable month selector chips', () => {
    setupSingleMonth();
    render(<QuincenaBanner />);
    // Only Quincena buttons are clickable; month chip has pointer-events-none
    const buttons = screen.getAllByRole('button');
    const monthButtons = buttons.filter(b => b.textContent === 'Diciembre 2024');
    // The month chip is a button but has pointer-events-none class — check it's not interactive
    expect(monthButtons).toHaveLength(0); // rendered as span-like chip, not a click target
  });
});

// -----------------------------------------------------------------
// Multi-month display
// -----------------------------------------------------------------

describe('QuincenaBanner multi-month mode', () => {
  it('shows a clickable chip for each month', () => {
    setupMultiMonth();
    render(<QuincenaBanner />);
    expect(screen.getByRole('button', { name: /noviembre 2024/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /diciembre 2024/i })).toBeInTheDocument();
  });

  it('clicking a month chip sets selectedMonth in the store', () => {
    setupMultiMonth();
    render(<QuincenaBanner />);
    fireEvent.click(screen.getByRole('button', { name: /diciembre 2024/i }));
    expect(useStore.getState().selectedMonth).toEqual(DEC_2024);
  });

  it('clicking November sets November as selectedMonth', () => {
    setupMultiMonth();
    render(<QuincenaBanner />);
    fireEvent.click(screen.getByRole('button', { name: /noviembre 2024/i }));
    expect(useStore.getState().selectedMonth).toEqual(NOV_2024);
  });
});

// -----------------------------------------------------------------
// Completion state
// -----------------------------------------------------------------

describe('QuincenaBanner completion indicator', () => {
  it('shows warning state when selection is incomplete', () => {
    setupSingleMonth(); // no quincena yet
    render(<QuincenaBanner />);
    expect(screen.getByText(/selecciona la quincena/i)).toBeInTheDocument();
  });

  it('shows complete state after quincena is selected (single month)', () => {
    setupSingleMonth();
    render(<QuincenaBanner />);
    fireEvent.click(screen.getByRole('button', { name: /quincena 1/i }));
    expect(screen.getByText(/período seleccionado/i)).toBeInTheDocument();
  });

  it('shows incomplete state in multi-month mode when month not yet selected', () => {
    setupMultiMonth();
    render(<QuincenaBanner />);
    fireEvent.click(screen.getByRole('button', { name: /quincena 2/i }));
    // quincena set but no month → still incomplete
    expect(screen.getByText(/selecciona la quincena/i)).toBeInTheDocument();
  });

  it('shows complete state in multi-month mode when both quincena and month are selected', () => {
    setupMultiMonth();
    render(<QuincenaBanner />);
    fireEvent.click(screen.getByRole('button', { name: /quincena 1/i }));
    fireEvent.click(screen.getByRole('button', { name: /diciembre 2024/i }));
    expect(screen.getByText(/período seleccionado/i)).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Branch coverage: '—' shown when single-month but selectedMonth is null
// -----------------------------------------------------------------

describe('QuincenaBanner month dash fallback', () => {
  it('shows "—" when multiMonth is false and selectedMonth is null', () => {
    // Load with no monthOptions so selectedMonth auto-sets to null
    useStore.getState().setLoaded(
      [{ codigoEmpleado: '1', nombreEmpleado: 'A', diasNoLaborados: 0,
         horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 12, anio: 2024 }],
      [],       // empty monthOptions → selectedMonth = null
      false,
      []
    );
    render(<QuincenaBanner />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
