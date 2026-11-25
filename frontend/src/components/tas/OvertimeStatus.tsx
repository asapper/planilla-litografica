import type { MouseEvent } from 'react';
import type { EffectiveOvertime } from '../../overtime';
import type { ResolvedRow } from '../../tasTypes';

export default function OvertimeStatus({ row, overtime, onApprove, onUndo, onKeep }: {
  row: ResolvedRow;
  overtime: EffectiveOvertime;
  onApprove: (row: ResolvedRow) => void;
  onUndo: (code: string) => void;
  onKeep: () => void;
}) {
  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };
  const link = 'text-label-sm text-primary underline hover:text-primary/80';
  switch (overtime.status) {
    case 'none':
      return null;
    case 'pending':
    case 'stale':
      return (
        <div className="flex items-center gap-2">
          <button onClick={stop(() => onApprove(row))} className="m3-btn-tonal px-3 h-7 text-label-md" aria-label={`Aprobar horas extra ${row.nombreEmpleado}`}>
            Aprobar
          </button>
          {overtime.status === 'stale' && <span className="text-label-sm text-warning">el cálculo cambió</span>}
        </div>
      );
    case 'approved':
      return (
        <div className="flex items-center gap-2">
          <span className="text-label-sm text-success font-medium">✓ Aprobado</span>
          <button onClick={stop(() => onUndo(row.codigoEmpleado))} className={link} aria-label={`Deshacer horas extra ${row.nombreEmpleado}`}>Deshacer</button>
        </div>
      );
    case 'adjusted':
      return (
        <div className="flex items-center gap-2 flex-wrap">
          {overtime.calcChanged
            ? <button onClick={stop(onKeep)} className="m3-btn-tonal px-3 h-7 text-label-md" aria-label={`Mantener ajuste ${row.nombreEmpleado}`}>Mantener</button>
            : <span className="text-label-sm text-primary font-medium">Ajustado</span>}
          <button onClick={stop(() => onUndo(row.codigoEmpleado))} className={link} aria-label={`Deshacer horas extra ${row.nombreEmpleado}`}>Deshacer</button>
          {overtime.calcChanged && <span className="text-label-sm text-warning">el cálculo cambió</span>}
        </div>
      );
  }
}
