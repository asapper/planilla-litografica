import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useConfigStore } from '../../configStore';
import * as configApi from '../../configApi';

vi.mock('../../configApi');

const mockGetEmployees   = vi.mocked(configApi.getEmployees);
const mockGetShifts      = vi.mocked(configApi.getShifts);
const mockUpdateEmployee = vi.mocked(configApi.updateEmployee);
const mockBulkAssign     = vi.mocked(configApi.bulkAssignShift);

const shift1 = { id: 'manana', name: 'Diurno', startTime: '08:00', endTime: '17:00', crossMidnight: false };
const emp1 = { id: 'emp1', code: 'EMP001', name: 'Ana García', shiftId: 'manana', shiftName: 'Diurno', active: true };
const emp2 = { id: 'emp2', code: 'EMP002', name: 'Carlos López', shiftId: null, shiftName: null, active: false };

const { default: EmployeesTab } = await import('./EmployeesTab');

beforeEach(() => {
  useConfigStore.setState({
    activeTab: 'employees',
    shifts: { loading: false, data: null, dirty: false, error: null },
    employees: { loading: false, data: null, dirty: false, error: null },
    holidays: { loading: false, data: null, dirty: false, error: null },
    general: { loading: false, data: null, dirty: false, error: null },
    toastVisible: false,
    toastMessage: '',
    holidayYear: 2026,
  });
  vi.clearAllMocks();
  mockGetEmployees.mockResolvedValue([emp1, emp2]);
  mockGetShifts.mockResolvedValue([shift1]);
});

// -----------------------------------------------------------------
// Loading & empty
// -----------------------------------------------------------------

describe('EmployeesTab loading', () => {
  it('fetches employees and shifts on mount', async () => {
    render(<EmployeesTab />);
    await waitFor(() => expect(mockGetEmployees).toHaveBeenCalledOnce());
    expect(mockGetShifts).toHaveBeenCalledOnce();
  });

  it('shows spinner while loading', async () => {
    mockGetEmployees.mockReturnValue(new Promise(() => {}));
    render(<EmployeesTab />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('shows empty state message when no employees', async () => {
    mockGetEmployees.mockResolvedValue([]);
    render(<EmployeesTab />);
    await waitFor(() =>
      expect(screen.getByText(/aún no hay empleados registrados/i)).toBeInTheDocument()
    );
  });

  it('shows note about TAS file upload', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    expect(screen.getByText(/se agregan automáticamente/i)).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Table rendering
// -----------------------------------------------------------------

describe('EmployeesTab table', () => {
  it('shows employee code', async () => {
    render(<EmployeesTab />);
    await waitFor(() => expect(screen.getByText('EMP001')).toBeInTheDocument());
  });

  it('shows employee name', async () => {
    render(<EmployeesTab />);
    await waitFor(() => expect(screen.getByText('Ana García')).toBeInTheDocument());
  });

  it('shows active toggle for each employee', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    const toggles = screen.getAllByRole('switch');
    expect(toggles).toHaveLength(2);
  });
});

// -----------------------------------------------------------------
// Filtering
// -----------------------------------------------------------------

describe('EmployeesTab filtering', () => {
  it('filters by search text (name)', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    fireEvent.change(screen.getByLabelText(/buscar empleado/i), { target: { value: 'ana' } });
    expect(screen.getByText('Ana García')).toBeInTheDocument();
    expect(screen.queryByText('Carlos López')).not.toBeInTheDocument();
  });

  it('filters by search text (code)', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    fireEvent.change(screen.getByLabelText(/buscar empleado/i), { target: { value: 'EMP002' } });
    expect(screen.queryByText('Ana García')).not.toBeInTheDocument();
    expect(screen.getByText('Carlos López')).toBeInTheDocument();
  });

  it('filter pill Activos shows only active employees', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    fireEvent.click(screen.getByRole('button', { name: 'Activos' }));
    expect(screen.getByText('Ana García')).toBeInTheDocument();
    expect(screen.queryByText('Carlos López')).not.toBeInTheDocument();
  });

  it('filter pill Inactivos shows only inactive employees', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    fireEvent.click(screen.getByRole('button', { name: 'Inactivos' }));
    expect(screen.queryByText('Ana García')).not.toBeInTheDocument();
    expect(screen.getByText('Carlos López')).toBeInTheDocument();
  });

  it('filter pill Todos shows all employees', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    fireEvent.click(screen.getByRole('button', { name: 'Activos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    expect(screen.getByText('Ana García')).toBeInTheDocument();
    expect(screen.getByText('Carlos López')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Row selection & bulk assign
// -----------------------------------------------------------------

describe('EmployeesTab bulk assign', () => {
  it('shows bulk action bar when at least one row is selected', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    fireEvent.click(screen.getByLabelText('Seleccionar Ana García'));
    expect(screen.getByText('1 seleccionado(s)')).toBeInTheDocument();
  });

  it('does not show bulk action bar when nothing is selected', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    expect(screen.queryByText(/seleccionado/i)).not.toBeInTheDocument();
  });

  it('select all checkbox selects all filtered employees', async () => {
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    fireEvent.click(screen.getByLabelText('Seleccionar todos'));
    expect(screen.getByText('2 seleccionado(s)')).toBeInTheDocument();
  });

  it('calls bulkAssignShift on Aplicar button click', async () => {
    mockBulkAssign.mockResolvedValue(undefined);
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));

    fireEvent.click(screen.getByLabelText('Seleccionar Ana García'));

    const dropdown = screen.getByLabelText(/turno para asignación masiva/i);
    fireEvent.change(dropdown, { target: { value: 'manana' } });

    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }));
    await waitFor(() => expect(mockBulkAssign).toHaveBeenCalledWith(['emp1'], 'manana'));
  });

  it('shows toast after successful bulk assign', async () => {
    mockBulkAssign.mockResolvedValue(undefined);
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));

    fireEvent.click(screen.getByLabelText('Seleccionar Ana García'));
    const dropdown = screen.getByLabelText(/turno para asignación masiva/i);
    fireEvent.change(dropdown, { target: { value: 'manana' } });
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }));

    await waitFor(() => expect(useConfigStore.getState().toastVisible).toBe(true));
  });
});

