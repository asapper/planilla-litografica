import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Spinner from './Spinner';

describe('Spinner', () => {
  it('renders an svg with animate-spin', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('animate-spin');
  });

  it('applies custom size class', () => {
    const { container } = render(<Spinner size="w-10 h-10" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('w-10 h-10');
  });

  it('applies extra className', () => {
    const { container } = render(<Spinner className="my-class" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('my-class');
  });
});
