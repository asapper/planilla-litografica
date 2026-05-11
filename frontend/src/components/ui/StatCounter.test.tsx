import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatCounter from './StatCounter';

describe('StatCounter', () => {
  it('renders value and label', () => {
    render(<StatCounter value={42} label="enviados" />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('enviados')).toBeInTheDocument();
  });

  it('applies default color to value', () => {
    const { container } = render(<StatCounter value={1} label="x" />);
    const value = container.querySelector('p:first-child');
    expect(value?.className).toContain('text-primary');
  });

  it('applies custom color', () => {
    const { container } = render(<StatCounter value={1} label="x" color="text-error" />);
    const value = container.querySelector('p:first-child');
    expect(value?.className).toContain('text-error');
  });
});
