import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PrintDialog from './PrintDialog';

describe('PrintDialog', () => {
  it('defaults to the summary so a stray click does not print every page', () => {
    const onPrint = vi.fn();
    render(<PrintDialog employeeCount={3} onPrint={onPrint} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Imprimir reporte' })).toBeInTheDocument();
    expect(screen.getByText(/Incluye 3 empleados a enviar/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Resumen aprox\. 1 página/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(onPrint).toHaveBeenCalledWith('summary');
  });

  it('prints the detail when chosen', () => {
    const onPrint = vi.fn();
    render(<PrintDialog employeeCount={1} onPrint={onPrint} onCancel={vi.fn()} />);
    expect(screen.getByText(/Incluye 1 empleado a enviar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /^Resumen y detalle/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(onPrint).toHaveBeenCalledWith('detail');
  });

  it.each([
    [1, 'aprox\\. 1 página', 'aprox\\. 2 páginas'],
    [42, 'aprox\\. 2 páginas', 'aprox\\. 23 páginas'],
  ])('estimates the pages for %i employees', (count, summary, detail) => {
    render(<PrintDialog employeeCount={count} onPrint={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('radio', { name: new RegExp(`^Resumen ${summary}`) })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: new RegExp(`^Resumen y detalle por empleado ${detail}`) })).toBeInTheDocument();
  });

  it('cancels from the button, the backdrop and Escape, but not from a click inside', () => {
    const onCancel = vi.fn();
    const { container } = render(<PrintDialog employeeCount={1} onPrint={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(container.firstChild as Element);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' });
    expect(onCancel).toHaveBeenCalledTimes(3);
  });
});
