import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ToastContainer from './ToastContainer';
import { useToastStore } from '../../toastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastContainer', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild?.childNodes.length ?? 0).toBe(0);
  });

  it('renders a success toast with role="status"', () => {
    useToastStore.getState().showToast('Saved!', 'success');
    render(<ToastContainer />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  it('renders an error toast', () => {
    useToastStore.getState().showToast('Failed', 'error');
    render(<ToastContainer />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    const toast = screen.getByRole('status');
    expect(toast.className).toContain('bg-error');
  });

  it('renders a warning toast', () => {
    useToastStore.getState().showToast('Watch out', 'warning');
    render(<ToastContainer />);
    expect(screen.getByText('Watch out')).toBeInTheDocument();
    const toast = screen.getByRole('status');
    expect(toast.className).toContain('bg-amber-600');
  });

  it('renders an info toast', () => {
    useToastStore.getState().showToast('FYI', 'info');
    render(<ToastContainer />);
    expect(screen.getByText('FYI')).toBeInTheDocument();
    const toast = screen.getByRole('status');
    expect(toast.className).toContain('bg-tertiary');
  });

  it('stacks multiple toasts', () => {
    useToastStore.getState().showToast('First');
    useToastStore.getState().showToast('Second');
    render(<ToastContainer />);
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('auto-dismisses after 3 seconds', async () => {
    useToastStore.getState().showToast('Bye');
    render(<ToastContainer />);
    expect(screen.getByText('Bye')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.queryByText('Bye')).not.toBeInTheDocument();
  });

  it('dismiss button removes the toast immediately', () => {
    useToastStore.getState().showToast('Dismiss me');
    render(<ToastContainer />);
    const btn = screen.getByRole('button', { name: /cerrar/i });
    fireEvent.click(btn);
    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
  });
});
