import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastStore {
  toasts: Toast[];
  showToast: (message: string, variant?: ToastVariant) => void;
  dismissToast: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>(set => ({
  toasts: [],
  showToast: (message, variant = 'success') =>
    set(s => ({ toasts: [...s.toasts, { id: nextId++, message, variant }] })),
  dismissToast: (id) =>
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));
