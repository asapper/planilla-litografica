import { describe, it, expect, beforeEach } from 'vitest';
import { useToastStore } from './toastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('toastStore', () => {
  it('adds a toast with showToast', () => {
    useToastStore.getState().showToast('Saved');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Saved');
    expect(toasts[0].variant).toBe('success');
  });

  it('defaults variant to success', () => {
    useToastStore.getState().showToast('Done');
    expect(useToastStore.getState().toasts[0].variant).toBe('success');
  });

  it('accepts an explicit variant', () => {
    useToastStore.getState().showToast('Failed', 'error');
    expect(useToastStore.getState().toasts[0].variant).toBe('error');
  });

  it('stacks multiple toasts', () => {
    useToastStore.getState().showToast('First');
    useToastStore.getState().showToast('Second', 'error');
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it('assigns unique ids', () => {
    useToastStore.getState().showToast('A');
    useToastStore.getState().showToast('B');
    const [a, b] = useToastStore.getState().toasts;
    expect(a.id).not.toBe(b.id);
  });

  it('removes a toast by id with dismissToast', () => {
    useToastStore.getState().showToast('A');
    useToastStore.getState().showToast('B');
    const idToRemove = useToastStore.getState().toasts[0].id;
    useToastStore.getState().dismissToast(idToRemove);
    const remaining = useToastStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe('B');
  });
});
