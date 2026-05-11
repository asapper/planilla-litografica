import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ActionBar from './ActionBar';
import { useStore } from '../store';
import * as api from '../api';
import type { ValidateResponse } from '../types';

// Mock the API module so no HTTP calls are made
vi.mock('../api');

const mockValidateRows  = vi.mocked(api.validateRows);
const mockStartJob      = vi.mocked(api.startJob);
const mockCheckDbHealth = vi.mocked(api.checkDbHealth);

function makeValidateResponse(allValid: boolean, hasDuplicates = false): ValidateResponse {
  return { allValid, hasDuplicates, rows: [] };
}

function setupLoadedStore(quincena: number | null = null) {
  const state = useStore.getState();
  state.setLoaded(
    [{ codigoEmpleado: '1', nombreEmpleado: 'Ana', diasNoLaborados: 0,
       horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 12, anio: 2024 }],
    [{ mes: 12, anio: 2024 }],
    false,
    []
  );
  if (quincena !== null) state.setQuincena(quincena);
}

beforeEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
  // Never resolves by default — prevents async effects from affecting sync assertions
  mockCheckDbHealth.mockReturnValue(new Promise(() => {}));
});

// -----------------------------------------------------------------
// Button state
// -----------------------------------------------------------------

describe('ActionBar button state', () => {
  it('is disabled when no quincena is selected', () => {
    setupLoadedStore(null);
    render(<ActionBar />);
    const btn = screen.getByRole('button', { name: /validar/i });
    expect(btn).toBeDisabled();
  });

  it('is enabled when quincena is selected', () => {
    setupLoadedStore(1);
    render(<ActionBar />);
    const btn = screen.getByRole('button', { name: /validar/i });
    expect(btn).not.toBeDisabled();
  });

  it('shows "Corrige los errores" and is disabled when validation has errors', () => {
    setupLoadedStore(1);
    const errResult: ValidateResponse = {
      allValid: false,
      hasDuplicates: false,
      rows: [{ codigoEmpleado: '1', valid: false, duplicate: false,
               errors: [{ field: 'mes', message: 'bad' }] }],
    };
    useStore.getState().setValidation(errResult);
    render(<ActionBar />);
    expect(screen.getByRole('button', { name: /corrige los errores/i })).toBeDisabled();
  });

  it('shows "Enviar" and is disabled when validation passed but DB not yet confirmed', () => {
    setupLoadedStore(1);
    useStore.getState().setValidation({ allValid: true, hasDuplicates: false, rows: [] });
    render(<ActionBar />);
    const btn = screen.getByRole('button', { name: /^enviar$/i });
    expect(btn).toBeDisabled();
  });

  it('shows "Enviar" and is enabled when validation passed and DB reachable', () => {
    setupLoadedStore(1);
    useStore.getState().setValidation({ allValid: true, hasDuplicates: false, rows: [] });
    useStore.getState().setDbReachable(true);
    render(<ActionBar />);
    const btn = screen.getByRole('button', { name: /^enviar$/i });
    expect(btn).not.toBeDisabled();
  });
});

// -----------------------------------------------------------------
// Validate → Submit flow
// -----------------------------------------------------------------

