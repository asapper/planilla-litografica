import { useStore } from '../store';

export default function TopAppBar() {
  const rows  = useStore(s => s.rows);
  const reset = useStore(s => s.reset);

  return (
    <header
      className="fixed left-0 right-0 flex items-center justify-between px-5 bg-primary"
      style={{ top: 0, height: 64, zIndex: 30, boxShadow: '0 2px 8px rgba(24,85,163,0.25)' }}
    >
      {/* Leading: app identity */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-shape-md bg-white/20 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </div>
        <div>
          <p className="text-title-md text-white font-medium leading-tight">Cargador de Planilla</p>
          <p className="text-body-sm leading-tight" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {rows.length} empleado{rows.length !== 1 ? 's' : ''} cargados
          </p>
        </div>
      </div>

      {/* Trailing: new upload action */}
      <button
        onClick={reset}
        className="inline-flex items-center gap-1.5 px-4 h-9 rounded-shape-full text-label-lg font-medium
                   bg-white/15 text-white border border-white/30
                   hover:bg-white/25 transition-colors duration-150 cursor-pointer"
        title="Cargar nuevo archivo"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Nueva carga
      </button>
    </header>
  );
}
