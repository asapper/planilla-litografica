import { useState, useEffect } from 'react';
import { useStore } from './store';
import { checkHealth } from './api';
import EmptyState from './components/EmptyState';
import TopAppBar from './components/TopAppBar';
import QuincenaBanner from './components/QuincenaBanner';
import DataGrid from './components/DataGrid';
import ActionBar from './components/ActionBar';
import ResultScreen from './components/ResultScreen';
import PollingScreen from './components/PollingScreen';
import ErrorBoundary from './components/ErrorBoundary';

const APP_BAR    = 64;
const ACTION_BAR = 64;

const MAX_ATTEMPTS    = 40;
const RETRY_INTERVAL  = 500;

type BackendState = 'starting' | 'ready' | 'error';

export default function App() {
  const appState = useStore(s => s.appState);
  const [backendState, setBackendState] = useState<BackendState>('starting');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let attempts  = 0;

    const poll = async () => {
      if (cancelled) return;
      try {
        await checkHealth();
        if (!cancelled) setBackendState('ready');
      } catch {
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          if (!cancelled) setBackendState('error');
        } else {
          setTimeout(poll, RETRY_INTERVAL);
        }
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [retryKey]);

  const retry = () => {
    setBackendState('starting');
    setRetryKey(k => k + 1);
  };

  // ── Startup splash ──────────────────────────────────────────────────
  if (backendState === 'starting') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-white">
        <svg className="animate-spin w-10 h-10 text-primary" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <p className="text-title-md text-primary">Iniciando aplicación...</p>
      </div>
    );
  }

  // ── Backend unreachable error ────────────────────────────────────────
  if (backendState === 'error') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-white">
        <p className="text-body-lg text-error">No se pudo conectar con el servicio.</p>
        <button
          className="px-6 py-2 bg-primary text-white rounded"
          onClick={retry}
        >
          Reintentar
        </button>
      </div>
    );
  }

  // ── Normal app ───────────────────────────────────────────────────────
  return (
    <ErrorBoundary>
      <TopAppBar />

      {appState === 'empty' && <EmptyState />}

      {(appState === 'loaded' || appState === 'submitting') && (
        <>
          <main
            className="px-6"
            style={{
              paddingTop:    APP_BAR + 20,
              paddingBottom: ACTION_BAR + 16,
            }}
          >
            <QuincenaBanner />
            <DataGrid />
          </main>
          <ActionBar />

          {appState === 'submitting' && (
            <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-white/80">
              <svg className="animate-spin w-10 h-10 text-primary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-title-md text-primary">Enviando...</p>
            </div>
          )}
        </>
      )}

      {appState === 'polling' && <PollingScreen />}

      {appState === 'result' && <ResultScreen />}
    </ErrorBoundary>
  );
}
