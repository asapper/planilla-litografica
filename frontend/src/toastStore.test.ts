import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useToastStore, readingTimeMs, MIN_TOAST_MS, TOAST_MS_PER_WORD } from './toastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
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

  it('limits visible toasts to 3, dropping oldest', () => {
    const { showToast } = useToastStore.getState();
    showToast('First');
    showToast('Second');
    showToast('Third');
    showToast('Fourth');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(3);
    expect(toasts[0].message).toBe('Second');
    expect(toasts[2].message).toBe('Fourth');
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

  it('returns the id of the toast it shows', () => {
    const id = useToastStore.getState().showToast('A');
    expect(useToastStore.getState().toasts[0].id).toBe(id);
  });

  it('gives short messages the minimum time and long ones a quarter second per word', () => {
    expect(readingTimeMs('Guardado')).toBe(MIN_TOAST_MS);
    expect(readingTimeMs(Array(12).fill('palabra').join(' '))).toBe(MIN_TOAST_MS);
    expect(readingTimeMs(Array(30).fill('palabra').join('  '))).toBe(30 * TOAST_MS_PER_WORD);
    useToastStore.getState().showToast(Array(20).fill('x').join(' '));
    expect(useToastStore.getState().toasts[0].durationMs).toBe(20 * TOAST_MS_PER_WORD);
  });

  it('takes an explicit duration, or none to stay up until dismissed', () => {
    const { showToast } = useToastStore.getState();
    showToast('A', 'error', { durationMs: 30_000 });
    showToast('B', 'warning', { durationMs: null });
    expect(useToastStore.getState().toasts.map(t => t.durationMs)).toEqual([30_000, null]);
  });

  it('over the limit, drops the older toast closest to closing and keeps one that must stay', () => {
    const { showToast } = useToastStore.getState();
    showToast('Stays', 'warning', { durationMs: null });
    showToast('Second');
    showToast('Third');
    showToast('Fourth');
    expect(useToastStore.getState().toasts.map(t => t.message)).toEqual(['Stays', 'Third', 'Fourth']);
  });

  it('keeps the close refusal over shorter notices that arrive after it', () => {
    vi.useFakeTimers();
    const { showToast } = useToastStore.getState();
    showToast('Stays', 'warning', { durationMs: null });
    showToast('Refusal', 'error', { durationMs: 30_000 });
    vi.advanceTimersByTime(1_000);
    showToast('Saved again');
    vi.advanceTimersByTime(1_000);
    showToast('Other');
    expect(useToastStore.getState().toasts.map(t => t.message)).toEqual(['Stays', 'Refusal', 'Other']);
  });

  it('always shows the newest toast, even when every older one must stay', () => {
    const { showToast } = useToastStore.getState();
    for (const m of ['1', '2', '3']) showToast(m, 'warning', { durationMs: null });
    showToast('New');
    expect(useToastStore.getState().toasts.map(t => t.message)).toEqual(['2', '3', 'New']);
  });
});
