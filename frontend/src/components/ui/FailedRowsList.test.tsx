import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FailedRowsList from './FailedRowsList';

const rows = [
  { id: '1', name: 'Empleado 1', error: 'DB error' },
  { id: '2', name: 'Ana García',  error: null },
];

describe('FailedRowsList', () => {
  it('renders nothing for empty rows', () => {
    const { container } = render(<FailedRowsList rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders each row name and error', () => {
    render(<FailedRowsList rows={rows} />);
    expect(screen.getByText('Empleado 1')).toBeInTheDocument();
    expect(screen.getByText('DB error')).toBeInTheDocument();
    expect(screen.getByText('Ana García')).toBeInTheDocument();
  });

  it('shows "Error desconocido" for null error', () => {
    render(<FailedRowsList rows={rows} />);
    expect(screen.getByText('Error desconocido')).toBeInTheDocument();
  });

  it('shows section heading', () => {
    render(<FailedRowsList rows={rows} />);
    expect(screen.getByText('Registros con error')).toBeInTheDocument();
  });

  it('applies max-h-64 overflow when scrollable', () => {
    const { container } = render(<FailedRowsList rows={rows} scrollable />);
    expect((container.firstChild as HTMLElement).className).toContain('max-h-64');
  });

  it('does not apply max-h-64 when not scrollable', () => {
    const { container } = render(<FailedRowsList rows={rows} />);
    expect((container.firstChild as HTMLElement).className).not.toContain('max-h-64');
  });
});
