import type { ReactNode } from 'react';

interface Props {
  variant: 'error' | 'warning' | 'success';
  icon: ReactNode;
  children: ReactNode;
}

export default function StatusBadge({ variant, icon, children }: Props) {
  const bg   = variant === 'error'   ? 'bg-error-container'
             : variant === 'warning' ? 'bg-warning-container'
             :                         'bg-success-container';
  const text = variant === 'error'   ? 'text-on-error-container'
             : variant === 'warning' ? 'text-on-warning-container'
             :                         'text-on-success-container';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-shape-full ${bg} ${text} px-3 py-1 text-label-md`}>
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {icon}
      </svg>
      {children}
    </span>
  );
}
