import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, fechasNoLaboradas: [], horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, fechasNoLaboradas: ['2026-06-08'], horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 2, accruesOvertime: true },
  { codigoEmpleado: 'E3', nombreEmpleado: 'Carlos Pérez', diasNoLaborados: 0, fechasNoLaboradas: [], horasExtrasSimples: 1, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
];

const days = () => useTasStore.getState().nonWorkedDaysOverrides.none ?? {};
const decisions = () => useTasStore.getState().overtimeDecisions.none ?? {};
const renderList = () => render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);

beforeEach(() => {
  useTasStore.getState().resetTas();
  useTasStore.getState().setResolvedRows(rows);
  useTasStore.getState().setUploadToken('tok-1');
  vi.clearAllMocks();
});

describe('ReviewListView rendering', () => {
  it('renders employee rows', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Luis García')).toBeInTheDocument();
    expect(screen.getByText('Carlos Pérez')).toBeInTheDocument();
  });

  it('renders filter chips with counts', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByText('Todos')).toBeInTheDocument();
    expect(screen.getByText('Turno estimado')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByLabelText(/buscar empleado/i)).toBeInTheDocument();
  });

  it('renders Enviar button', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });
});

describe('ReviewListView filter chips', () => {
  it('filters to estimated-shift employees when chip clicked', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    fireEvent.click(screen.getByText('Turno estimado'));
    expect(screen.getByText('Luis García')).toBeInTheDocument();
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  });

  it('returns to all employees when Todos chip clicked', () => {
    useTasStore.getState().setReviewActiveFilter('estimated');
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    fireEvent.click(screen.getByText('Todos'));
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Luis García')).toBeInTheDocument();
  });
});

describe('ReviewListView sorting', () => {
  it('sorts by name ascending by default', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const rows = screen.getAllByRole('row').filter(row => row.querySelector('td'));
    const cells = rows.map(row => row.querySelector('td')?.textContent);
    expect(cells[0]).toContain('Ana López');
    expect(cells[1]).toContain('Carlos Pérez');
    expect(cells[2]).toContain('Luis García');
  });

  it('toggles sort direction on header click', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    fireEvent.click(screen.getByText('Empleado'));
    const rows = screen.getAllByRole('row').filter(row => row.querySelector('td'));
    const cells = rows.map(row => row.querySelector('td')?.textContent);
    expect(cells[0]).toContain('Luis García');
  });
});

describe('ReviewListView row click', () => {
  it('sets selected employee on row click', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    fireEvent.click(screen.getByText('Ana López'));
    expect(useTasStore.getState().reviewSelectedEmployee).toBe('E1');
  });
});

describe('ReviewListView días no laborados editing', () => {
  it('renders editable días no laborados input', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByLabelText('Días no laborados Ana López')).toBeInTheDocument();
  });

  it('pre-populates input with computed value', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const input = screen.getByLabelText('Días no laborados Ana López') as HTMLInputElement;
    expect(input.value).toBe('0');
  });

  it('updates store when días no laborados input changes', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const input = screen.getByLabelText('Días no laborados Ana López') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    expect(days().E1).toBe(3);
  });

  it('shows override annotation when días no laborados overridden', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByText(/era 0/)).toBeInTheDocument();
  });

  it('uses override value in input when set', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 5);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const input = screen.getByLabelText('Días no laborados Ana López') as HTMLInputElement;
    expect(input.value).toBe('5');
  });

  it('does not navigate when clicking días no laborados input', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const input = screen.getByLabelText('Días no laborados Ana López');
    fireEvent.click(input);
    expect(useTasStore.getState().reviewSelectedEmployee).toBeNull();
  });
});

describe('ReviewListView overtime editing', () => {
  it('renders editable overtime inputs', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByLabelText('Extras simples Ana López')).toBeInTheDocument();
    expect(screen.getByLabelText('Extras dobles Ana López')).toBeInTheDocument();
  });

  it('updates store when overtime input changes', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const input = screen.getByLabelText('Extras simples Ana López') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(decisions().E1).toEqual({ kind: 'adjusted', simples: 5, dobles: 0, calcSimples: 2, calcDobles: 0 });
  });

  it('shows the calculated figure under a value that differs from it', () => {
    useTasStore.getState().setOvertimeField(rows[0], 'simples', 5);
    useTasStore.getState().setReviewActiveFilter('all');
    renderList();
    expect(screen.getByLabelText('Extras simples Ana López')).toHaveValue(5);
    expect(screen.getByText('(calc. 2)')).toBeInTheDocument();
  });

  it('does not navigate when clicking overtime input', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const input = screen.getByLabelText('Extras simples Ana López');
    fireEvent.click(input);
    expect(useTasStore.getState().reviewSelectedEmployee).toBeNull();
  });

  it('disables overtime inputs when employee does not accrue overtime', () => {
    useTasStore.getState().setResolvedRows([{ ...rows[0], accruesOvertime: false }]);
    useTasStore.getState().setReviewActiveFilter('all');
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByLabelText('Extras simples Ana López')).toBeDisabled();
    expect(screen.getByLabelText('Extras dobles Ana López')).toBeDisabled();
  });

  it('keeps overtime inputs enabled when employee accrues overtime', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByLabelText('Extras simples Ana López')).toBeEnabled();
    expect(screen.getByLabelText('Extras dobles Ana López')).toBeEnabled();
  });
});

