interface Props {
  message: string;
  variant?: 'error' | 'warning' | 'info' | 'success';
  className?: string;
  onDismiss?: () => void;
}

const BG: Record<string, string> = {
  error:   'bg-error-container',
  warning: 'bg-warning-container',
  info:    'bg-tertiary-container',
  success: 'bg-success-container',
};

const TEXT: Record<string, string> = {
  error:   'text-on-error-container',
  warning: 'text-on-warning-container',
  info:    'text-on-tertiary-container',
  success: 'text-on-success-container',
};

export default function AlertMessage({ message, variant = 'error', className = '', onDismiss }: Props) {
  return (
    <div className={`rounded-shape-sm ${BG[variant]} px-4 py-3 text-left ${className}`.trim()}>
      <div className="flex items-start gap-2">
        <p className={`text-body-sm ${TEXT[variant]} flex-1`}>{message}</p>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Cerrar"
            className={`${TEXT[variant]} opacity-70 hover:opacity-100 shrink-0`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
