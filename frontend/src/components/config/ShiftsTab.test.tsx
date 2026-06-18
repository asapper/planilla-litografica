import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useConfigStore } from '../../configStore';
import * as configApi from '../../configApi';

vi.mock('../../configApi');

const mockGetShifts   = vi.mocked(configApi.getShifts);
const mockCreateShift = vi.mocked(configApi.createShift);
const mockUpdateShift = vi.mocked(configApi.updateShift);
const mockDeleteShift = vi.mocked(configApi.deleteShift);

const shift1 = { id: 'manana', name: 'Diurno', startTime: '08:00', endTime: '17:00', crossMidnight: false, detectionBeforeMinutes: 60, detectionAfterMinutes: 10 };
const shift2 = { id: 'nocturno', name: 'Nocturno', startTime: '22:00', endTime: '06:00', crossMidnight: true, detectionBeforeMinutes: 60, detectionAfterMinutes: 50 };

const { default: ShiftsTab } = await import('./ShiftsTab');

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
  vi.clearAllMocks();
  mockGetShifts.mockResolvedValue([shift1]);
});

// -----------------------------------------------------------------
// Loading
// -----------------------------------------------------------------

describe('ShiftsTab loading', () => {
  it('shows spinner while loading', async () => {
    mockGetShifts.mockReturnValue(new Promise(() => {}));
    render(<ShiftsTab />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('fetches shifts on mount', async () => {
    render(<ShiftsTab />);
    await waitFor(() => expect(mockGetShifts).toHaveBeenCalledOnce());
  });

  it('renders shifts after loading', async () => {
    render(<ShiftsTab />);
    await waitFor(() => expect(screen.getByDisplayValue('Diurno')).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Table rendering
// -----------------------------------------------------------------

describe('ShiftsTab table', () => {
  it('shows shift name in input', async () => {
    render(<ShiftsTab />);
    await waitFor(() => expect(screen.getByDisplayValue('Diurno')).toBeInTheDocument());
  });

  it('shows shift start time', async () => {
    render(<ShiftsTab />);
    await waitFor(() => expect(screen.getByDisplayValue('08:00')).toBeInTheDocument());
  });

  it('shows shift end time', async () => {
    render(<ShiftsTab />);
    await waitFor(() => expect(screen.getByDisplayValue('17:00')).toBeInTheDocument());
  });

  it('shows detection window inputs with shift values', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    expect(screen.getByLabelText('Detección antes (min)')).toHaveValue(60);
    expect(screen.getByLabelText('Detección después (min)')).toHaveValue(10);
  });
});

// -----------------------------------------------------------------
// Inline editing
// -----------------------------------------------------------------

describe('ShiftsTab inline editing', () => {
  it('marks tab as dirty when shift name is edited', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Nombre del turno'), { target: { value: 'Diurno Modificado' } });
    expect(useConfigStore.getState().shifts.dirty).toBe(true);
  });

  it('editing end time to before start marks tab as dirty', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('17:00'));
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '06:00' } });
    expect(useConfigStore.getState().shifts.dirty).toBe(true);
  });

  it('marks tab as dirty when detection before minutes is edited', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Detección antes (min)'), { target: { value: '45' } });
    expect(useConfigStore.getState().shifts.dirty).toBe(true);
    expect(screen.getByLabelText('Detección antes (min)')).toHaveValue(45);
  });

  it('marks tab as dirty when detection after minutes is edited', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Detección después (min)'), { target: { value: '15' } });
    expect(useConfigStore.getState().shifts.dirty).toBe(true);
    expect(screen.getByLabelText('Detección después (min)')).toHaveValue(15);
  });

  it('clearing detection before minutes stores 0, not NaN', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Detección antes (min)'), { target: { value: '' } });
    expect(screen.getByLabelText('Detección antes (min)')).toHaveValue(0);
  });

  it('clearing detection after minutes stores 0, not NaN', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Detección después (min)'), { target: { value: '' } });
    expect(screen.getByLabelText('Detección después (min)')).toHaveValue(0);
  });
});

// -----------------------------------------------------------------
// Save
// -----------------------------------------------------------------

