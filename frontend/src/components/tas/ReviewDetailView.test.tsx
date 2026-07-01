import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewDetailView from './ReviewDetailView';
import { useTasStore } from '../../tasStore';
import { useToastStore } from '../../toastStore';
import * as configApi from '../../configApi';
import * as tasApi from '../../tasApi';
import type { ResolvedRow, SessionSummary } from '../../tasTypes';

vi.mock('../../configApi');
vi.mock('../../tasApi');

const mockUpdateAccruesOvertime = vi.mocked(configApi.updateAccruesOvertime);
const mockRecomputeTas = vi.mocked(tasApi.recomputeTas);

const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 2, accruesOvertime: true },
  { codigoEmpleado: 'E3', nombreEmpleado: 'Carlos Pérez', diasNoLaborados: 0, horasExtrasSimples: 1, horasExtrasDobles: 0, mes: 6, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
];

const summaries: Record<string, SessionSummary[]> = {
  E1: [
    { date: '2026-06-02', shiftName: 'Mañana', entryTime: '2026-06-02T07:02:00', exitTime: '2026-06-02T15:05:00', workedHours: 8.0, simplesMinutes: 30, doblesMinutes: 0, scans: ['2026-06-02T07:02', '2026-06-02T12:31', '2026-06-02T13:05', '2026-06-02T15:05'] },
    { date: '2026-06-03', shiftName: 'Mañana', entryTime: '2026-06-03T07:00:00', exitTime: '2026-06-03T15:00:00', workedHours: 8.0, simplesMinutes: 0, doblesMinutes: 0, scans: ['2026-06-03T07:00', '2026-06-03T15:00'] },
  ],
  E2: [
    { date: '2026-06-02', shiftName: 'Tarde', entryTime: '2026-06-02T14:00:00', exitTime: '2026-06-02T22:00:00', workedHours: 8.0, simplesMinutes: 0, doblesMinutes: 60, scans: ['2026-06-02T14:00', '2026-06-02T22:00'], estimatedShift: true },
    { date: '2026-06-03', shiftName: 'Mañana', entryTime: '2026-06-03T07:00:00', exitTime: '2026-06-03T15:00:00', workedHours: 8.0, simplesMinutes: 0, doblesMinutes: 0, scans: ['2026-06-03T07:00', '2026-06-03T15:00'], estimatedShift: true },
  ],
};

const onBack = vi.fn();

beforeEach(() => {
  useTasStore.getState().resetTas();
  useToastStore.setState({ toasts: [] });
  useTasStore.getState().setResolvedRows(rows);
  useTasStore.getState().setSessionSummaries(summaries);
  useTasStore.getState().setReviewSelectedEmployee('E1');
  useTasStore.getState().setUploadToken('tok-1');
  vi.clearAllMocks();
});

describe('ReviewDetailView rendering', () => {
  it('shows employee name and code', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText(/E1/)).toBeInTheDocument();
  });

  it('shows session rows', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getAllByText('Mañana')).toHaveLength(2);
    expect(screen.getAllByText('07:02').length).toBeGreaterThanOrEqual(1);
  });

  it('shows position indicator', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
  });

  it('returns null when no employee is selected', () => {
    useTasStore.getState().setReviewSelectedEmployee(null);
    const { container } = render(<ReviewDetailView onBack={onBack} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows empty state when no sessions exist', () => {
    useTasStore.getState().setReviewSelectedEmployee('E3');
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByText('Sin sesiones registradas.')).toBeInTheDocument();
  });

  it('shows alert badge for estimated shift days', () => {
    useTasStore.getState().setReviewSelectedEmployee('E2');
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByText(/2 día\(s\) con turno estimado/)).toBeInTheDocument();
  });

  it('does not show alert badge when diasTurnoEstimado is 0', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.queryByText(/día\(s\) con turno estimado/)).not.toBeInTheDocument();
  });

  it('shows est. badge on estimated shift session rows', () => {
    useTasStore.getState().setReviewSelectedEmployee('E2');
    render(<ReviewDetailView onBack={onBack} />);
    const badges = screen.getAllByText('est.');
    expect(badges).toHaveLength(2);
    expect(badges[0].closest('tr')).toHaveClass('bg-warning-container/20');
  });

  it('does not show est. badge on normal session rows', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.queryByText('est.')).not.toBeInTheDocument();
  });

  it('shows totals row when sessions exist', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByText('Totales quincena')).toBeInTheDocument();
  });
});

