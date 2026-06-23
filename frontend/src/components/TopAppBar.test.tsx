import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopAppBar from './TopAppBar';
import type { AppView } from '../types';
import type { TasView } from '../tasTypes';
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(),
}));

const noop = vi.fn<(view: AppView) => void>();

describe('TopAppBar', () => {
  it('renders the app title', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.getByText('Cargador de Planilla')).toBeInTheDocument();
  });

  it('renders the Configuración button', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /configuración/i })).toBeInTheDocument();
  });

  it('highlights Configuración button when currentView is config', () => {
    render(<TopAppBar currentView="config" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /configuración/i })).toHaveClass('bg-white');
  });

  it('does not highlight Configuración button when currentView is tas', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /configuración/i })).not.toHaveClass('bg-white');
  });

  it('calls onViewChange with "config" when Configuración is clicked', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /configuración/i }));
    expect(noop).toHaveBeenCalledWith('config');
  });
});

describe('Nueva carga button', () => {
  const nonIdleViews: TasView[] = ['processing', 'inactiveReview', 'verification', 'review', 'submitting', 'result', 'absentReview'];

  it('is not rendered when tasView is idle on tas view', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /nueva carga/i })).not.toBeInTheDocument();
  });

  it('is rendered on config view when tasView is idle and calls onNewUpload directly', () => {
    const onNewUpload = vi.fn();
    render(<TopAppBar currentView="config" onViewChange={noop} tasView="idle" onNewUpload={onNewUpload} />);
    const btn = screen.getByRole('button', { name: /nueva carga/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onNewUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
  });

  it.each(nonIdleViews)('is rendered when tasView is "%s" on tas view', (tasView) => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView={tasView} onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
  });

  it.each(nonIdleViews)('is rendered when tasView is "%s" on config view', (tasView) => {
    render(<TopAppBar currentView="config" onViewChange={noop} tasView={tasView} onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
  });

  it('is disabled when tasView is submitting', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="submitting" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeDisabled();
  });

  it('does not open the confirmation modal when clicked while submitting', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="submitting" onNewUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
  });

  it('opens a confirmation modal when clicked', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    expect(screen.getByText('Iniciar nueva carga')).toBeInTheDocument();
  });

  it('does not call onNewUpload when the modal is cancelled', () => {
    const onNewUpload = vi.fn();
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={onNewUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onNewUpload).not.toHaveBeenCalled();
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
  });

  it('does not call onNewUpload when the modal backdrop is clicked', () => {
    const onNewUpload = vi.fn();
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={onNewUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    fireEvent.click(screen.getByTestId('confirm-modal-backdrop'));
    expect(onNewUpload).not.toHaveBeenCalled();
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
  });

  it('auto-closes the confirmation modal when tasView transitions to submitting', () => {
    const onNewUpload = vi.fn();
    const { rerender } = render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={onNewUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    expect(screen.getByText('Iniciar nueva carga')).toBeInTheDocument();
    rerender(<TopAppBar currentView="tas" onViewChange={noop} tasView="submitting" onNewUpload={onNewUpload} />);
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
    expect(onNewUpload).not.toHaveBeenCalled();
  });

  it('calls onNewUpload when the confirmation is accepted', () => {
    const onNewUpload = vi.fn();
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={onNewUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));
    expect(onNewUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
  });
});

describe('Volver a la carga button (config → tas toggle)', () => {
  it('is not shown when on config view with idle tasView', () => {
    render(<TopAppBar currentView="config" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /volver a la carga/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /configuración/i })).toBeInTheDocument();
  });

  it('replaces Configuración when on config view with active session', () => {
    render(<TopAppBar currentView="config" onViewChange={noop} tasView="review" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /volver a la carga/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /configuración/i })).not.toBeInTheDocument();
  });

  it('is not shown when on tas view even with active session', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /volver a la carga/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /configuración/i })).toBeInTheDocument();
  });

  it('calls onViewChange with "tas" when clicked', () => {
    const onViewChange = vi.fn();
    render(<TopAppBar currentView="config" onViewChange={onViewChange} tasView="verification" onNewUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /volver a la carga/i }));
    expect(onViewChange).toHaveBeenCalledWith('tas');
  });

  it('appears during submitting state on config view', () => {
    render(<TopAppBar currentView="config" onViewChange={noop} tasView="submitting" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /volver a la carga/i })).toBeInTheDocument();
  });
});

describe('Ayuda button', () => {
  it('is always rendered regardless of view', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /ayuda/i })).toBeInTheDocument();
  });

  it('is rendered on config view', () => {
    render(<TopAppBar currentView="config" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /ayuda/i })).toBeInTheDocument();
  });

  it('opens the PDF in a new browser tab in dev mode', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /ayuda/i }));

    expect(openSpy).toHaveBeenCalledWith('/manual_usuario.pdf', '_blank');
    openSpy.mockRestore();
  });
});
