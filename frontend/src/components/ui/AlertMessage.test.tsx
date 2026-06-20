import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AlertMessage from './AlertMessage';

describe('AlertMessage', () => {
  it('renders the message text', () => {
    render(<AlertMessage message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('uses error styles by default', () => {
    const { container } = render(<AlertMessage message="err" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('bg-error-container');
    expect(wrapper.querySelector('p')?.className).toContain('text-on-error-container');
  });

  it('uses warning styles when variant="warning"', () => {
    const { container } = render(<AlertMessage message="warn" variant="warning" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('bg-warning-container');
    expect(wrapper.querySelector('p')?.className).toContain('text-on-warning-container');
  });

  it('appends extra className to wrapper', () => {
    const { container } = render(<AlertMessage message="x" className="mt-4" />);
    expect((container.firstChild as HTMLElement).className).toContain('mt-4');
  });

  it('uses info styles when variant="info"', () => {
    const { container } = render(<AlertMessage message="note" variant="info" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('bg-tertiary-container');
    expect(wrapper.querySelector('p')?.className).toContain('text-on-tertiary-container');
  });

  it('uses success styles when variant="success"', () => {
    const { container } = render(<AlertMessage message="done" variant="success" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('bg-success-container');
    expect(wrapper.querySelector('p')?.className).toContain('text-on-success-container');
  });

  it('renders dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<AlertMessage message="close me" onDismiss={onDismiss} />);
    const btn = screen.getByRole('button', { name: /cerrar/i });
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render dismiss button when onDismiss is absent', () => {
    render(<AlertMessage message="no close" />);
    expect(screen.queryByRole('button', { name: /cerrar/i })).not.toBeInTheDocument();
  });
});
