import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScreenLayout from './ScreenLayout';

describe('ScreenLayout', () => {
  it('renders children', () => {
    render(<ScreenLayout><p>hello</p></ScreenLayout>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('applies maxWidth class', () => {
    const { container } = render(<ScreenLayout maxWidth="max-w-md"><p>x</p></ScreenLayout>);
    expect(container.querySelector('.max-w-md')).not.toBeNull();
  });

  it('uses elevated card by default', () => {
    const { container } = render(<ScreenLayout><p>x</p></ScreenLayout>);
    expect(container.querySelector('.m3-card-elevated')).not.toBeNull();
  });

  it('uses outlined card when card="outlined"', () => {
    const { container } = render(<ScreenLayout card="outlined"><p>x</p></ScreenLayout>);
    expect(container.querySelector('.m3-card-outlined')).not.toBeNull();
  });

  it('adds text-center when centerText is true', () => {
    const { container } = render(<ScreenLayout centerText><p>x</p></ScreenLayout>);
    const card = container.querySelector('.m3-card-elevated');
    expect(card?.className).toContain('text-center');
  });

  it('does not add text-center by default', () => {
    const { container } = render(<ScreenLayout><p>x</p></ScreenLayout>);
    const card = container.querySelector('.m3-card-elevated');
    expect(card?.className).not.toContain('text-center');
  });
});