// -----------------------------------------------------------------
// Active toggle
// -----------------------------------------------------------------

describe('EmployeesTab active toggle', () => {
  it('calls updateEmployee with new active state on toggle', async () => {
    mockUpdateEmployee.mockResolvedValue({ ...emp1, active: false });
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));

    const toggles = screen.getAllByRole('switch');
    fireEvent.click(toggles[0]);
    await waitFor(() => expect(mockUpdateEmployee).toHaveBeenCalledWith('emp1', { active: false }));
  });

  it('shows toast after successful active toggle', async () => {
    mockUpdateEmployee.mockResolvedValue({ ...emp1, active: false });
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(useConfigStore.getState().toastVisible).toBe(true));
  });

  it('shows reactivation note when activating employee with no shift', async () => {
    const empNoShift = { id: 'emp3', code: 'EMP003', name: 'Pedro', shiftId: null, shiftName: null, active: false };
    mockGetEmployees.mockResolvedValue([empNoShift]);
    mockUpdateEmployee.mockResolvedValue({ ...empNoShift, active: true });
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('Pedro'));
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(screen.getByText(/turno restablecido al turno por defecto/i)).toBeInTheDocument());
  });

  it('reactivation note can be dismissed', async () => {
    const empNoShift = { id: 'emp3', code: 'EMP003', name: 'Pedro', shiftId: null, shiftName: null, active: false };
    mockGetEmployees.mockResolvedValue([empNoShift]);
    mockUpdateEmployee.mockResolvedValue({ ...empNoShift, active: true });
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('Pedro'));
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => screen.getByText(/turno restablecido/i));
    fireEvent.click(screen.getByLabelText(/descartar nota/i));
    expect(screen.queryByText(/turno restablecido/i)).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Error handling
// -----------------------------------------------------------------

describe('EmployeesTab errors', () => {
  it('shows error when initial load fails', async () => {
    mockGetEmployees.mockRejectedValue(new Error('network'));
    render(<EmployeesTab />);
    await waitFor(() => expect(screen.getByText(/no se pudo cargar/i)).toBeInTheDocument());
  });

  it('shows error when updateEmployee fails', async () => {
    mockUpdateEmployee.mockRejectedValue(new Error('server error'));
    render(<EmployeesTab />);
    await waitFor(() => screen.getByText('EMP001'));
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(screen.getByText(/no se pudo actualizar/i)).toBeInTheDocument());
  });
});
