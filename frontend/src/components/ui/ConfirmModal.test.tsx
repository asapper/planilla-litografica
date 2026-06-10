import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmModal from './ConfirmModal';

describe('ConfirmModal', () => {
  const baseProps = {
    title: 'Iniciar nueva carga',
    message: 'Esta acción descartará la sesión actual, incluyendo los cambios sin guardar. ¿Deseas continuar?',
    confirmLabel: 'Sí, descartar',
    cancelLabel: 'Cancelar',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders the title and message', () => {
    render(<ConfirmModal {...baseProps} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Iniciar nueva carga')).toBeInTheDocument();
    expect(screen.getByText(/se perderá|descartará/i)).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal {...baseProps} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('confirm-modal-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not call onCancel when the dialog card itself is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Iniciar nueva carga'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