describe('ActionBar validate and submit flow', () => {
  it('calls validateRows on click', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockResolvedValue(makeValidateResponse(false));
    render(<ActionBar />);
    fireEvent.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() => expect(mockValidateRows).toHaveBeenCalledOnce());
  });

  it('does not call startJob when validation fails', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockResolvedValue(makeValidateResponse(false));
    render(<ActionBar />);
    fireEvent.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() => expect(mockValidateRows).toHaveBeenCalledOnce());
    expect(mockStartJob).not.toHaveBeenCalled();
  });

  it('starts DB health polling after validation passes', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockResolvedValue(makeValidateResponse(true));
    mockCheckDbHealth.mockResolvedValue(undefined);
    render(<ActionBar />);
    fireEvent.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() => expect(mockCheckDbHealth).toHaveBeenCalled());
  });

  it('enables "Enviar" button after validation passes and DB is reachable', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockResolvedValue(makeValidateResponse(true));
    mockCheckDbHealth.mockResolvedValue(undefined);
    render(<ActionBar />);
    fireEvent.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled()
    );
  });

  it('calls startJob when "Enviar" is clicked after DB is confirmed', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockResolvedValue(makeValidateResponse(true));
    mockCheckDbHealth.mockResolvedValue(undefined);
    mockStartJob.mockResolvedValue({ jobId: 'job-1', status: 'PENDING' });
    render(<ActionBar />);

    fireEvent.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    await waitFor(() => expect(mockStartJob).toHaveBeenCalledOnce());
  });

  it('transitions to polling state after startJob succeeds', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockResolvedValue(makeValidateResponse(true));
    mockCheckDbHealth.mockResolvedValue(undefined);
    mockStartJob.mockResolvedValue({ jobId: 'job-1', status: 'PENDING' });
    render(<ActionBar />);

    fireEvent.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    await waitFor(() => expect(useStore.getState().appState).toBe('polling'));
    expect(useStore.getState().jobId).toBe('job-1');
  });

  it('calls startJob directly (no re-validate) when already valid and DB reachable', async () => {
    setupLoadedStore(1);
    useStore.getState().setValidation({ allValid: true, hasDuplicates: false, rows: [] });
    useStore.getState().setDbReachable(true);
    mockStartJob.mockResolvedValue({ jobId: 'job-1', status: 'PENDING' });
    render(<ActionBar />);

    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    await waitFor(() => expect(mockStartJob).toHaveBeenCalledOnce());
    expect(mockValidateRows).not.toHaveBeenCalled();
  });

  it('reverts to loaded state and shows inline error when startJob throws', async () => {
    setupLoadedStore(1);
    useStore.getState().setValidation({ allValid: true, hasDuplicates: false, rows: [] });
    useStore.getState().setDbReachable(true);
    mockStartJob.mockRejectedValue(new Error('network error'));
    render(<ActionBar />);

    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    await waitFor(() => expect(screen.getByText(/error al conectar/i)).toBeInTheDocument());
    expect(useStore.getState().appState).toBe('loaded');
  });

  it('shows inline error and does not crash when API call throws', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockRejectedValue(new Error('network error'));
    render(<ActionBar />);
    fireEvent.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() => expect(screen.getByText(/error al conectar/i)).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------
// Temporary success message
// -----------------------------------------------------------------

describe('ActionBar success message', () => {
  it('shows success badge immediately after validation passes', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockResolvedValue(makeValidateResponse(true));
    render(<ActionBar />);

    fireEvent.click(screen.getByRole('button', { name: /^validar$/i }));
    await waitFor(() => expect(screen.getByText(/validación exitosa/i)).toBeInTheDocument());
  });

  it('hides success badge after 3 seconds', async () => {
    vi.useFakeTimers();
    try {
      setupLoadedStore(1);
      mockValidateRows.mockResolvedValue(makeValidateResponse(true));
      render(<ActionBar />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^validar$/i }));
      });
      expect(screen.getByText(/validación exitosa/i)).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(screen.queryByText(/validación exitosa/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show success badge when validation has errors', () => {
    setupLoadedStore(1);
    useStore.getState().setValidation({
      allValid: false, hasDuplicates: false,
      rows: [{ codigoEmpleado: '1', valid: false, duplicate: false,
               errors: [{ field: 'mes', message: 'bad' }] }],
    });
    render(<ActionBar />);
    expect(screen.queryByText(/validación exitosa/i)).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// DB connectivity state
// -----------------------------------------------------------------

describe('ActionBar DB connectivity', () => {
  it('shows DB error badge when validation passed but DB unreachable', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockResolvedValue(makeValidateResponse(true));
    mockCheckDbHealth.mockRejectedValue(new Error('timeout'));
    render(<ActionBar />);

    fireEvent.click(screen.getByRole('button', { name: /validar/i }));
    await waitFor(() => expect(useStore.getState().dbReachable).toBe(false));
    expect(screen.getByText(/base de datos no disponible/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^enviar$/i })).toBeDisabled();
  });

  it('hides DB error badge when validation is cleared by edit', async () => {
    setupLoadedStore(1);
    useStore.getState().setValidation({ allValid: true, hasDuplicates: false, rows: [] });
    useStore.getState().setDbReachable(false);
    render(<ActionBar />);
    expect(screen.getByText(/base de datos no disponible/i)).toBeInTheDocument();

    useStore.getState().updateRow(0, { diasNoLaborados: 1 });
    await waitFor(() =>
      expect(screen.queryByText(/base de datos no disponible/i)).not.toBeInTheDocument()
    );
  });
});

// -----------------------------------------------------------------
// Error badge rendering
// -----------------------------------------------------------------

describe('ActionBar badges', () => {
  it('shows error count badge when validation has errors', () => {
    setupLoadedStore(1);
    const errResult: ValidateResponse = {
      allValid: false,
      hasDuplicates: false,
      rows: [
        { codigoEmpleado: '1', valid: false, duplicate: false,
          errors: [{ field: 'mes', message: 'bad' }] },
        { codigoEmpleado: '2', valid: false, duplicate: false,
          errors: [{ field: 'anio', message: 'bad' }] },
      ],
    };
    useStore.getState().setValidation(errResult);
    render(<ActionBar />);
    expect(screen.getByText(/2 errores/i)).toBeInTheDocument();
  });

  it('shows duplicate badge when duplicates are flagged', () => {
    setupLoadedStore(1);
    const dupResult: ValidateResponse = {
      allValid: false,
      hasDuplicates: true,
      rows: [{ codigoEmpleado: '1', valid: true, duplicate: true, errors: [] }],
    };
    useStore.getState().setValidation(dupResult);
    render(<ActionBar />);
    expect(screen.getByText(/1 duplicado/i)).toBeInTheDocument();
  });

  it('shows "Selecciona la quincena" hint when selection is incomplete', () => {
    setupLoadedStore(null); // no quincena
    render(<ActionBar />);
    expect(screen.getByText(/selecciona la quincena/i)).toBeInTheDocument();
  });

  it('shows singular "error" for exactly 1 invalid row', () => {
    setupLoadedStore(1);
    useStore.getState().setValidation({
      allValid: false, hasDuplicates: false,
      rows: [{ codigoEmpleado: '1', valid: false, duplicate: false,
               errors: [{ field: 'mes', message: 'bad' }] }],
    });
    render(<ActionBar />);
    expect(screen.getByText(/1 error$/i)).toBeInTheDocument();
  });

  it('shows plural "duplicados" for 2 duplicate rows', () => {
    setupLoadedStore(1);
    useStore.getState().setValidation({
      allValid: false, hasDuplicates: true,
      rows: [
        { codigoEmpleado: '1', valid: true, duplicate: true, errors: [] },
        { codigoEmpleado: '2', valid: true, duplicate: true, errors: [] },
      ],
    });
    render(<ActionBar />);
    expect(screen.getByText(/2 duplicados/i)).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Multi-month mode
// -----------------------------------------------------------------

describe('ActionBar multi-month mode', () => {
  function setupMultiMonth(quincena: number | null = null) {
    const state = useStore.getState();
    state.setLoaded(
      [{ codigoEmpleado: '1', nombreEmpleado: 'A', diasNoLaborados: 0,
         horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 12, anio: 2024 }],
      [{ mes: 11, anio: 2024 }, { mes: 12, anio: 2024 }],
      true,
      []
    );
    state.setMonth({ mes: 12, anio: 2024 });
    if (quincena !== null) state.setQuincena(quincena);
  }

  it('is enabled when quincena AND month are both selected in multi-month mode', () => {
    setupMultiMonth(1);
    render(<ActionBar />);
    expect(screen.getByRole('button', { name: /validar/i })).not.toBeDisabled();
  });

  it('is disabled when only month is selected but quincena is missing', () => {
    setupMultiMonth(null); // month selected, no quincena
    render(<ActionBar />);
    expect(screen.getByRole('button', { name: /validar/i })).toBeDisabled();
  });

  it('shows hint when month is selected but quincena is missing', () => {
    setupMultiMonth(null);
    render(<ActionBar />);
    expect(screen.getByText(/selecciona la quincena/i)).toBeInTheDocument();
  });

  it('is disabled when quincena is set but no month is selected yet in multi-month mode', () => {
    const state = useStore.getState();
    state.setLoaded(
      [{ codigoEmpleado: '1', nombreEmpleado: 'A', diasNoLaborados: 0,
         horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 12, anio: 2024 }],
      [{ mes: 11, anio: 2024 }, { mes: 12, anio: 2024 }],
      true,
      []
    );
    state.setQuincena(1);
    render(<ActionBar />);
    expect(screen.getByRole('button', { name: /validar/i })).toBeDisabled();
  });
});

// -----------------------------------------------------------------
// In-flight validation state
// -----------------------------------------------------------------

describe('ActionBar in-flight validation', () => {
  it('shows "Validando..." and disables button while validation is in-flight', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ActionBar />);

    fireEvent.click(screen.getByRole('button', { name: /^validar$/i }));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /validando/i });
      expect(btn).toBeDisabled();
    });
  });

  it('re-enables button and clears "Validando..." after validation resolves', async () => {
    setupLoadedStore(1);
    mockValidateRows.mockResolvedValue(makeValidateResponse(false));
    render(<ActionBar />);

    fireEvent.click(screen.getByRole('button', { name: /^validar$/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /validando/i })).not.toBeInTheDocument()
    );
  });

  it('discards stale validation result when quincena changes during in-flight call', async () => {
    setupLoadedStore(1);

    let resolveValidation!: (v: ValidateResponse) => void;
    mockValidateRows.mockReturnValue(
      new Promise<ValidateResponse>(resolve => { resolveValidation = resolve; })
    );

    render(<ActionBar />);
    fireEvent.click(screen.getByRole('button', { name: /^validar$/i }));

    // While validation is in-flight, switch to quincena 2
    act(() => { useStore.getState().setQuincena(2); });

    // Resolve the stale call (was for quincena 1)
    await act(async () => { resolveValidation(makeValidateResponse(true)); });

    // Stale result must be discarded — validation stays null
    expect(useStore.getState().validation).toBeNull();
    // Button shows "Validar" (not "Enviar") — new chip selection needs fresh validation
    expect(screen.getByRole('button', { name: /^validar$/i })).toBeInTheDocument();
  });

  it('shows inline error and re-enables button after 15s timeout', async () => {
    vi.useFakeTimers();
    setupLoadedStore(1);
    mockValidateRows.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ActionBar />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^validar$/i }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(screen.getByText(/error al conectar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^validar$/i })).not.toBeDisabled();

    vi.useRealTimers();
  });

  it('keeps validation result when quincena does not change during call', async () => {
    setupLoadedStore(1);

    let resolveValidation!: (v: ValidateResponse) => void;
    mockValidateRows.mockReturnValue(
      new Promise<ValidateResponse>(resolve => { resolveValidation = resolve; })
    );

    render(<ActionBar />);
    fireEvent.click(screen.getByRole('button', { name: /^validar$/i }));

    // Resolve without changing quincena
    await act(async () => { resolveValidation(makeValidateResponse(false)); });

    // Result should be applied
    expect(useStore.getState().validation).not.toBeNull();
  });
});
