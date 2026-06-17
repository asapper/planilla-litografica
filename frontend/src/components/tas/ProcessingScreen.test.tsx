import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProcessingScreen from './ProcessingScreen';
import { useTasStore } from '../../tasStore';

beforeEach(() => {
  useTasStore.getState().resetTas();
});

describe('ProcessingScreen', () => {
  it('renders the filename with processing indicator', () => {
    render(<ProcessingScreen fileName="reporte.csv" />);
    expect(screen.getByText(/reporte\.csv — procesando\.\.\./i)).toBeInTheDocument();
  });

  it('renders the processingMessage from store', () => {
    useTasStore.getState().setProcessingMessage('Analizando marcaciones...');
    render(<ProcessingScreen fileName="reporte.csv" />);
    expect(screen.getByText('Analizando marcaciones...')).toBeInTheDocument();
  });

  it('does not render message when processingMessage is empty', () => {
    render(<ProcessingScreen fileName="reporte.csv" />);
    expect(screen.queryByText('Analizando')).not.toBeInTheDocument();
  });

  it('does not render fallback banner when usedFallbackHolidays is false', () => {
    render(<ProcessingScreen fileName="reporte.csv" />);
    expect(screen.queryByText(/feriados en línea/i)).not.toBeInTheDocument();
  });

  it('shows fallback banner when usedFallbackHolidays is true', () => {
    useTasStore.getState().setUsedFallbackHolidays(true);
    render(<ProcessingScreen fileName="reporte.csv" />);
    expect(screen.getByText(/feriados en línea/i)).toBeInTheDocument();
  });

  it('does not show banner when dismissed', () => {
    useTasStore.getState().setUsedFallbackHolidays(true);
    useTasStore.getState().dismissFallbackBanner();
    render(<ProcessingScreen fileName="reporte.csv" />);
    expect(screen.queryByText(/feriados en línea/i)).not.toBeInTheDocument();
  });

  it('dismiss button hides the banner', () => {
    useTasStore.getState().setUsedFallbackHolidays(true);
    render(<ProcessingScreen fileName="reporte.csv" />);
    const dismissBtn = screen.getByRole('button', { name: /cerrar aviso/i });
    fireEvent.click(dismissBtn);
    expect(useTasStore.getState().fallbackBannerDismissed).toBe(true);
    expect(screen.queryByText(/feriados en línea/i)).not.toBeInTheDocument();
  });

  it('renders error message instead of spinner when error is set', () => {
    useTasStore.getState().setError('Columnas requeridas no encontradas: [Fecha y hora].');
    render(<ProcessingScreen fileName="reporte.csv" />);
    expect(screen.getByText('Columnas requeridas no encontradas: [Fecha y hora].')).toBeInTheDocument();
    expect(screen.queryByText(/procesando/i)).not.toBeInTheDocument();
  });
});
