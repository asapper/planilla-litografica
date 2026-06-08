import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useConfigStore } from '../configStore';

vi.mock('./config/ShiftsTab', () => ({
  default: () => <div data-testid="shifts-tab" />,
}));
vi.mock('./config/EmployeesTab', () => ({
  default: () => <div data-testid="employees-tab" />,
}));
vi.mock('./config/HolidaysTab', () => ({
  default: () => <div data-testid="holidays-tab" />,
}));
vi.mock('./config/GeneralTab', () => ({
  default: () => <div data-testid="general-tab" />,
}));

const { default: ConfigPage } = await import('./ConfigPage');

beforeEach(() => {
  useConfigStore.setState({
    activeTab: 'shifts',
    shifts: { loading: false, data: null, dirty: false, error: null },
    employees: { loading: false, data: null, dirty: false, error: null },
    holidays: { loading: false, data: null, dirty: false, error: null },
    general: { loading: false, data: null, dirty: false, error: null },
    toastVisible: false,
    toastMessage: '',
    holidayYear: 2026,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// -----------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------

describe('ConfigPage rendering', () => {
  it('renders the Configuración heading', () => {
    render(<ConfigPage />);
    expect(screen.getByText('Configuración')).toBeInTheDocument();
  });

  it('renders all four tab buttons', () => {
    render(<ConfigPage />);
    expect(screen.getByRole('tab', { name: 'Turnos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Empleados' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Feriados' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
  });

  it('shows ShiftsTab when activeTab is shifts', () => {
    render(<ConfigPage />);
    expect(screen.getByTestId('shifts-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('employees-tab')).not.toBeInTheDocument();
  });

  it('Turnos tab is initially selected (aria-selected)', () => {
    render(<ConfigPage />);
    const tab = screen.getByRole('tab', { name: 'Turnos' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});

// -----------------------------------------------------------------
// Tab switching
// -----------------------------------------------------------------

describe('ConfigPage tab switching', () => {
  it('clicking Empleados tab shows EmployeesTab', () => {
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Empleados' }));
    expect(screen.getByTestId('employees-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('shifts-tab')).not.toBeInTheDocument();
  });

  it('clicking Feriados tab shows HolidaysTab', () => {
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Feriados' }));
    expect(screen.getByTestId('holidays-tab')).toBeInTheDocument();
  });

  it('clicking General tab shows GeneralTab', () => {
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.getByTestId('general-tab')).toBeInTheDocument();
  });

  it('clicking the active tab does not change view', () => {
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Turnos' }));
    expect(screen.getByTestId('shifts-tab')).toBeInTheDocument();
    expect(useConfigStore.getState().activeTab).toBe('shifts');
  });

  it('selected tab gets aria-selected=true', () => {
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Turnos' })).toHaveAttribute('aria-selected', 'false');
  });
});

// -----------------------------------------------------------------
// Unsaved changes guard
// -----------------------------------------------------------------

describe('ConfigPage unsaved changes guard', () => {
  it('shows guard modal when switching tabs with unsaved changes', () => {
    useConfigStore.getState().setShiftsDirty(true);
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Empleados' }));
    expect(screen.getByText(/tienes cambios sin guardar/i)).toBeInTheDocument();
  });

  it('guard shows Descartar cambios and Seguir editando buttons', () => {
    useConfigStore.getState().setShiftsDirty(true);
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Empleados' }));
    expect(screen.getByRole('button', { name: /descartar cambios/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /seguir editando/i })).toBeInTheDocument();
  });

  it('clicking Descartar cambios navigates to pending tab and clears dirty', () => {
    useConfigStore.getState().setShiftsDirty(true);
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Empleados' }));
    fireEvent.click(screen.getByRole('button', { name: /descartar cambios/i }));
    expect(screen.getByTestId('employees-tab')).toBeInTheDocument();
    expect(useConfigStore.getState().shifts.dirty).toBe(false);
    expect(screen.queryByText(/tienes cambios sin guardar/i)).not.toBeInTheDocument();
  });

  it('clicking Seguir editando keeps current tab and closes modal', () => {
    useConfigStore.getState().setShiftsDirty(true);
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Empleados' }));
    fireEvent.click(screen.getByRole('button', { name: /seguir editando/i }));
    expect(screen.getByTestId('shifts-tab')).toBeInTheDocument();
    expect(useConfigStore.getState().shifts.dirty).toBe(true);
    expect(screen.queryByText(/tienes cambios sin guardar/i)).not.toBeInTheDocument();
  });

  it('does not show guard when no unsaved changes', () => {
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Empleados' }));
    expect(screen.queryByText(/tienes cambios sin guardar/i)).not.toBeInTheDocument();
  });

  it('clears employees dirty when discarding from employees tab', () => {
    useConfigStore.getState().setActiveTab('employees');
    useConfigStore.getState().setEmployeesDirty(true);
    render(<ConfigPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    fireEvent.click(screen.getByRole('button', { name: /descartar cambios/i }));
    expect(useConfigStore.getState().employees.dirty).toBe(false);
  });
});

// -----------------------------------------------------------------
// Toast
// -----------------------------------------------------------------

describe('ConfigPage toast', () => {
  it('shows toast when toastVisible is true', () => {
    useConfigStore.getState().showToast('Cambios guardados');
    render(<ConfigPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Cambios guardados')).toBeInTheDocument();
  });

  it('does not show toast when toastVisible is false', () => {
    render(<ConfigPage />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('toast auto-hides after 3 seconds', async () => {
    vi.useFakeTimers();
    useConfigStore.getState().showToast('Cambios guardados');
    render(<ConfigPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(useConfigStore.getState().toastVisible).toBe(false);
  });

  it('toast remains visible before 3 seconds', async () => {
    vi.useFakeTimers();
    useConfigStore.getState().showToast('msg');
    render(<ConfigPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
