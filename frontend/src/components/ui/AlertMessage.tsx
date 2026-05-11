interface Props {
  message: string;
  variant?: 'error' | 'warning';
  className?: string;
}

export default function AlertMessage({ message, variant = 'error', className = '' }: Props) {
  const bg   = variant === 'error' ? 'bg-error-container'   : 'bg-warning-container';
  const text = variant === 'error' ? 'text-on-error-container' : 'text-on-warning-container';
  return (
    <div className={`rounded-shape-sm ${bg} px-4 py-3 text-left ${className}`.trim()}>
      <p className={`text-body-sm ${text}`}>{message}</p>
    </div>
  );
}
