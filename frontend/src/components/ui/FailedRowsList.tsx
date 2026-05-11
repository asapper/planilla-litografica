interface FailedRow {
  id: string;
  name: string;
  error?: string | null;
}

interface Props {
  rows: FailedRow[];
  scrollable?: boolean;
}

export default function FailedRowsList({ rows, scrollable = false }: Props) {
  if (rows.length === 0) return null;
  return (
    <div className={`m3-card-filled text-left mb-6${scrollable ? ' max-h-64 overflow-y-auto' : ''}`}>
      <p className="text-label-lg text-on-surface-variant mb-3">Registros con error</p>
      <div className="divide-y divide-outline-variant">
        {rows.map(r => (
          <div key={r.id} className="flex justify-between items-center py-2">
            <span className="text-body-md text-on-surface">{r.name}</span>
            <span className="text-body-sm text-error ml-4 text-right">{r.error ?? 'Error desconocido'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
