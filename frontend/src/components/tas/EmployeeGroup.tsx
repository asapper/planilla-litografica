import type { ReactNode } from 'react';

interface EmployeeGroupProps {
  employeeName: string;
  pendingCount: number;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export default function EmployeeGroup({ employeeName, pendingCount, expanded, onToggle, children }: EmployeeGroupProps) {
  const resolved = pendingCount === 0;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 bg-white rounded-shape-md border border-outline-variant px-4 py-3 shadow-sm cursor-pointer text-left"
      >
        <span className="font-medium text-on-surface">{employeeName}</span>
        {resolved ? (
          <span className="text-label-md font-medium text-green-600">✓ Resuelto</span>
        ) : (
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-error text-white text-label-md font-medium">
            {pendingCount} por resolver
          </span>
        )}
      </button>
      {expanded && (
        <div className="pl-2 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}
