import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import IncompletePunchesDialog from './IncompletePunchesDialog';

const item = { sessionId: 1, employeeName: 'Ana López', date: '01 oct 2026', detail: 'Falta salida · Entrada 07:02' };

describe('IncompletePunchesDialog', () => {
  it('lists each day and starts on going back', () => {
    render(<IncompletePunchesDialog items={[item]} onContinue={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('1 marcación incompleta')).toBeInTheDocument();
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('01 oct 2026 · Falta salida · Entrada 07:02')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a completar' })).toHaveFocus();
  });

  it('says how many in the plural', () => {
    render(<IncompletePunchesDialog items={[item, { ...item, sessionId: 2 }]} onContinue={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('2 marcaciones incompletas')).toBeInTheDocument();
  });

  it('cancels from the button, the backdrop and Escape, but not from a click inside', () => {
    const onCancel = vi.fn();
    const onContinue = vi.fn();
    const { container } = render(<IncompletePunchesDialog items={[item]} onContinue={onContinue} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a completar' }));
    fireEvent.click(container.firstChild as Element);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' });
    expect(onCancel).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar de todas formas' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