describe('ShiftsTab save', () => {
  it('Guardar cambios button is disabled when not dirty', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeDisabled();
  });

  it('Guardar cambios button is enabled when dirty', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Nombre del turno'), { target: { value: 'Nuevo' } });
    expect(screen.getByRole('button', { name: /guardar cambios/i })).not.toBeDisabled();
  });

  it('calls updateShift for each shift on save', async () => {
    mockUpdateShift.mockResolvedValue(shift1);
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Nombre del turno'), { target: { value: 'Nuevo Nombre' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(mockUpdateShift).toHaveBeenCalledOnce());
  });

  it('includes detection window values in updateShift body on save', async () => {
    mockUpdateShift.mockResolvedValue(shift1);
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Detección antes (min)'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Detección después (min)'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(mockUpdateShift).toHaveBeenCalledWith('manana', expect.objectContaining({
      detectionBeforeMinutes: 45, detectionAfterMinutes: 15,
    })));
  });

  it('shows toast after successful save', async () => {
    mockUpdateShift.mockResolvedValue(shift1);
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Nombre del turno'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(useConfigStore.getState().toastVisible).toBe(true));
    expect(useConfigStore.getState().toastMessage).toBe('Cambios guardados');
  });

  it('shows error message when save fails', async () => {
    mockUpdateShift.mockRejectedValue(new Error('server error'));
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Nombre del turno'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(screen.getByText(/no se pudieron guardar/i)).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Discard
// -----------------------------------------------------------------

describe('ShiftsTab discard', () => {
  it('clicking Descartar reverts changes and clears dirty', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.change(screen.getByLabelText('Nombre del turno'), { target: { value: 'Modificado' } });
    expect(useConfigStore.getState().shifts.dirty).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /descartar/i }));
    await waitFor(() => expect(screen.getByDisplayValue('Diurno')).toBeInTheDocument());
    expect(useConfigStore.getState().shifts.dirty).toBe(false);
  });
});

// -----------------------------------------------------------------
// Delete
// -----------------------------------------------------------------

