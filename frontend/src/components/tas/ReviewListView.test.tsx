import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewListView from './ReviewListView';
import { useTasStore } from '../../tasStore';
import * as configApi from '../../configApi';
import * as tasApi from '../../tasApi';
import type { ResolvedRow } from '../../tasTypes';

vi.mock('../../configApi');
vi.mock('../../tasApi');

const mockUpdateAccruesOvertime = vi.mocked(configApi.updateAccruesOvertime);
const mockRecomputeTas = vi.mocked(tasApi.recomputeTas);

const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 2, accruesOvertime: true },
  { codigoEmpleado: 'E3', nombreEmpleado: 'Carlos Pérez', diasNoLaborados: 0, horasExtrasSimples: 1, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
];

beforeEach(() => {
  useTasStore.getState().resetTas();
  useTasStore.getState().setResolvedRows(rows);
  useTasStore.getState().setUploadToken('tok-1');
  vi.clearAllMocks();
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
    const rows = screen.getAllByRole('row').filter(row => row.querySelector('td'));
    const cells = rows.map(row => row.querySelector('td')?.textContent);
    expect(cells[0]).toContain('Ana López');
    expect(cells[1]).toContain('Carlos Pérez');
    expect(cells[2]).toContain('Luis García');
  });

  it('toggles sort direction on header click', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Empleado'));
    const rows = screen.getAllByRole('row').filter(row => row.querySelector('td'));
    const cells = rows.map(row => row.querySelector('td')?.textContent);
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

describe('ReviewListView días no laborados editing', () => {
  it('renders editable días no laborados input', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Días no laborados Ana López')).toBeInTheDocument();
  });

  it('pre-populates input with computed value', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText('Días no laborados Ana López') as HTMLInputElement;
    expect(input.value).toBe('0');
  });

  it('updates store when días no laborados input changes', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText('Días no laborados Ana López') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    expect(useTasStore.getState().nonWorkedDaysOverrides['E1']).toBe(3);
  });

  it('shows override annotation when días no laborados overridden', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByText(/era 0/)).toBeInTheDocument();
  });

  it('uses override value in input when set', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 5);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText('Días no laborados Ana López') as HTMLInputElement;
    expect(input.value).toBe('5');
  });

  it('does not navigate when clicking días no laborados input', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText('Días no laborados Ana López');
    fireEvent.click(input);
    expect(useTasStore.getState().reviewSelectedEmployee).toBeNull();
  });
});

describe('ReviewListView overtime editing', () => {
  it('renders editable overtime inputs', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Extras simples Ana López')).toBeInTheDocument();
    expect(screen.getByLabelText('Extras dobles Ana López')).toBeInTheDocument();
  });

  it('updates store when overtime input changes', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText('Extras simples Ana López') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(useTasStore.getState().overtimeOverrides['E1']?.horasExtrasSimples).toBe(5);
  });

  it('shows override annotation for adjusted employees', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByText(/era 2/)).toBeInTheDocument();
  });

  it('does not navigate when clicking overtime input', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText('Extras simples Ana López');
    fireEvent.click(input);
    expect(useTasStore.getState().reviewSelectedEmployee).toBeNull();
  });
});

describe('ReviewListView adjusted chip and badge', () => {
  it('counts overtime-only override in adjusted chip', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const chip = screen.getByText('Ajustados').closest('button')!;
    expect(chip.textContent).toContain('1');
  });

  it('counts diasNoLaborados-only override in adjusted chip', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E2', 3);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const chip = screen.getByText('Ajustados').closest('button')!;
    expect(chip.textContent).toContain('1');
  });

  it('counts employee with both override types only once in adjusted chip', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const chip = screen.getByText('Ajustados').closest('button')!;
    expect(chip.textContent).toContain('1');
  });

  it('shows ajustado badge when only diasNoLaborados is overridden', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    const badges = screen.getAllByText(/ajustado/i);
    expect(badges.some(el => el.tagName === 'SPAN')).toBe(true);
  });

  it('adjusted filter includes rows with diasNoLaborados-only override', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E2', 3);
    useTasStore.getState().setReviewActiveFilter('adjusted');
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByText('Luis García')).toBeInTheDocument();
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
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

  it('shows "Cambiar quincena" button when multiple periods available', () => {
    useTasStore.getState().setAvailablePeriods([
      { anio: 2026, mes: 7, numeroDequincena: 1 },
      { anio: 2026, mes: 7, numeroDequincena: 2 },
    ]);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.getByText('Cambiar quincena')).toBeInTheDocument();
  });

  it('hides "Cambiar quincena" button when single period', () => {
    useTasStore.getState().setAvailablePeriods([
      { anio: 2026, mes: 7, numeroDequincena: 1 },
    ]);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    expect(screen.queryByText('Cambiar quincena')).not.toBeInTheDocument();
  });

  it('"Cambiar quincena" navigates to verification', () => {
    useTasStore.getState().setAvailablePeriods([
      { anio: 2026, mes: 7, numeroDequincena: 1 },
      { anio: 2026, mes: 7, numeroDequincena: 2 },
    ]);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Cambiar quincena'));
    expect(useTasStore.getState().tasView).toBe('verification');
  });
});

describe('ReviewListView accruesOvertime toggle', () => {
  it('stashes nonWorkedDaysOverride when accruesOvertime is toggled off', async () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    const newRows = [{ ...rows[0], accruesOvertime: false, horasExtrasSimples: 0, horasExtrasDobles: 0 }, rows[1], rows[2]];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: newRows, sessionSummaries: {} });

    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/desactivar acumulado Ana López/i));

    await waitFor(() => {
      expect(useTasStore.getState().nonWorkedDaysOverrides['E1']).toBeUndefined();
      expect(useTasStore.getState().stashedNonWorkedDaysOverrides['E1']).toBe(3);
    });
  });
});
