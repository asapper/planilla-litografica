import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  maxWidth?: string;
  card?: 'elevated' | 'outlined';
  centerText?: boolean;
}

export default function ScreenLayout({
  children,
  maxWidth = 'max-w-lg',
  card = 'elevated',
  centerText = false,
}: Props) {
  const cardClass = card === 'outlined' ? 'm3-card-outlined' : 'm3-card-elevated';
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 pb-6 pt-16">
      <div className={`${cardClass} w-full ${maxWidth}${centerText ? ' text-center' : ''}`}>
        {children}
      </div>
    </div>
  );
}
