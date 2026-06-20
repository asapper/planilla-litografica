import { useEffect } from 'react';
import { useToastStore } from '../../toastStore';
import type { ToastVariant } from '../../toastStore';

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'bg-green-600 text-white',
  error:   'bg-error text-on-error',
  warning: 'bg-amber-600 text-white',
  info:    'bg-tertiary text-on-tertiary',
};

function ToastItem({ id, message, variant }: { id: number; message: string; variant: ToastVariant }) {
  const dismissToast = useToastStore(s => s.dismissToast);

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(id), 3_000);
    return () => clearTimeout(timer);
  }, [id, dismissToast]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 px-4 py-3 rounded shadow-lg text-sm ${VARIANT_CLASSES[variant]}`}
    >
      <span className="flex-1">{message}</span>
      <button
        onClick={() => dismissToast(id)}
        aria-label="Cerrar"
        className="shrink-0 opacity-80 hover:opacity-100"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore(s => s.toasts);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <ToastItem key={t.id} id={t.id} message={t.message} variant={t.variant} />
      ))}
    </div>
  );
}
