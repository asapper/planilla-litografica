import type { ReactNode } from 'react';

interface Props {
  bg: string;
  color: string;
  children: ReactNode;
}

export default function IconBadge({ bg, color, children }: Props) {
  return (
    <div className={`w-16 h-16 rounded-shape-xl ${bg} flex items-center justify-center mx-auto mb-6`}>
      <svg className={`w-8 h-8 ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </div>
  );
}
