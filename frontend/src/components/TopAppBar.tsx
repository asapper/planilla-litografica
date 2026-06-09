import { useStore } from '../store';
import { APP_BAR } from '../constants/colors';
import type { AppView } from '../types';

interface Props {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
}

export default function TopAppBar({ currentView, onViewChange }: Props) {
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

      {/* Center: search (only in loaded planilla view) */}
      <div className="flex-1 mx-6">
        {showLoaded && currentView === 'planilla' && (
          <div className="max-w-sm relative">
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
      </div>

      {/* Trailing: Configuración + optional new-upload action */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onViewChange('config')}
          aria-current={currentView === 'config' ? 'page' : undefined}
          className={`inline-flex items-center gap-1.5 px-4 h-8 rounded-shape-full text-label-lg font-medium transition-colors duration-150 cursor-pointer ${
            currentView === 'config'
              ? 'bg-white text-primary'
              : 'text-white/80 hover:bg-white/15'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Configuración
        </button>

        {hasData && currentView === 'planilla' && (
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
        )}
      </div>
    </header>
  );
}
