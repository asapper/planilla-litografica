import { useState, useEffect } from 'react';
import { useStore } from './store';
import { checkHealth } from './api';
import { uploadTasFile, submitTas } from './tasApi';
import { useTasStore } from './tasStore';
import EmptyState from './components/EmptyState';
import TopAppBar from './components/TopAppBar';
import QuincenaBanner from './components/QuincenaBanner';
import DataGrid from './components/DataGrid';
import ActionBar from './components/ActionBar';
import ResultScreen from './components/ResultScreen';
import PollingScreen from './components/PollingScreen';
import ConfigPage from './components/ConfigPage';
import ErrorBoundary from './components/ErrorBoundary';
import Spinner from './components/ui/Spinner';
import TasUploadFlow from './components/tas/TasUploadFlow';

const APP_BAR    = 64;
const ACTION_BAR = 64;

const MAX_ATTEMPTS    = 40;
const RETRY_INTERVAL  = 500;

import type { AppView } from './types';

type BackendState = 'starting' | 'ready' | 'error';

function isTasFile(file: File): Promise<boolean> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target?.result as string) ?? '';
      const firstLines = text.split('\n').slice(0, 3).join('\n');
      resolve(firstLines.includes('Autenticación'));
    };
    reader.onerror = () => resolve(false);
    reader.readAsText(file.slice(0, 2048));
  });
}

export default function App() {
  const appState = useStore(s => s.appState);
  const [backendState, setBackendState] = useState<BackendState>('starting');
  const [retryKey, setRetryKey] = useState(0);
  const [currentView, setCurrentView] = useState<AppView>('planilla');
  const [tasFileName, setTasFileName] = useState('');

  const setTasView         = useTasStore(s => s.setTasView);
  const setUploadToken     = useTasStore(s => s.setUploadToken);
  const setFlaggedSessions = useTasStore(s => s.setFlaggedSessions);
  const setInactiveEmployees = useTasStore(s => s.setInactiveEmployees);
  const setAbsentEmployees = useTasStore(s => s.setAbsentEmployees);
  const setUsedFallbackHolidays = useTasStore(s => s.setUsedFallbackHolidays);
  const setProcessingMessage = useTasStore(s => s.setProcessingMessage);
  const setJobId           = useTasStore(s => s.setJobId);
  const setError           = useTasStore(s => s.setError);
  const resetTas           = useTasStore(s => s.resetTas);

  const handleTasFile = async (file: File) => {
    const isTas = await isTasFile(file);
    if (!isTas) return false;
    setTasFileName(file.name);
    resetTas();
    setCurrentView('tas');
    setTasView('processing');
    setProcessingMessage('Analizando marcaciones...');
    try {
      const result = await uploadTasFile(file);
      setUploadToken(result.uploadToken);
      setFlaggedSessions(result.flaggedSessions);
      setInactiveEmployees(result.inactiveEmployeesFound);
      setAbsentEmployees(result.absentActiveEmployees);
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      if (result.inactiveEmployeesFound.length > 0) {
        setTasView('inactiveReview');
      } else {
        const hasNeedsResolution = result.flaggedSessions.some(s => s.needsResolution);
        if (hasNeedsResolution) {
          setTasView('verification');
        } else {
          setTasView('submitting');
          const { jobId } = await submitTas(result.uploadToken);
          setJobId(jobId);
          setTasView('result');
        }
      }
    } catch {
      setTasView('processing');
      setError('Ocurrió un error al procesar el archivo. Intente nuevamente.');
    }
    return true;
  };

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
        <Spinner size="w-10 h-10" />
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
      <TopAppBar currentView={currentView} onViewChange={setCurrentView} />

      {currentView === 'config' && <ConfigPage />}

      {currentView === 'planilla' && appState === 'empty' && <EmptyState />}

      {currentView === 'planilla' && (appState === 'loaded' || appState === 'submitting') && (
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
              <Spinner size="w-10 h-10" />
              <p className="text-title-md text-primary">Enviando...</p>
            </div>
          )}
        </>
      )}

      {currentView === 'planilla' && appState === 'polling' && <PollingScreen />}

      {currentView === 'planilla' && appState === 'result' && <ResultScreen />}

      {currentView === 'tas' && <TasUploadFlow fileName={tasFileName} />}
    </ErrorBoundary>
  );
}