describe('ReviewListView adjusted chip and badge', () => {
  it('counts overtime-only override in adjusted chip', () => {
    useTasStore.getState().setOvertimeField(rows[0], 'simples', 5);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const chip = screen.getByText('Ajustados').closest('button')!;
    expect(chip.textContent).toContain('1');
  });

  it('counts diasNoLaborados-only override in adjusted chip', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E2', 3);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const chip = screen.getByText('Ajustados').closest('button')!;
    expect(chip.textContent).toContain('1');
  });

  it('counts employee with both override types only once in adjusted chip', () => {
    useTasStore.getState().setOvertimeField(rows[0], 'simples', 5);
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const chip = screen.getByText('Ajustados').closest('button')!;
    expect(chip.textContent).toContain('1');
  });

  it('shows ajustado badge when only diasNoLaborados is overridden', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const badges = screen.getAllByText(/ajustado/i);
    expect(badges.some(el => el.tagName === 'SPAN')).toBe(true);
  });

  it('adjusted filter includes rows with diasNoLaborados-only override', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E2', 3);
    useTasStore.getState().setReviewActiveFilter('adjusted');
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByText('Luis García')).toBeInTheDocument();
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  });
});

describe('ReviewListView duplicates', () => {
  it('dims duplicate rows', () => {
    useTasStore.getState().setDuplicateCodes(['E1']);
    useTasStore.getState().setReviewActiveFilter('all');
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    const row = screen.getByText('Ana López').closest('tr')!;
    expect(row).toHaveClass('opacity-50');
  });
});

