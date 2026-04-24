import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResultScreen from './ResultScreen';
import { useStore } from '../store';
import type { SubmitResponse } from '../types';

beforeEach(() => {
  useStore.getState().reset();
});

function setResult(r: SubmitResponse) {
  useStore.getState().setResult(r);
}

// -----------------------------------------------------------------
// Null guard
// -----------------------------------------------------------------

describe('ResultScreen null guard', () => {
  it('renders nothing when submitResult is null', () => {
    const { container } = render(<ResultScreen />);
    expect(container.firstChild).toBeNull();
  });
});

// -----------------------------------------------------------------
// Success variant (all submitted, none failed)
// -----------------------------------------------------------------

describe('ResultScreen success variant', () => {
  beforeEach(() => setResult({ totalSubmitted: 3, totalSkippedDuplicates: 0, totalFailed: 0, rows: [] }));

  it('shows "Carga completada" title', () => {
    render(<ResultScreen />);
    expect(screen.getByText('Carga completada')).toBeInTheDocument();
  });

  it('shows submitted count', () => {
    render(<ResultScreen />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('enviados')).toBeInTheDocument();
  });

  it('shows "Nueva carga" button', () => {
    render(<ResultScreen />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
  });

  it('clicking Nueva carga resets to empty state', () => {
    render(<ResultScreen />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    expect(useStore.getState().appState).toBe('empty');
  });
});

// -----------------------------------------------------------------
// Partial variant (some submitted, some failed)
// -----------------------------------------------------------------

describe('ResultScreen partial variant', () => {
  beforeEach(() => setResult({
    totalSubmitted: 2,
    totalSkippedDuplicates: 0,
    totalFailed: 1,
    rows: [
      { codigoEmpleado: '99', submitted: false, skippedDuplicate: false, error: 'DB error' },
    ],
  }));

  it('shows "Carga completada con errores" title', () => {
    render(<ResultScreen />);
    expect(screen.getByText('Carga completada con errores')).toBeInTheDocument();
  });

  it('shows failed count', () => {
    render(<ResultScreen />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('fallido')).toBeInTheDocument();
  });

  it('shows submitted count', () => {
    render(<ResultScreen />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('enviados')).toBeInTheDocument();
  });

  it('shows failed row details', () => {
    render(<ResultScreen />);
    expect(screen.getByText('Empleado 99')).toBeInTheDocument();
    expect(screen.getByText('DB error')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Full failure variant (nothing submitted)
// -----------------------------------------------------------------

describe('ResultScreen full failure variant', () => {
  beforeEach(() => setResult({
    totalSubmitted: 0,
    totalSkippedDuplicates: 0,
    totalFailed: 2,
    rows: [
      { codigoEmpleado: '1', submitted: false, skippedDuplicate: false, error: 'no disponible' },
      { codigoEmpleado: '2', submitted: false, skippedDuplicate: false },
    ],
  }));

  it('shows "Error al enviar" title', () => {
    render(<ResultScreen />);
    expect(screen.getByText('Error al enviar')).toBeInTheDocument();
  });

  it('shows "Intentar de nuevo" button label', () => {
    render(<ResultScreen />);
    expect(screen.getByRole('button', { name: /intentar de nuevo/i })).toBeInTheDocument();
  });

  it('shows connection error message', () => {
    render(<ResultScreen />);
    expect(screen.getByText(/verifica la conexión/i)).toBeInTheDocument();
  });

  it('shows "Error desconocido" for rows without error message', () => {
    render(<ResultScreen />);
    expect(screen.getByText('Error desconocido')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Duplicates display
// -----------------------------------------------------------------

describe('ResultScreen with duplicates', () => {
  it('shows duplicates count', () => {
    setResult({ totalSubmitted: 1, totalSkippedDuplicates: 2, totalFailed: 0, rows: [] });
    render(<ResultScreen />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('duplicados')).toBeInTheDocument();
  });

  it('uses singular form for one duplicate', () => {
    setResult({ totalSubmitted: 1, totalSkippedDuplicates: 1, totalFailed: 0, rows: [] });
    render(<ResultScreen />);
    expect(screen.getByText('duplicado')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Singular/plural forms
// -----------------------------------------------------------------

describe('ResultScreen singular forms', () => {
  it('uses singular "enviado" for 1 submission', () => {
    setResult({ totalSubmitted: 1, totalSkippedDuplicates: 0, totalFailed: 0, rows: [] });
    render(<ResultScreen />);
    expect(screen.getByText('enviado')).toBeInTheDocument();
  });

  it('uses singular "fallido" for 1 failure', () => {
    setResult({ totalSubmitted: 1, totalSkippedDuplicates: 0, totalFailed: 1, rows: [] });
    render(<ResultScreen />);
    expect(screen.getByText('fallido')).toBeInTheDocument();
  });
});
