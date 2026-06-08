import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useConfigStore } from '../../configStore';
import * as configApi from '../../configApi';

vi.mock('../../configApi');

const mockGetGeneralConfig    = vi.mocked(configApi.getGeneralConfig);
const mockUpdateGeneralConfig = vi.mocked(configApi.updateGeneralConfig);

const generalConfig = { legalBreakAllowanceMinutes: 45 };

const { default: GeneralTab } = await import('./GeneralTab');

beforeEach(() => {
  useConfigStore.setState({
    activeTab: 'general',
    shifts: { loading: false, data: null, dirty: false, error: null },
    employees: { loading: false, data: null, dirty: false, error: null },
    holidays: { loading: false, data: null, dirty: false, error: null },
    general: { loading: false, data: null, dirty: false, error: null },
    toastVisible: false,
    toastMessage: '',
    holidayYear: 2026,
  });
  vi.clearAllMocks();
  mockGetGeneralConfig.mockResolvedValue(generalConfig);
});

// -----------------------------------------------------------------
// Loading
// -----------------------------------------------------------------

describe('GeneralTab loading', () => {
  it('fetches general config on mount', async () => {
    render(<GeneralTab />);
    await waitFor(() => expect(mockGetGeneralConfig).toHaveBeenCalledOnce());
  });

  it('shows spinner while loading', async () => {
    mockGetGeneralConfig.mockReturnValue(new Promise(() => {}));
    render(<GeneralTab />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------

describe('GeneralTab rendering', () => {
  it('shows the break allowance label', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));
    expect(screen.getByText(/tiempo de descanso no deducible/i)).toBeInTheDocument();
  });

  it('shows the minutes label', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));
    expect(screen.getByText('minutos')).toBeInTheDocument();
  });

  it('shows the help text about legal mandate', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));
    expect(screen.getByText(/mandato legal/i)).toBeInTheDocument();
  });

  it('shows the note about next upload', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));
    expect(screen.getByText(/próximo archivo subido/i)).toBeInTheDocument();
  });

  it('shows the loaded value in the input', async () => {
    render(<GeneralTab />);
    await waitFor(() => {
      const input = screen.getByLabelText(/tiempo de descanso/i) as HTMLInputElement;
      expect(input.value).toBe('45');
    });
  });
});

// -----------------------------------------------------------------
// Editing
// -----------------------------------------------------------------

describe('GeneralTab editing', () => {
  it('Guardar cambios is disabled when not dirty', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeDisabled();
  });

  it('changes mark tab as dirty', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));
    fireEvent.change(screen.getByLabelText(/tiempo de descanso/i), { target: { value: '60' } });
    expect(useConfigStore.getState().general.dirty).toBe(true);
  });

  it('Guardar cambios is enabled when dirty', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));
    fireEvent.change(screen.getByLabelText(/tiempo de descanso/i), { target: { value: '60' } });
    expect(screen.getByRole('button', { name: /guardar cambios/i })).not.toBeDisabled();
  });
});

// -----------------------------------------------------------------
// Save
// -----------------------------------------------------------------

describe('GeneralTab save', () => {
  it('calls updateGeneralConfig with new value on save', async () => {
    mockUpdateGeneralConfig.mockResolvedValue({ legalBreakAllowanceMinutes: 60 });
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));

    fireEvent.change(screen.getByLabelText(/tiempo de descanso/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(mockUpdateGeneralConfig).toHaveBeenCalledWith({
      legalBreakAllowanceMinutes: 60,
    }));
  });

  it('shows toast after successful save', async () => {
    mockUpdateGeneralConfig.mockResolvedValue({ legalBreakAllowanceMinutes: 60 });
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));

    fireEvent.change(screen.getByLabelText(/tiempo de descanso/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(useConfigStore.getState().toastVisible).toBe(true));
    expect(useConfigStore.getState().toastMessage).toBe('Cambios guardados');
  });

  it('clears dirty flag after successful save', async () => {
    mockUpdateGeneralConfig.mockResolvedValue({ legalBreakAllowanceMinutes: 60 });
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));

    fireEvent.change(screen.getByLabelText(/tiempo de descanso/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(useConfigStore.getState().general.dirty).toBe(false));
  });

  it('shows error when save fails', async () => {
    mockUpdateGeneralConfig.mockRejectedValue(new Error('server error'));
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));

    fireEvent.change(screen.getByLabelText(/tiempo de descanso/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(screen.getByText(/no se pudieron guardar/i)).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Discard
// -----------------------------------------------------------------

describe('GeneralTab discard', () => {
  it('Descartar reverts input to original value', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));

    fireEvent.change(screen.getByLabelText(/tiempo de descanso/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /descartar/i }));

    expect((screen.getByLabelText(/tiempo de descanso/i) as HTMLInputElement).value).toBe('45');
  });

  it('Descartar clears dirty flag', async () => {
    render(<GeneralTab />);
    await waitFor(() => screen.getByDisplayValue('45'));

    fireEvent.change(screen.getByLabelText(/tiempo de descanso/i), { target: { value: '60' } });
    expect(useConfigStore.getState().general.dirty).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /descartar/i }));
    expect(useConfigStore.getState().general.dirty).toBe(false);
  });
});

// -----------------------------------------------------------------
// Error handling
// -----------------------------------------------------------------

describe('GeneralTab errors', () => {
  it('shows error when initial load fails', async () => {
    mockGetGeneralConfig.mockRejectedValue(new Error('network'));
    render(<GeneralTab />);
    await waitFor(() => expect(screen.getByText(/no se pudo cargar/i)).toBeInTheDocument());
  });
});
