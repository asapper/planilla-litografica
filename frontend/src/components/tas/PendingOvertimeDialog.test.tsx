import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PendingOvertimeDialog, { type PendingOvertimeItem } from './PendingOvertimeDialog';

const item = (over: Partial<PendingOvertimeItem>): PendingOvertimeItem => ({
  code: '1', name: 'Ana', calcSimples: 2, calcDobles: 0, changed: false, sendsTyped: false, ...over,
});

describe('PendingOvertimeDialog', () => {
  it('lists what goes as zero apart from hand values made before the calculation changed', () => {
    render(<PendingOvertimeDialog
      items={[item({}), item({ code: '2', name: 'Bea', changed: true }), item({ code: '3', name: 'Cruz', changed: true, sendsTyped: true })]}
      onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('2 empleados se enviarán con 0 horas extra')).toBeInTheDocument();
    expect(screen.getByText('1 ajuste se enviará como se escribió, aunque el cálculo cambió')).toBeInTheDocument();
    expect(screen.getByText('Volver a revisar')).toHaveFocus();
  });

  it('shows only the groups that have rows, in the singular', () => {
    render(<PendingOvertimeDialog items={[item({})]} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('1 empleado se enviará con 0 horas extra')).toBeInTheDocument();
    expect(screen.queryByText(/ajuste/)).not.toBeInTheDocument();
  });

  it('cancels from the button, the backdrop and Escape, but not from a click inside', () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const { container } = render(<PendingOvertimeDialog items={[item({})]} onSubmit={onSubmit} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a revisar' }));
    fireEvent.click(container.firstChild as Element);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' });
    expect(onCancel).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar de todas formas' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
