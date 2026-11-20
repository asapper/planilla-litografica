import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  // Milliseconds until it closes by itself; null keeps it up until dismissed.
  durationMs: number | null;
  shownAt: number;
}

export interface ToastOptions {
  durationMs?: number | null;
}

interface ToastStore {
  toasts: Toast[];
  showToast: (message: string, variant?: ToastVariant, options?: ToastOptions) => number;
  dismissToast: (id: number) => void;
}

const MAX_TOASTS = 3;
export const MIN_TOAST_MS = 3_000;
export const TOAST_MS_PER_WORD = 250;

// Long enough to read: short messages get the minimum, longer ones a quarter second per word.
export function readingTimeMs(message: string): number {
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_TOAST_MS, words * TOAST_MS_PER_WORD);
}

const expiresAt = (t: Toast) => (t.durationMs === null ? Infinity : t.shownAt + t.durationMs);

// Over the limit, the newest toast always shows. Of the older ones, the one closest to closing by
// itself goes first, so the close refusal (30 s) outlives short notices and a warning that stays
// until dismissed goes only when every older toast is one. Keep such warnings below MAX_TOASTS.
function trim(toasts: Toast[]): Toast[] {
  const kept = [...toasts];
  while (kept.length > MAX_TOASTS) {
    const older = kept.slice(0, -1);
    const soonest = older.reduce((best, t, i) => (expiresAt(t) < expiresAt(older[best]) ? i : best), 0);
    kept.splice(soonest, 1);
  }
  return kept;
}

let nextId = 1;

export const useToastStore = create<ToastStore>(set => ({
  toasts: [],
  showToast: (message, variant = 'success', options = {}) => {
    const id = nextId++;
    const durationMs = options.durationMs === undefined ? readingTimeMs(message) : options.durationMs;
    set(s => ({ toasts: trim([...s.toasts, { id, message, variant, durationMs, shownAt: Date.now() }]) }));
    return id;
  },
  dismissToast: (id) =>
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));
