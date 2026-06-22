import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReviewListView from './ReviewListView';
import { useTasStore } from '../../tasStore';
import type { ResolvedRow } from '../../tasTypes';

const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 2, accruesOvertime: true },
  { codigoEmpleado: 'E3', nombreEmpleado: 'Carlos Pérez', diasNoLaborados: 0, horasExtrasSimples: 1, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
];

beforeEach(() => {
  useTasStore.getState().resetTas();
  useTasStore.getState().setResolvedRows(rows);
});

describe('ReviewListView rendering', () => {
  it('renders employee rows', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Luis García')).toBeInTheDocument();
    expect(screen.getByText('Carlos Pérez')).toBeInTheDocument();
  });

  it('renders filter chips with counts', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByText('Todos')).toBeInTheDocument();
    expect(screen.getByText('Turno estimado')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/buscar empleado/i)).toBeInTheDocument();
  });

  it('renders Enviar button', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });
});

describe('ReviewListView filter chips', () => {
  it('filters to estimated-shift employees when chip clicked', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Turno estimado'));
    expect(screen.getByText('Luis García')).toBeInTheDocument();
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  });

  it('returns to all employees when Todos chip clicked', () => {
    useTasStore.getState().setReviewActiveFilter('estimated');
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Todos'));
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Luis García')).toBeInTheDocument();
  });
});

describe('ReviewListView sorting', () => {
  it('sorts by name ascending by default', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const cells = screen.getAllByRole('row').slice(1).map(row => row.querySelector('td')?.textContent);
    expect(cells[0]).toContain('Ana López');
    expect(cells[1]).toContain('Carlos Pérez');
    expect(cells[2]).toContain('Luis García');
  });

  it('toggles sort direction on header click', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Empleado'));
    const cells = screen.getAllByRole('row').slice(1).map(row => row.querySelector('td')?.textContent);
    expect(cells[0]).toContain('Luis García');
  });
});

describe('ReviewListView row click', () => {
  it('sets selected employee on row click', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Ana López'));
    expect(useTasStore.getState().reviewSelectedEmployee).toBe('E1');
  });
});

describe('ReviewListView override indicators', () => {
  it('shows override annotation for adjusted employees', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByText(/era 2/)).toBeInTheDocument();
  });
});

describe('ReviewListView duplicates', () => {
  it('dims duplicate rows', () => {
    useTasStore.getState().setDuplicateCodes(['E1']);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const row = screen.getByText('Ana López').closest('tr')!;
    expect(row).toHaveClass('opacity-50');
  });
});

describe('ReviewListView submit', () => {
  it('disables button when DB is unhealthy', () => {
    render(<ReviewListView dbHealthy={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });

  it('calls onSubmit when Enviar is clicked', () => {
    const onSubmit = vi.fn();
    render(<ReviewListView dbHealthy={true} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
