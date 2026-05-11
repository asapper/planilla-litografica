import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

const ICON = <path d="M1 1" />;

describe('StatusBadge', () => {
  it('renders children label', () => {
    render(<StatusBadge variant="error" icon={ICON}>3 errores</StatusBadge>);
    expect(screen.getByText('3 errores')).toBeInTheDocument();
  });

  it('applies error styles', () => {
    const { container } = render(<StatusBadge variant="error" icon={ICON}>x</StatusBadge>);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-error-container');
    expect(badge.className).toContain('text-on-error-container');
  });

  it('applies warning styles', () => {
    const { container } = render(<StatusBadge variant="warning" icon={ICON}>x</StatusBadge>);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-warning-container');
    expect(badge.className).toContain('text-on-warning-container');
  });

  it('renders icon inside svg', () => {
    const { container } = render(
      <StatusBadge variant="error" icon={<path data-testid="icon" d="M1 1" />}>x</StatusBadge>
    );
    expect(container.querySelector('[data-testid="icon"]')).not.toBeNull();
  });
});
