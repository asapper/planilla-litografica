import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import IconBadge from './IconBadge';

describe('IconBadge', () => {
  it('applies bg and color classes', () => {
    const { container } = render(
      <IconBadge bg="bg-primary-container" color="text-on-primary-container">
        <path d="M1 1" />
      </IconBadge>
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('bg-primary-container');
    const svg = wrapper.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('text-on-primary-container');
  });

  it('renders children inside svg', () => {
    const { container } = render(
      <IconBadge bg="bg-error-container" color="text-on-error-container">
        <path data-testid="icon-path" d="M1 1" />
      </IconBadge>
    );
    expect(container.querySelector('[data-testid="icon-path"]')).not.toBeNull();
  });
});
