import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useConfigStore } from '../../configStore';
import * as configApi from '../../configApi';

vi.mock('../../configApi');

const mockGetHolidays    = vi.mocked(configApi.getHolidays);
const mockCreateHoliday  = vi.mocked(configApi.createHoliday);
const mockDeleteHoliday  = vi.mocked(configApi.deleteHoliday);
const mockRefreshHolidays = vi.mocked(configApi.refreshHolidays);

const holiday1 = { id: 1, date: '2026-01-01', name: 'Año Nuevo', source: 'API' as const };
const holiday2 = { id: 2, date: '2026-07-04', name: 'Feriado Manual', source: 'Manual' as const };

const { default: HolidaysTab } = await import('./HolidaysTab');

beforeEach(() => {
  useConfigStore.setState({
    activeTab: 'holidays',
    shifts: { loading: false, data: null, dirty: false, error: null },
    employees: { loading: false, data: null, dirty: false, error: null },
    holidays: { loading: false, data: null, dirty: false, error: null },
    general: { loading: false, data: null, dirty: false, error: null },
    toastVisible: false,
    toastMessage: '',
    holidayYear: 2026,
  });
  vi.clearAllMocks();
  mockGetHolidays.mockResolvedValue([holiday1, holiday2]);
});

// -----------------------------------------------------------------
// Loading & empty
// -----------------------------------------------------------------