describe('ReviewDetailView scan expansion', () => {
  it('shows scans expanded by default', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByText('12:31')).toBeInTheDocument();
    expect(screen.getByText('13:05')).toBeInTheDocument();
  });

  it('collapse all link collapses all rows', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByText('12:31')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/colapsar marcaciones/i));
    expect(screen.queryByText('12:31')).not.toBeInTheDocument();
  });

  it('expand all link re-expands collapsed rows', () => {
    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByText(/colapsar marcaciones/i));
    expect(screen.queryByText('12:31')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/expandir marcaciones/i));
    expect(screen.getByText('12:31')).toBeInTheDocument();
  });

  it('individual row toggle collapses a single row', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const expandBtns = screen.getAllByRole('button', { name: /marcaciones/i });
    fireEvent.click(expandBtns[0]);
    expect(screen.queryByText('12:31')).not.toBeInTheDocument();
  });
});

describe('ReviewDetailView días no laborados adjustment', () => {
  it('renders días no laborados input with computed value', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toHaveValue(0);
  });

  it('updates store when días no laborados is changed', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3' } });
    expect(useTasStore.getState().nonWorkedDaysOverrides).toEqual({ E1: 3 });
  });

  it('shows computed label for días no laborados', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getAllByText(/calculado: 0/).length).toBeGreaterThanOrEqual(1);
  });

  it('clamps negative días no laborados to 0', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '-2' } });
    expect(useTasStore.getState().nonWorkedDaysOverrides).toEqual({ E1: 0 });
  });

  it('removes override when días no laborados input is cleared', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: 'abc' } });
    expect(useTasStore.getState().nonWorkedDaysOverrides).toEqual({});
  });

  it('shows override value when set', () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 4);
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(4);
  });
});

describe('ReviewDetailView overtime adjustment', () => {
  it('renders overtime inputs with computed values', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(3);
    expect(inputs[1]).toHaveValue(2);
    expect(inputs[2]).toHaveValue(0);
  });

  it('updates store when overtime is changed', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1], { target: { value: '5' } });
    expect(useTasStore.getState().overtimeOverrides).toEqual({ E1: { horasExtrasSimples: 5 } });
  });

  it('shows computed label next to overtime input', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByText(/calculado: 2/)).toBeInTheDocument();
  });

  it('clamps negative overtime values to 0', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1], { target: { value: '-3' } });
    expect(useTasStore.getState().overtimeOverrides).toEqual({ E1: { horasExtrasSimples: 0 } });
  });

  it('clamps NaN overtime values to 0', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1], { target: { value: 'abc' } });
    expect(useTasStore.getState().overtimeOverrides).toEqual({ E1: { horasExtrasSimples: 0 } });
  });
});

describe('ReviewDetailView navigation', () => {
  it('calls onBack when Volver is clicked', () => {
    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByText(/volver/i));
    expect(onBack).toHaveBeenCalled();
  });

  it('navigates to next employee in sort order', () => {
    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(useTasStore.getState().reviewSelectedEmployee).toBe('E3');
  });

  it('navigates to previous employee in sort order', () => {
    useTasStore.getState().setReviewSelectedEmployee('E2');
    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /anterior/i }));
    expect(useTasStore.getState().reviewSelectedEmployee).toBe('E3');
  });

  it('disables previous on first employee', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
  });

  it('disables next on last employee', () => {
    useTasStore.getState().setReviewSelectedEmployee('E2');
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled();
  });

  it('expands scans for new employee on navigation', () => {
    useTasStore.getState().setReviewSelectedEmployee('E3');
    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(useTasStore.getState().reviewSelectedEmployee).toBe('E2');
    expect(useTasStore.getState().reviewExpandedScans.size).toBeGreaterThan(0);
  });
});

