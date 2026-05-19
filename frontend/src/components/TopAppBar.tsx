import { useStore } from '../store';
import { APP_BAR } from '../constants/colors';

export default function TopAppBar() {
  const appState      = useStore(s => s.appState);
  const rows          = useStore(s => s.rows);
  const fileName      = useStore(s => s.fileName);
  const reset         = useStore(s => s.reset);
  const searchText    = useStore(s => s.searchText);
  const setSearchText = useStore(s => s.setSearchText);

  const hasData    = rows.length > 0;
  const showLoaded = appState === 'loaded';

  return (
    <header
      className="fixed left-0 right-0 flex items-center justify-between px-5 bg-primary"
      style={{ top: 0, height: 64, zIndex: 30, boxShadow: `0 2px 8px ${APP_BAR.shadow}` }}
    >
      {/* Leading: app identity */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-shape-md bg-white/20 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </div>
        <div>
          <p className="text-title-md text-white font-medium leading-tight">Cargador de Planilla</p>
          {showLoaded && (
            <p className="text-body-sm leading-tight" style={{ color: APP_BAR.subtitleText }}>
              {fileName ? `${fileName} — ` : ''}{rows.length} empleado{rows.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Center: search */}
      {showLoaded && (
        <div className="flex-1 mx-6 max-w-sm relative">
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Buscar por código o nombre..."
            aria-label="Buscar empleado"
            className="w-full h-9 px-3 rounded-shape-full text-body-md border border-white/30
                       focus:outline-none focus:bg-white/25 transition-colors duration-150"
            style={{ background: APP_BAR.inputBg, color: 'white', paddingRight: searchText ? '2rem' : undefined }}
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition-colors duration-150 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Trailing: new upload action */}
      {hasData && (
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-shape-full text-label-lg font-medium
                     bg-white/15 text-white border border-white/30
                     hover:bg-white/25 transition-colors duration-150 cursor-pointer shrink-0"
          title="Cargar nuevo archivo"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Nueva carga
        </button>
      )}
    </header>
  );
}
