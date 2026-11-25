import { useEffect, useRef } from 'react';
import { formatHours } from './reviewReport';

export interface PendingOvertimeItem {
  code: string;
  name: string;
  calcSimples: number;
  calcDobles: number;
  // Approved before the calculation changed (sent as zero), or adjusted before it changed (sent as typed).
  changed: boolean;
  sendsTyped: boolean;
}

interface PendingOvertimeDialogProps {
  items: PendingOvertimeItem[];
  onSubmit: () => void;
  onCancel: () => void;
}

const hours = (i: PendingOvertimeItem) => `${formatHours(i.calcSimples)} simples · ${formatHours(i.calcDobles)} dobles`;

function Group({ title, items }: { title: string; items: PendingOvertimeItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-4">
      <h4 className="text-label-lg font-medium text-on-surface mb-1">{title}</h4>
      <ul className="max-h-48 overflow-auto border border-outline-variant rounded-shape-md divide-y divide-outline-variant">
        {items.map(i => (
          <li key={i.code} className="flex justify-between gap-3 px-3 py-1.5 text-body-sm">
            <span className="text-on-surface truncate">{i.code} {i.name}{i.changed && <span className="text-on-surface-variant"> · el cálculo cambió</span>}</span>
            <span className="text-on-surface-variant whitespace-nowrap">calc. {hours(i)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function PendingOvertimeDialog({ items, onSubmit, onCancel }: PendingOvertimeDialogProps) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);

  const zeroed = items.filter(i => !i.sendsTyped);
  const typed = items.filter(i => i.sendsTyped);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-overtime-title"
        className="bg-surface-container-lowest rounded-shape-lg shadow-lg max-w-lg w-full mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="pending-overtime-title" className="text-title-md font-medium text-on-surface mb-1">Horas extra sin revisar</h3>
        <p className="text-body-sm text-on-surface-variant mb-4">
          Para rechazar horas extra, escriba 0 en el empleado; así este aviso solo muestra lo que nadie revisó.
        </p>
        <Group
          title={`${zeroed.length} ${zeroed.length === 1 ? 'empleado se enviará' : 'empleados se enviarán'} con 0 horas extra`}
          items={zeroed}
        />
        <Group
          title={`${typed.length} ${typed.length === 1 ? 'ajuste se enviará' : 'ajustes se enviarán'} como se escribió, aunque el cálculo cambió`}
          items={typed}
        />
        <div className="flex gap-3 justify-end">
          <button ref={backRef} onClick={onCancel} className="m3-btn-outlined">Volver a revisar</button>
          <button onClick={onSubmit} className="m3-btn-filled">Enviar de todas formas</button>
        </div>
      </div>
    </div>
  );
}
