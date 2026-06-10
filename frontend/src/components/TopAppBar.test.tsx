import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopAppBar from './TopAppBar';
import type { AppView } from '../types';

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
  it('is not rendered when tasView is idle', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="idle" onNewUpload={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /nueva carga/i })).not.toBeInTheDocument();
  });

  it('is rendered when tasView is not idle', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /nueva carga/i })).toBeInTheDocument();
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

  it('calls onNewUpload when the confirmation is accepted', () => {
    const onNewUpload = vi.fn();
    render(<TopAppBar currentView="tas" onViewChange={noop} tasView="review" onNewUpload={onNewUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /nueva carga/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));
    expect(onNewUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Iniciar nueva carga')).not.toBeInTheDocument();
  });
});
