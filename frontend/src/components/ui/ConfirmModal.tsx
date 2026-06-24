import { useEffect, useRef } from 'react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    backdropRef.current?.focus();
  }, []);

  return (
    <div
      ref={backdropRef}
      tabIndex={-1}
      data-testid="confirm-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 outline-none"
      onClick={onCancel}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
    >
      <div
        className="bg-surface-container-lowest rounded-shape-lg shadow-lg max-w-sm w-full mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-title-md font-medium text-on-surface mb-2">{title}</h3>
        <p className="text-body-sm text-on-surface-variant mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="m3-btn-outlined"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="m3-btn-filled !bg-error !text-on-error"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
