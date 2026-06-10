import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewScreen from './ReviewScreen';
import { useTasStore } from '../../tasStore';
import * as tasApi from '../../tasApi';
import type { ResolvedRow } from '../../tasTypes';

vi.mock('../../tasApi');

const mockSubmitTas = vi.mocked(tasApi.submitTas);

const rows: ResolvedRow[] = [
  { codigoEmpleado: 'E1', nombreEmpleado: 'Ana López', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1 },
  { codigoEmpleado: 'E2', nombreEmpleado: 'Luis García', diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 1, mes: 3, anio: 2026, numeroDequincena: 1 },
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
});
