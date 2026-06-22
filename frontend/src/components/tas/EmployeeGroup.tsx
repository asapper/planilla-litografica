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
    <div className="border border-outline-variant rounded-shape-md mb-3 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`w-full flex items-center justify-between gap-3 bg-surface-container-lowest px-4 py-3 text-left cursor-pointer ${
          expanded ? 'rounded-t-shape-md border-b border-outline-variant' : 'rounded-shape-md'
        }`}
      >
        <span className="font-medium text-on-surface">{employeeName}</span>
        <div className="flex items-center gap-2">
          {resolved ? (
            <span className="text-label-md font-medium text-success">✓ Resuelto</span>
          ) : (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-error text-on-error text-label-md font-medium">
              {pendingCount} por resolver
            </span>
          )}
          <span className="text-on-surface-variant text-body-sm" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="bg-surface-container rounded-b-shape-md px-3 py-3 flex flex-col gap-3">
          {children}
        </div>
      )}
    </div>
  );
}