describe('ReviewDetailView accruesOvertime toggle', () => {
  it('renders toggle switch', () => {
    render(<ReviewDetailView onBack={onBack} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('disables extras inputs when employee does not accrue overtime', () => {
    useTasStore.getState().setResolvedRows([{ ...rows[0], accruesOvertime: false, horasExtrasSimples: 0, horasExtrasDobles: 0 }, rows[1], rows[2]]);
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toBeEnabled();
    expect(inputs[1]).toBeDisabled();
    expect(inputs[2]).toBeDisabled();
  });

  it('keeps extras inputs enabled when employee accrues overtime', () => {
    render(<ReviewDetailView onBack={onBack} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[1]).toBeEnabled();
    expect(inputs[2]).toBeEnabled();
  });

  it('calls updateAccruesOvertime then recomputeTas on toggle', async () => {
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    const newRows = [{ ...rows[0], accruesOvertime: false, horasExtrasSimples: 0, horasExtrasDobles: 0 }, rows[1], rows[2]];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: newRows, sessionSummaries: summaries });

    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(mockUpdateAccruesOvertime).toHaveBeenCalledWith('E1', false));
    await waitFor(() => expect(mockRecomputeTas).toHaveBeenCalledWith('tok-1'));
  });

  it('stashes nonWorkedDaysOverride when accruesOvertime is toggled off', async () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    const newRows = [{ ...rows[0], accruesOvertime: false, horasExtrasSimples: 0, horasExtrasDobles: 0 }, rows[1], rows[2]];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: newRows, sessionSummaries: summaries });

    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(useTasStore.getState().nonWorkedDaysOverrides['E1']).toBeUndefined();
      expect(useTasStore.getState().stashedNonWorkedDaysOverrides['E1']).toBe(3);
    });
  });

  it('restores nonWorkedDaysOverride when accruesOvertime is toggled back on', async () => {
    useTasStore.getState().setNonWorkedDaysOverride('E1', 3);
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    const offRows = [{ ...rows[0], accruesOvertime: false, horasExtrasSimples: 0, horasExtrasDobles: 0 }, rows[1], rows[2]];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: offRows, sessionSummaries: summaries });

    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(useTasStore.getState().stashedNonWorkedDaysOverrides['E1']).toBe(3));

    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: true,
    });
    const onRows = [{ ...rows[0], accruesOvertime: true }, rows[1], rows[2]];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: onRows, sessionSummaries: summaries });

    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      expect(useTasStore.getState().nonWorkedDaysOverrides['E1']).toBe(3);
      expect(useTasStore.getState().stashedNonWorkedDaysOverrides['E1']).toBeUndefined();
    });
  });

  it('shows error toast when updateAccruesOvertime fails', async () => {
    mockUpdateAccruesOvertime.mockRejectedValue(new Error('network'));

    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some(t => t.variant === 'error')).toBe(true);
    });
  });

  it('shows error toast when recomputeTas fails', async () => {
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    mockRecomputeTas.mockRejectedValue(new Error('expired'));

    render(<ReviewDetailView onBack={onBack} />);
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some(t => t.variant === 'error')).toBe(true);
    });
  });

  it('shows break deduction pill when breakDeductionMinutes > 0', () => {
    const summariesWithBreak: Record<string, SessionSummary[]> = {
      E1: [
        { date: '2026-06-02', shiftName: 'Mañana', entryTime: '2026-06-02T07:00:00', exitTime: '2026-06-02T15:00:00', workedHours: 7.0, simplesMinutes: 0, doblesMinutes: 0, scans: ['2026-06-02T07:00', '2026-06-02T11:30', '2026-06-02T13:00', '2026-06-02T15:00'], breakDeductionMinutes: 45 },
      ],
    };
    useTasStore.getState().setSessionSummaries(summariesWithBreak);

    render(<ReviewDetailView onBack={onBack} />);

    expect(screen.getByText('Almuerzo −45m')).toBeInTheDocument();
  });
});
