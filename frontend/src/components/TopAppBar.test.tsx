import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopAppBar from './TopAppBar';
import type { AppView } from '../types';

const noop = vi.fn<[AppView], void>();

describe('TopAppBar', () => {
  it('renders the app title', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} />);
    expect(screen.getByText('Cargador de Planilla')).toBeInTheDocument();
  });

  it('renders the Configuración button', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} />);
    expect(screen.getByRole('button', { name: /configuración/i })).toBeInTheDocument();
  });

  it('highlights Configuración button when currentView is config', () => {
    render(<TopAppBar currentView="config" onViewChange={noop} />);
    expect(screen.getByRole('button', { name: /configuración/i })).toHaveClass('bg-white');
  });

  it('does not highlight Configuración button when currentView is tas', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} />);
    expect(screen.getByRole('button', { name: /configuración/i })).not.toHaveClass('bg-white');
  });

  it('calls onViewChange with "config" when Configuración is clicked', () => {
    render(<TopAppBar currentView="tas" onViewChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /configuración/i }));
    expect(noop).toHaveBeenCalledWith('config');
  });
});