describe('ReviewListView submit', () => {
  it('disables button when DB is unhealthy', () => {
    render(<ReviewListView dbHealthy={false} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });

  it('calls onSubmit when Enviar is clicked', () => {
    const onSubmit = vi.fn();
    render(<ReviewListView dbHealthy={true} onSubmit={onSubmit} onPrint={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('shows "Cambiar quincena" button when multiple periods available', () => {
    useTasStore.getState().setAvailablePeriods([
      { anio: 2026, mes: 7, numeroDequincena: 1 },
      { anio: 2026, mes: 7, numeroDequincena: 2 },
    ]);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByText('Cambiar quincena')).toBeInTheDocument();
  });

  it('hides "Cambiar quincena" button when single period', () => {
    useTasStore.getState().setAvailablePeriods([
      { anio: 2026, mes: 7, numeroDequincena: 1 },
    ]);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.queryByText('Cambiar quincena')).not.toBeInTheDocument();
  });

  it('"Cambiar quincena" navigates to verification', () => {
    useTasStore.getState().setAvailablePeriods([
      { anio: 2026, mes: 7, numeroDequincena: 1 },
      { anio: 2026, mes: 7, numeroDequincena: 2 },
    ]);
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
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
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', stateRevision: 6, resolvedRows: newRows, sessionSummaries: {} });

    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/desactivar acumulado Ana López/i));

    await waitFor(() => {
      expect(days().E1).toBeUndefined();
      expect(useTasStore.getState().stashedNonWorkedDaysOverrides.none.E1).toBe(3);
    });
    expect(useTasStore.getState().stateRevision).toBe(6);
  });
});

describe('ReviewListView overtime review', () => {
  const zeroRow: ResolvedRow = { ...rows[2], codigoEmpleado: 'E4', nombreEmpleado: 'Sin Extras', horasExtrasSimples: 0 };
  const shown = () => screen.queryAllByRole('row').map(r => r.textContent ?? '');
  const chip = (label: string) => screen.getByText(label).closest('button')!;

  it('opens on the rows whose overtime needs a decision', () => {
    useTasStore.getState().setResolvedRows([...rows, zeroRow]);
    renderList();
    expect(chip('Por revisar')).toHaveTextContent('3');
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.queryByText('Sin Extras')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Extras simples Ana López')).toHaveValue(0);
    expect(screen.getByText('(calc. 2)')).toBeInTheDocument();
    expect(screen.getByText(/3 sin aprobar \(se envían en 0\)/)).toBeInTheDocument();
  });

  it('approving keeps the row in view until the chip is pressed again', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar horas extra Ana López' }));
    expect(decisions().E1.kind).toBe('approved');
    expect(screen.getByText('✓ Aprobado')).toBeInTheDocument();
    expect(screen.getByLabelText('Extras simples Ana López')).toHaveValue(2);
    expect(chip('Por revisar')).toHaveTextContent('2');
    expect(screen.getByText('mostrando 3')).toBeInTheDocument();
    expect(screen.getByText(/1 aprobado · 2 sin aprobar/)).toBeInTheDocument();
    expect(useTasStore.getState().reviewSelectedEmployee).toBeNull();

    fireEvent.click(chip('Por revisar'));
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
    expect(screen.queryByText(/mostrando/)).not.toBeInTheDocument();
  });

  it('does not drop a row from under the cursor while a value is typed', () => {
    renderList();
    const input = screen.getByLabelText('Extras simples Ana López');
    fireEvent.change(input, { target: { value: '1' } });
    expect(screen.getByLabelText('Extras simples Ana López')).toBe(input);
    fireEvent.change(input, { target: { value: '1.5' } });
    expect(decisions().E1.simples).toBe(1.5);
    expect(screen.getByText('Ajustado')).toBeInTheDocument();
  });

  it('takes the list again when the rows are recalculated, keeping rows still to review', () => {
    useTasStore.getState().approveOvertime(rows[0]);
    renderList();
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
    act(() => useTasStore.getState().setResolvedRows([{ ...rows[0], horasExtrasSimples: 3 }, rows[1]]));
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('el cálculo cambió')).toBeInTheDocument();
    expect(screen.queryByText('Carlos Pérez')).not.toBeInTheDocument();
  });

  it('Deshacer takes an approval or an adjustment back to unapproved', () => {
    useTasStore.getState().approveOvertime(rows[0]);
    useTasStore.getState().setOvertimeField(rows[1], 'dobles', 0);
    useTasStore.getState().setReviewActiveFilter('all');
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer horas extra Ana López' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer horas extra Luis García' }));
    expect(decisions()).toEqual({});
    expect(screen.getAllByRole('button', { name: /^Aprobar horas extra/ })).toHaveLength(3);
  });

  it('Mantener confirms a hand value after the calculation changed', () => {
    useTasStore.getState().setOvertimeField(rows[0], 'simples', 1);
    useTasStore.getState().setResolvedRows([{ ...rows[0], horasExtrasSimples: 4 }, rows[1], rows[2]]);
    renderList();
    expect(chip('Por revisar')).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: 'Mantener ajuste Ana López' }));
    expect(decisions().E1).toEqual({ kind: 'adjusted', simples: 1, dobles: 0, calcSimples: 4, calcDobles: 0 });
    expect(chip('Por revisar')).toHaveTextContent('2');
  });

  it('says when nothing is left to review and offers every row', () => {
    for (const r of rows) useTasStore.getState().approveOvertime(r);
    renderList();
    expect(screen.getByText(/No hay horas extra por revisar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));
    expect(useTasStore.getState().reviewActiveFilter).toBe('all');
    expect(shown().some(t => t.includes('Ana López'))).toBe(true);
  });

  it('leaves duplicates out of the review and counts only rows on screen as adjusted', () => {
    useTasStore.getState().setDuplicateCodes(['E1']);
    useTasStore.getState().setOvertimeField(rows[0], 'simples', 1);
    useTasStore.getState().setNonWorkedDaysOverride('E9', 1);
    renderList();
    expect(chip('Por revisar')).toHaveTextContent('2');
    expect(chip('Ajustados')).toHaveTextContent('0');
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  });

  it('a mouse wheel over a focused number does not change it', () => {
    renderList();
    const input = screen.getByLabelText('Extras simples Ana López');
    input.focus();
    fireEvent.wheel(input);
    expect(input).not.toHaveFocus();
    const dias = screen.getByLabelText('Días no laborados Ana López');
    dias.focus();
    fireEvent.wheel(dias);
    expect(dias).not.toHaveFocus();
  });
});

describe('ReviewListView incomplete quincena banner', () => {
  it('renders no banner by default', () => {
    render(<ReviewListView dbHealthy={true} onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.queryByText(/quincena incompleta/i)).not.toBeInTheDocument();
  });

  it('renders one banner per incomplete period', () => {
    render(
      <ReviewListView
        dbHealthy={true}
        onSubmit={vi.fn()} onPrint={vi.fn()}
        incompletePeriods={[
          { anio: 2026, mes: 9, numeroDequincena: 2, periodStart: '2026-09-16', periodEnd: '2026-09-30', dataStart: '2026-09-28', dataEnd: '2026-10-11', missingWorkingDays: ['2026-09-26'] },
          { anio: 2026, mes: 10, numeroDequincena: 1, periodStart: '2026-10-01', periodEnd: '2026-10-15', dataStart: '2026-09-28', dataEnd: '2026-10-11', missingWorkingDays: ['2026-10-12'] },
        ]}
      />,
    );
    expect(screen.getAllByText(/quincena incompleta/i)).toHaveLength(2);
    expect(screen.getByText(/septiembre 2026 · q2/i)).toBeInTheDocument();
  });
});

describe('ReviewListView coverage loading', () => {
  it('disables Enviar while the coverage check is loading', () => {
    render(<ReviewListView dbHealthy={true} coverageLoading onSubmit={vi.fn()} onPrint={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^enviar$/i })).toBeDisabled();
  });
});
