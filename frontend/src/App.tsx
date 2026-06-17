import { useState, useEffect } from 'react';
import axios from 'axios';
import { checkHealth } from './api';
import { uploadTasFile } from './tasApi';
import { useTasStore } from './tasStore';
import EmptyState from './components/EmptyState';
import TopAppBar from './components/TopAppBar';
import ConfigPage from './components/ConfigPage';
import ErrorBoundary from './components/ErrorBoundary';
import Spinner from './components/ui/Spinner';
import TasUploadFlow from './components/tas/TasUploadFlow';

const MAX_ATTEMPTS    = 40;
const RETRY_INTERVAL  = 500;

import type { AppView } from './types';

type BackendState = 'starting' | 'ready' | 'error';

export default function App() {
  const [backendState, setBackendState] = useState<BackendState>('starting');
  const [retryKey, setRetryKey] = useState(0);
  const [currentView, setCurrentView] = useState<AppView>('tas');
  const [tasFileName, setTasFileName] = useState('');

  const setTasView         = useTasStore(s => s.setTasView);
  const setUploadToken     = useTasStore(s => s.setUploadToken);
  const setFlaggedSessions    = useTasStore(s => s.setFlaggedSessions);
  const setResolvedRowCount   = useTasStore(s => s.setResolvedRowCount);
  const setResolvedRows       = useTasStore(s => s.setResolvedRows);
  const setInactiveEmployees  = useTasStore(s => s.setInactiveEmployees);
  const setAbsentEmployees = useTasStore(s => s.setAbsentEmployees);
  const setWarnings          = useTasStore(s => s.setWarnings);
  const setUsedFallbackHolidays = useTasStore(s => s.setUsedFallbackHolidays);
  const setAvailablePeriods = useTasStore(s => s.setAvailablePeriods);
  const setProcessingMessage = useTasStore(s => s.setProcessingMessage);
  const setError           = useTasStore(s => s.setError);
  const resetTas           = useTasStore(s => s.resetTas);
  const tasView            = useTasStore(s => s.tasView);

  const handleTasFile = async (file: File) => {
    setTasFileName(file.name);
    resetTas();
    setCurrentView('tas');
    setTasView('processing');
    setProcessingMessage('Analizando marcaciones...');
    try {
      const result = await uploadTasFile(file);
      setUploadToken(result.uploadToken);
      setFlaggedSessions(result.flaggedSessions);
      setResolvedRowCount(result.resolvedRows?.length ?? 0);
      setResolvedRows(result.resolvedRows ?? []);
      setInactiveEmployees(result.inactiveEmployeesFound);
      setAbsentEmployees(result.absentActiveEmployees);
      setWarnings(result.warnings ?? []);
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      setAvailablePeriods(result.availablePeriods ?? []);
      if (result.inactiveEmployeesFound.length > 0) {
        setTasView('inactiveReview');
      } else {
        const hasNeedsResolution = result.flaggedSessions.some(s => s.needsResolution);
        const hasMultiplePeriods = (result.availablePeriods?.length ?? 0) > 1;
        setTasView(hasNeedsResolution || hasMultiplePeriods ? 'verification' : 'review');
      }
    } catch (err: unknown) {
      setTasView('processing');
      const backendMessage =
        axios.isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : null;
      setError(backendMessage ?? 'Ocurrió un error al procesar el archivo. Intente nuevamente.');
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
      <TopAppBar
        currentView={currentView}
        onViewChange={setCurrentView}
        tasView={tasView}
        onNewUpload={() => {
          resetTas();
          setCurrentView('tas');
        }}
      />

      {currentView === 'config' && <ConfigPage />}

      {currentView === 'tas' && tasView === 'idle' && <EmptyState onTasFile={handleTasFile} />}

      {currentView === 'tas' && tasView !== 'idle' && <TasUploadFlow fileName={tasFileName} />}
    </ErrorBoundary>
  );
}
