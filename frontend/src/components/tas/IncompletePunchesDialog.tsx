import { useEffect, useRef } from 'react';

export interface IncompletePunchItem {
  sessionId: number;
  employeeName: string;
  date: string;
  detail: string;
}

interface IncompletePunchesDialogProps {
  items: IncompletePunchItem[];
  onContinue: () => void;
  onCancel: () => void;
}

export default function IncompletePunchesDialog({ items, onContinue, onCancel }: IncompletePunchesDialogProps) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="incomplete-punches-title"
        className="bg-surface-container-lowest rounded-shape-lg shadow-lg max-w-lg w-full mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="incomplete-punches-title" className="text-title-md font-medium text-on-surface mb-1">
          {items.length} {items.length === 1 ? 'marcación incompleta' : 'marcaciones incompletas'}
        </h3>
        <p className="text-body-sm text-on-surface-variant mb-4">
          Estos días cuentan como trabajados y no suman horas extra. Para que un día sume horas extra, complete la hora que falta.
        </p>
        <ul className="max-h-64 overflow-auto border border-outline-variant rounded-shape-md divide-y divide-outline-variant mb-4">
          {items.map(i => (
            <li key={i.sessionId} className="flex justify-between gap-3 px-3 py-1.5 text-body-sm">
              <span className="text-on-surface truncate">{i.employeeName}</span>
              <span className="text-on-surface-variant whitespace-nowrap">{i.date} · {i.detail}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-3 justify-end">
          <button ref={backRef} onClick={onCancel} className="m3-btn-outlined">Volver a completar</button>
          <button onClick={onContinue} className="m3-btn-filled">Continuar de todas formas</button>
        </div>
      </div>
    </div>
  );
}
