import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmployeeGroup from './EmployeeGroup';

describe('EmployeeGroup', () => {
  it('renders the employee name', () => {
    render(
      <EmployeeGroup employeeName="Ana López" pendingCount={1} expanded={true} onToggle={() => {}}>
        <div>child content</div>
      </EmployeeGroup>,
    );
    expect(screen.getByText('Ana López')).toBeInTheDocument();
  });

  it('shows a pending badge with the count when pendingCount > 0', () => {
    render(
      <EmployeeGroup employeeName="Ana López" pendingCount={2} expanded={true} onToggle={() => {}}>
        <div>child content</div>
      </EmployeeGroup>,
    );
    expect(screen.getByText('2 por resolver')).toBeInTheDocument();
    expect(screen.queryByText(/Resuelto/)).not.toBeInTheDocument();
  });

  it('shows "Resuelto" when pendingCount is 0', () => {
    render(
      <EmployeeGroup employeeName="Ana López" pendingCount={0} expanded={false} onToggle={() => {}}>
        <div>child content</div>
      </EmployeeGroup>,
    );
    expect(screen.getByText(/Resuelto/)).toBeInTheDocument();
    expect(screen.queryByText(/por resolver/)).not.toBeInTheDocument();
  });

  it('renders children when expanded', () => {
    render(
      <EmployeeGroup employeeName="Ana López" pendingCount={1} expanded={true} onToggle={() => {}}>
        <div>child content</div>
      </EmployeeGroup>,
    );
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('does not render children when collapsed', () => {
    render(
      <EmployeeGroup employeeName="Ana López" pendingCount={0} expanded={false} onToggle={() => {}}>
        <div>child content</div>
      </EmployeeGroup>,
    );
    expect(screen.queryByText('child content')).not.toBeInTheDocument();
  });

  it('calls onToggle when the header is clicked', () => {
    const onToggle = vi.fn();
    render(
      <EmployeeGroup employeeName="Ana López" pendingCount={1} expanded={true} onToggle={onToggle}>
        <div>child content</div>
      </EmployeeGroup>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ana López/ }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows a collapse chevron (▾) when expanded and an expand chevron (▸) when collapsed', () => {
    const { rerender } = render(
      <EmployeeGroup employeeName="Ana López" pendingCount={1} expanded={true} onToggle={() => {}}>
        <div>child</div>
      </EmployeeGroup>,
    );
    expect(screen.getByRole('button', { name: /Ana López/ })).toHaveTextContent('▾');

    rerender(
      <EmployeeGroup employeeName="Ana López" pendingCount={1} expanded={false} onToggle={() => {}}>
        <div>child</div>
      </EmployeeGroup>,
    );
    expect(screen.getByRole('button', { name: /Ana López/ })).toHaveTextContent('▸');
  });
});
