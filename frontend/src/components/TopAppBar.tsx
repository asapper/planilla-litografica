import { useState } from 'react';
import { APP_BAR } from '../constants/colors';
import type { AppView } from '../types';
import type { TasView } from '../tasTypes';
import ConfirmModal from './ui/ConfirmModal';

interface Props {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
  tasView: TasView;
  onNewUpload: () => void;
}

export default function TopAppBar({ currentView, onViewChange, tasView, onNewUpload }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);

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
        </div>
      </div>

      {/* Center: spacer */}
      <div className="flex-1 mx-6" />

      {/* Trailing: session actions + Configuración */}
      <div className="flex items-center gap-2 shrink-0">
        {tasView !== 'idle' && (
          <button
            onClick={() => setShowConfirm(true)}
            className="inline-flex items-center gap-1.5 px-4 h-8 rounded-shape-full text-label-lg font-medium text-white/80 border border-white/50 hover:bg-white/15 transition-colors duration-150 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Nueva carga
          </button>
        )}
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
      </div>

      {showConfirm && (
        <ConfirmModal
          title="Iniciar nueva carga"
          message="Esta acción descartará la sesión actual, incluyendo los cambios sin guardar. ¿Deseas continuar?"
          confirmLabel="Sí, descartar"
          cancelLabel="Cancelar"
          onConfirm={() => {
            setShowConfirm(false);
            onNewUpload();
          }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </header>
  );
}