describe('ShiftsTab delete', () => {
  it('calls deleteShift when delete button is clicked', async () => {
    mockDeleteShift.mockResolvedValue(undefined);
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.click(screen.getByRole('button', { name: /eliminar turno/i }));
    await waitFor(() => expect(mockDeleteShift).toHaveBeenCalledWith('manana'));
  });

  it('removes shift from table after successful delete', async () => {
    mockDeleteShift.mockResolvedValue(undefined);
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.click(screen.getByRole('button', { name: /eliminar turno/i }));
    await waitFor(() => expect(screen.queryByDisplayValue('Diurno')).not.toBeInTheDocument());
  });

  it('shows error when delete is blocked due to active employees', async () => {
    mockDeleteShift.mockRejectedValue({
      response: { data: { error: 'SHIFT_HAS_ACTIVE_EMPLOYEES', activeEmployeeCount: 3 } },
    });
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.click(screen.getByRole('button', { name: /eliminar turno/i }));
    await waitFor(() => expect(screen.getByText(/3 empleado\(s\) activo\(s\)/i)).toBeInTheDocument());
  });

  it('shows generic error when delete fails for other reason', async () => {
    mockDeleteShift.mockRejectedValue(new Error('server error'));
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    fireEvent.click(screen.getByRole('button', { name: /eliminar turno/i }));
    await waitFor(() => expect(screen.getByText(/no se pudo eliminar/i)).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Add new shift
// -----------------------------------------------------------------

describe('ShiftsTab add shift', () => {
  it('add button is disabled when form is empty', async () => {
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));
    expect(screen.getByRole('button', { name: /\+ agregar turno/i })).toBeDisabled();
  });

  it('calls createShift when form is filled and add button clicked', async () => {
    mockCreateShift.mockResolvedValue({ id: 'tarde', name: 'Tarde', startTime: '14:00', endTime: '22:00', crossMidnight: false, detectionBeforeMinutes: 60, detectionAfterMinutes: 10 });
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));

    fireEvent.change(screen.getByLabelText(/nombre del nuevo turno/i), { target: { value: 'Tarde' } });
    fireEvent.change(screen.getByLabelText(/hora de inicio del nuevo turno/i), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText(/hora de fin del nuevo turno/i), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ agregar turno/i }));

    await waitFor(() => expect(mockCreateShift).toHaveBeenCalledWith({
      name: 'Tarde', startTime: '14:00', endTime: '22:00', crossMidnight: false,
      detectionBeforeMinutes: 60, detectionAfterMinutes: 10,
    }));
  });

  it('uses default detection window values (60/10) when adding a shift without changing them', async () => {
    mockCreateShift.mockResolvedValue({ id: 'tarde', name: 'Tarde', startTime: '14:00', endTime: '22:00', crossMidnight: false, detectionBeforeMinutes: 60, detectionAfterMinutes: 10 });
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));

    fireEvent.change(screen.getByLabelText(/nombre del nuevo turno/i), { target: { value: 'Tarde' } });
    fireEvent.change(screen.getByLabelText(/hora de inicio del nuevo turno/i), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText(/hora de fin del nuevo turno/i), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ agregar turno/i }));

    await waitFor(() => expect(mockCreateShift).toHaveBeenCalledWith(
      expect.objectContaining({ detectionBeforeMinutes: 60, detectionAfterMinutes: 10 })
    ));
  });

  it('allows editing detection window values for a new shift before adding', async () => {
    mockCreateShift.mockResolvedValue({ id: 'tarde', name: 'Tarde', startTime: '14:00', endTime: '22:00', crossMidnight: false, detectionBeforeMinutes: 90, detectionAfterMinutes: 30 });
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));

    fireEvent.change(screen.getByLabelText(/nombre del nuevo turno/i), { target: { value: 'Tarde' } });
    fireEvent.change(screen.getByLabelText(/hora de inicio del nuevo turno/i), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText(/hora de fin del nuevo turno/i), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText(/detección antes \(min\) del nuevo turno/i), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText(/detección después \(min\) del nuevo turno/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ agregar turno/i }));

    await waitFor(() => expect(mockCreateShift).toHaveBeenCalledWith(
      expect.objectContaining({ detectionBeforeMinutes: 90, detectionAfterMinutes: 30 })
    ));
  });

  it('clearing detection window fields for a new shift sends 0, not NaN', async () => {
    mockCreateShift.mockResolvedValue({ id: 'tarde', name: 'Tarde', startTime: '14:00', endTime: '22:00', crossMidnight: false, detectionBeforeMinutes: 0, detectionAfterMinutes: 0 });
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));

    fireEvent.change(screen.getByLabelText(/nombre del nuevo turno/i), { target: { value: 'Tarde' } });
    fireEvent.change(screen.getByLabelText(/hora de inicio del nuevo turno/i), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText(/hora de fin del nuevo turno/i), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText(/detección antes \(min\) del nuevo turno/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/detección después \(min\) del nuevo turno/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ agregar turno/i }));

    await waitFor(() => expect(mockCreateShift).toHaveBeenCalledWith(
      expect.objectContaining({ detectionBeforeMinutes: 0, detectionAfterMinutes: 0 })
    ));
  });

  it('shows new shift in table after successful add', async () => {
    mockCreateShift.mockResolvedValue({ id: 'tarde', name: 'Tarde', startTime: '14:00', endTime: '22:00', crossMidnight: false, detectionBeforeMinutes: 60, detectionAfterMinutes: 10 });
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));

    fireEvent.change(screen.getByLabelText(/nombre del nuevo turno/i), { target: { value: 'Tarde' } });
    fireEvent.change(screen.getByLabelText(/hora de inicio del nuevo turno/i), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText(/hora de fin del nuevo turno/i), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ agregar turno/i }));

    await waitFor(() => expect(screen.getByDisplayValue('Tarde')).toBeInTheDocument());
  });

  it('shows error when createShift fails', async () => {
    mockCreateShift.mockRejectedValue(new Error('fail'));
    render(<ShiftsTab />);
    await waitFor(() => screen.getByDisplayValue('Diurno'));

    fireEvent.change(screen.getByLabelText(/nombre del nuevo turno/i), { target: { value: 'Tarde' } });
    fireEvent.change(screen.getByLabelText(/hora de inicio del nuevo turno/i), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText(/hora de fin del nuevo turno/i), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ agregar turno/i }));

    await waitFor(() => expect(screen.getByText(/no se pudo agregar/i)).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Error handling on initial load
// -----------------------------------------------------------------

describe('ShiftsTab error on load', () => {
  it('shows error message when getShifts fails', async () => {
    mockGetShifts.mockRejectedValue(new Error('network'));
    render(<ShiftsTab />);
    await waitFor(() => expect(screen.getByText(/no se pudo cargar/i)).toBeInTheDocument());
  });
});
