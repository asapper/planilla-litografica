import { useState, useEffect } from 'react';
import axios from 'axios';
import { checkHealth } from './api';
import { uploadTasFile } from './tasApi';
import { useTasStore } from './tasStore';
import { useToastStore } from './toastStore';
import EmptyState from './components/EmptyState';
import TopAppBar from './components/TopAppBar';
import ConfigPage from './components/ConfigPage';
import ErrorBoundary from './components/ErrorBoundary';
import Spinner from './components/ui/Spinner';
import TasUploadFlow from './components/tas/TasUploadFlow';
import ToastContainer from './components/ui/ToastContainer';
import type { AppView } from './types';

const MAX_ATTEMPTS    = 40;
const RETRY_INTERVAL  = 500;

const UPLOAD_STAGE_MESSAGES = [
  'Leyendo el archivo...',
  'Verificando empleados...',
  'Consultando el calendario de feriados...',
  'Calculando sesiones...',
  'Generando reporte...',
  'Casi listo...',
];
const STAGE_INTERVAL_MS = 5_000;

type BackendState = 'starting' | 'ready' | 'error';

export default function App() {
  const [backendState, setBackendState] = useState<BackendState>('starting');
  const [retryKey, setRetryKey] = useState(0);
  const [startAttempts, setStartAttempts] = useState(0);
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
  const setSessionSummaries = useTasStore(s => s.setSessionSummaries);
  const resetTas           = useTasStore(s => s.resetTas);
  const showToast          = useToastStore(s => s.showToast);
  const tasView            = useTasStore(s => s.tasView);

  const handleTasFile = async (file: File) => {
    setTasFileName(file.name);
    resetTas();
    setCurrentView('tas');
    setTasView('processing');
    setProcessingMessage(UPLOAD_STAGE_MESSAGES[0]);
    let stageIndex = 0;
    const stageTimer = setInterval(() => {
      stageIndex++;
      if (stageIndex < UPLOAD_STAGE_MESSAGES.length) {
        setProcessingMessage(UPLOAD_STAGE_MESSAGES[stageIndex]);
      } else {
        clearInterval(stageTimer);
      }
    }, STAGE_INTERVAL_MS);
    try {
      const result = await uploadTasFile(file);
      clearInterval(stageTimer);
      setUploadToken(result.uploadToken);
      setFlaggedSessions(result.flaggedSessions);
      setResolvedRowCount(result.resolvedRows?.length ?? 0);
      setResolvedRows(result.resolvedRows ?? []);
      setSessionSummaries(result.sessionSummaries ?? {});
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
      clearInterval(stageTimer);
      const backendMessage =
        axios.isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : null;
      const message = backendMessage ?? 'Ocurrió un error al procesar el archivo. Intente nuevamente.';
      setError(message);
      showToast(message, 'error');
      setTasView('idle');
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
        setStartAttempts(attempts);
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
    setStartAttempts(0);
    setRetryKey(k => k + 1);
  };

  // ── Startup splash ──────────────────────────────────────────────────
  if (backendState === 'starting') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-surface-container-lowest">
        <Spinner size="w-10 h-10" />
        <p className="text-title-md text-primary">Iniciando aplicación...</p>
        {startAttempts >= 4 && (
          <p className="text-body-sm text-on-surface-variant">
            Esto puede tomar hasta 20 segundos la primera vez.
          </p>
        )}
      </div>
    );
  }

  // ── Backend unreachable error ────────────────────────────────────────
  if (backendState === 'error') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-surface-container-lowest">
        <p className="text-body-lg text-error">No se pudo conectar con el servicio.</p>
        <button
          className="m3-btn-filled"
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

      <ToastContainer />
    </ErrorBoundary>
  );
}
