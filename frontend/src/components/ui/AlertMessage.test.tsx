import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
