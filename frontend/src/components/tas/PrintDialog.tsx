import { useEffect, useRef, useState } from 'react';
import { estimatePages, type PrintMode } from './reviewReport';

interface PrintDialogProps {
  employeeCount: number;
  onPrint: (mode: PrintMode) => void;
  onCancel: () => void;
}

const pagesText = (n: number) => `aprox. ${n} ${n === 1 ? 'página' : 'páginas'}`;

const OPTIONS: { mode: PrintMode; title: string; body: string }[] = [
  {
    mode: 'summary',
    title: 'Resumen',
    body: 'Una línea por empleado con lo que se va a enviar: días no laborados, extras simples y dobles, y totales.',
  },
  {
    mode: 'detail',
    title: 'Resumen y detalle por empleado',
    body: 'Agrega, por empleado, cada día con su turno, marcaciones, horas y extras, y las fechas que no laboró, para cuadrar los totales a mano.',
  },
];

export default function PrintDialog({ employeeCount, onPrint, onCancel }: PrintDialogProps) {
  const [mode, setMode] = useState<PrintMode>('summary');
  const printRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { printRef.current?.focus(); }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-dialog-title"
        className="bg-surface-container-lowest rounded-shape-lg shadow-lg max-w-md w-full mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="print-dialog-title" className="text-title-md font-medium text-on-surface mb-1">Imprimir reporte</h3>
        <p className="text-body-sm text-on-surface-variant mb-4">
          Incluye {employeeCount} {employeeCount === 1 ? 'empleado' : 'empleados'} a enviar, con los ajustes manuales aplicados, ordenados por código.
        </p>
        <fieldset className="space-y-2 mb-6">
          <legend className="sr-only">Contenido</legend>
          {OPTIONS.map(o => (
            <label
              key={o.mode}
              className={`flex gap-3 items-start border rounded-shape-md p-3 cursor-pointer transition-colors ${
                mode === o.mode ? 'border-primary bg-primary-container/30' : 'border-outline-variant hover:bg-surface-container-low'
              }`}
            >
              <input
                type="radio"
                name="print-mode"
                value={o.mode}
                checked={mode === o.mode}
                onChange={() => setMode(o.mode)}
                className="mt-1 accent-[var(--md-sys-color-primary)]"
              />
              <span>
                <span className="block text-body-md font-medium text-on-surface">
                  {o.title}
                  <span className="ml-2 text-label-sm font-normal text-on-surface-variant">{pagesText(estimatePages(o.mode, employeeCount))}</span>
                </span>
                <span className="block text-body-sm text-on-surface-variant">{o.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="m3-btn-outlined">Cancelar</button>
          <button ref={printRef} onClick={() => onPrint(mode)} className="m3-btn-filled">Imprimir</button>
        </div>
      </div>
    </div>
  );
}