describe('HolidaysTab loading', () => {
  it('fetches holidays for current year on mount', async () => {
    render(<HolidaysTab />);
    await waitFor(() => expect(mockGetHolidays).toHaveBeenCalledWith(2026));
  });

  it('shows spinner while loading', async () => {
    mockGetHolidays.mockReturnValue(new Promise(() => {}));
    render(<HolidaysTab />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('shows empty state message when no holidays for year', async () => {
    mockGetHolidays.mockResolvedValue([]);
    render(<HolidaysTab />);
    await waitFor(() => expect(screen.getByText(/no hay feriados registrados para este año/i)).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Table rendering
// -----------------------------------------------------------------

describe('HolidaysTab table', () => {
  it('shows formatted date', async () => {
    render(<HolidaysTab />);
    await waitFor(() => expect(screen.getByText('Jueves 1 de enero')).toBeInTheDocument());
  });

  it('shows holiday name', async () => {
    render(<HolidaysTab />);
    await waitFor(() => expect(screen.getByText('Año Nuevo')).toBeInTheDocument());
  });

  it('shows API badge for API source', async () => {
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    const badges = screen.getAllByText('API');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows Manual badge for Manual source', async () => {
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Feriado Manual'));
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Year navigation
// -----------------------------------------------------------------

describe('HolidaysTab year navigation', () => {
  it('shows current year', async () => {
    render(<HolidaysTab />);
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('clicking next year button increments year and reloads', async () => {
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    mockGetHolidays.mockResolvedValue([]);
    fireEvent.click(screen.getByLabelText('Año siguiente'));
    expect(useConfigStore.getState().holidayYear).toBe(2027);
    await waitFor(() => expect(mockGetHolidays).toHaveBeenCalledWith(2027));
  });

  it('clicking previous year button decrements year and reloads', async () => {
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    mockGetHolidays.mockResolvedValue([]);
    fireEvent.click(screen.getByLabelText('Año anterior'));
    expect(useConfigStore.getState().holidayYear).toBe(2025);
    await waitFor(() => expect(mockGetHolidays).toHaveBeenCalledWith(2025));
  });
});

// -----------------------------------------------------------------
// Refresh
// -----------------------------------------------------------------

describe('HolidaysTab refresh', () => {
  it('calls refreshHolidays on button click', async () => {
    mockRefreshHolidays.mockResolvedValue(undefined);
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    mockGetHolidays.mockResolvedValue([holiday1]);
    fireEvent.click(screen.getByRole('button', { name: /actualizar desde internet/i }));
    await waitFor(() => expect(mockRefreshHolidays).toHaveBeenCalledWith(2026));
  });

  it('shows Actualizado ✓ after successful refresh', async () => {
    mockRefreshHolidays.mockResolvedValue(undefined);
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    mockGetHolidays.mockResolvedValue([holiday1]);
    fireEvent.click(screen.getByRole('button', { name: /actualizar desde internet/i }));
    await waitFor(() => expect(screen.getByText(/actualizado ✓/i)).toBeInTheDocument());
  });

  it('shows inline error when refresh fails', async () => {
    mockRefreshHolidays.mockRejectedValue(new Error('network'));
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    fireEvent.click(screen.getByRole('button', { name: /actualizar desde internet/i }));
    await waitFor(() => expect(screen.getByText(/no se pudo actualizar/i)).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Delete
// -----------------------------------------------------------------

describe('HolidaysTab delete', () => {
  it('shows confirm modal when delete button is clicked', async () => {
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar feriado/i });
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByText(/estás seguro/i)).toBeInTheDocument();
  });

  it('modal shows holiday name in the confirmation text', async () => {
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar feriado/i });
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByText(/estás seguro/i).textContent).toContain('Año Nuevo');
  });

  it('clicking Cancelar closes modal without deleting', async () => {
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar feriado/i });
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByText(/estás seguro/i)).not.toBeInTheDocument();
    expect(mockDeleteHoliday).not.toHaveBeenCalled();
  });

  it('clicking Eliminar in modal calls deleteHoliday', async () => {
    mockDeleteHoliday.mockResolvedValue(undefined);
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar feriado/i });
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));
    await waitFor(() => expect(mockDeleteHoliday).toHaveBeenCalledWith(1));
  });

  it('removes holiday from table after successful delete', async () => {
    mockDeleteHoliday.mockResolvedValue(undefined);
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar feriado/i });
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));
    await waitFor(() => expect(screen.queryByText('Año Nuevo')).not.toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Add holiday
// -----------------------------------------------------------------

describe('HolidaysTab add holiday', () => {
  it('add button is disabled when form is empty', async () => {
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));
    expect(screen.getByRole('button', { name: /^agregar$/i })).toBeDisabled();
  });

  it('calls createHoliday when form is filled and add button clicked', async () => {
    const newHoliday = { id: 3, date: '2026-03-15', name: 'Día de la Patria', source: 'Manual' as const };
    mockCreateHoliday.mockResolvedValue(newHoliday);
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));

    fireEvent.change(screen.getByLabelText(/fecha del nuevo feriado/i), { target: { value: '2026-03-15' } });
    fireEvent.change(screen.getByLabelText(/nombre del nuevo feriado/i), { target: { value: 'Día de la Patria' } });
    fireEvent.click(screen.getByRole('button', { name: /^agregar$/i }));

    await waitFor(() => expect(mockCreateHoliday).toHaveBeenCalledWith({
      date: '2026-03-15', name: 'Día de la Patria',
    }));
  });

  it('shows new holiday in table after successful add', async () => {
    const newHoliday = { id: 3, date: '2026-03-15', name: 'Día de la Patria', source: 'Manual' as const };
    mockCreateHoliday.mockResolvedValue(newHoliday);
    render(<HolidaysTab />);
    await waitFor(() => screen.getByText('Año Nuevo'));

    fireEvent.change(screen.getByLabelText(/fecha del nuevo feriado/i), { target: { value: '2026-03-15' } });
    fireEvent.change(screen.getByLabelText(/nombre del nuevo feriado/i), { target: { value: 'Día de la Patria' } });
    fireEvent.click(screen.getByRole('button', { name: /^agregar$/i }));

    await waitFor(() => expect(screen.getByText('Día de la Patria')).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Error handling
// -----------------------------------------------------------------

describe('HolidaysTab errors', () => {
  it('shows error when initial load fails', async () => {
    mockGetHolidays.mockRejectedValue(new Error('network'));
    render(<HolidaysTab />);
    await waitFor(() => expect(screen.getByText(/no se pudo cargar/i)).toBeInTheDocument());
  });
});
