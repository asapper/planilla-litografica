import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewScreen from './ReviewScreen';
import { useTasStore } from '../../tasStore';
import * as tasApi from '../../tasApi';
import * as configApi from '../../configApi';
import type { ResolvedRow } from '../../tasTypes';

vi.mock('../../tasApi');
vi.mock('../../configApi');

const mockSubmitTas = vi.mocked(tasApi.submitTas);
const mockRecomputeTas = vi.mocked(tasApi.recomputeTas);
const mockUpdateAccruesOvertime = vi.mocked(configApi.updateAccruesOvertime);

const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
];

beforeEach(() => {
  useTasStore.getState().resetTas();
  vi.clearAllMocks();
});

describe('ReviewScreen rendering', () => {
  it('renders a heading', () => {
    render(<ReviewScreen />);
    expect(screen.getByText(/revisión de registros/i)).toBeInTheDocument();
  });

  it('renders a row per resolved employee', () => {
    useTasStore.getState().setResolvedRows(rows);
    render(<ReviewScreen />);
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('Luis García')).toBeInTheDocument();
  });

  it('shows the resolved row count, plural', () => {
    useTasStore.getState().setResolvedRows(rows);
    render(<ReviewScreen />);
    expect(screen.getByText(/se procesaron 2 registros/i)).toBeInTheDocument();
  });

  it('shows the ambiguous-shift badge when diasTurnoAmbiguo > 0', () => {
    useTasStore.getState().setResolvedRows([
      { ...rows[0], diasTurnoAmbiguo: 2, accruesOvertime: true },
      rows[1],
    ]);
    render(<ReviewScreen />);
    expect(screen.getByText('2 sin turno')).toBeInTheDocument();
  });

  it('does not show the ambiguous-shift badge when diasTurnoAmbiguo is 0', () => {
    useTasStore.getState().setResolvedRows(rows);
    render(<ReviewScreen />);
    expect(screen.queryByText(/sin turno/)).not.toBeInTheDocument();
  });

  it('shows the resolved row count, singular', () => {
    useTasStore.getState().setResolvedRows([rows[0]]);
    render(<ReviewScreen />);
    expect(screen.getByText(/se procesó 1 registro\b/i)).toBeInTheDocument();
  });

  it('renders an Enviar button', () => {
    render(<ReviewScreen />);
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });
});

describe('ReviewScreen submit', () => {
  it('calls submitTas and advances to result', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    mockSubmitTas.mockResolvedValue({ jobId: 'job-final' });

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().tasView).toBe('result'));
    expect(mockSubmitTas).toHaveBeenCalledWith('tok-1');
    expect(useTasStore.getState().jobId).toBe('job-final');
  });

  it('reverts to review and sets error when submitTas throws', async () => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
    mockSubmitTas.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(useTasStore.getState().error).not.toBeNull());
    expect(useTasStore.getState().tasView).toBe('review');
  });

  it('does nothing when uploadToken is null', () => {
    useTasStore.getState().setResolvedRows(rows);

    render(<ReviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

    expect(mockSubmitTas).not.toHaveBeenCalled();
    expect(useTasStore.getState().tasView).toBe('idle');
  });
});

describe('ReviewScreen accruesOvertime toggle', () => {
  beforeEach(() => {
    useTasStore.getState().setUploadToken('tok-1');
    useTasStore.getState().setResolvedRows(rows);
  });

  it('renders the Acumula horas extra column with a switch per row', () => {
    render(<ReviewScreen />);
    expect(screen.getByText('Acumula horas extra')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('toggles off: calls updateAccruesOvertime then recomputeTas, and replaces resolvedRows', async () => {
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    const newRows: ResolvedRow[] = [
      { ...rows[0], accruesOvertime: false, horasExtrasSimples: 0, horasExtrasDobles: 0 },
      rows[1],
    ];
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: newRows });

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().resolvedRows).toEqual(newRows));
    expect(mockUpdateAccruesOvertime).toHaveBeenCalledWith('E1', false);
    expect(mockRecomputeTas).toHaveBeenCalledWith('tok-1');
  });

  it('toggles on: calls updateAccruesOvertime with true', async () => {
    const offRows: ResolvedRow[] = [
      { ...rows[0], accruesOvertime: false },
      rows[1],
    ];
    useTasStore.getState().setResolvedRows(offRows);
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: true,
    });
    mockRecomputeTas.mockResolvedValue({ uploadToken: 'tok-1', resolvedRows: rows });

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(mockUpdateAccruesOvertime).toHaveBeenCalledWith('E1', true));
    expect(mockRecomputeTas).toHaveBeenCalledWith('tok-1');
  });

  it('reverts and shows error when updateAccruesOvertime fails', async () => {
    mockUpdateAccruesOvertime.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().error).not.toBeNull());
    expect(useTasStore.getState().resolvedRows).toEqual(rows);
    expect(mockRecomputeTas).not.toHaveBeenCalled();
  });

  it('reverts and shows error when recomputeTas fails', async () => {
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    mockRecomputeTas.mockRejectedValue(new Error('network error'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().error).not.toBeNull());
    expect(useTasStore.getState().resolvedRows).toEqual(rows);
  });

  it('disables switches while a toggle request is in flight, then re-enables', async () => {
    let resolveRecompute: (value: { uploadToken: string; resolvedRows: ResolvedRow[] }) => void;
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    mockRecomputeTas.mockImplementation(() => new Promise(resolve => {
      resolveRecompute = resolve;
    }));

    render(<ReviewScreen />);
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);

    await waitFor(() => expect(switches[0]).toBeDisabled());
    expect(switches[1]).toBeDisabled();

    resolveRecompute!({ uploadToken: 'tok-1', resolvedRows: rows });

    await waitFor(() => expect(switches[0]).not.toBeDisabled());
    expect(switches[1]).not.toBeDisabled();
  });

  it('shows session-expired messaging when recompute fails due to expired uploadToken', async () => {
    mockUpdateAccruesOvertime.mockResolvedValue({
      id: 'E1', code: 'E1', name: 'Ana López', shiftId: null, shiftName: null, active: true, accruesOvertime: false,
    });
    mockRecomputeTas.mockRejectedValue(new Error('Upload token not found'));

    render(<ReviewScreen />);
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(useTasStore.getState().error).toMatch(/sesión.*expir|vuelve a subir/i));
  });
});
