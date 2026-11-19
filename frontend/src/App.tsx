import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { checkHealth, checkDbHealth } from './api';
import { getBackendStatus, asStartFailure, type BackendStartFailure } from './backendStatus';
import AlertMessage from './components/ui/AlertMessage';
import { uploadTasFile, getDraftSummary, resumeDraft, deleteDraft } from './tasApi';
import {
  applySnapshot, canResume, discardDraftSession, formatPeriodLabel, isDraftView, localSnapshotOf, startDraftAutosave,
  DRAFT_UI_VERSION,
} from './tasDraft';
import { clearLocalCopy, dayKeysOf, fileBytes, recoverableLocalCopy, startLocalCopy, type LocalCopy } from './localCopy';
import { rebuildFromLocalCopy } from './localRecovery';
import { onAppCloseRequested, prepareToClose } from './appClose';
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
import type { DraftSummary, TasPeriod } from './tasTypes';

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
const DRAFT_JOB_POLL_MS = 3_000;

export const LOCAL_RECOVERY_MESSAGE = 'Recuperando la sesión guardada en este equipo...';
export const LOCAL_RECOVERED_MESSAGE = 'Se recuperó la sesión guardada en este equipo.';
export const LOCAL_RECOVERED_REVIEW_MESSAGE =
  'Se recuperó la sesión guardada en este equipo. Presione "Revisar" para ver los totales.';
export const LOCAL_RECOVERY_FAILED_MESSAGE = 'No se pudo recuperar la sesión guardada en este equipo.';

// The local copy shown on the start screen like a saved session.
function localCopySummary(copy: LocalCopy): DraftSummary {
  const view = copy.snapshot?.tasView;
  return {
    fileName: copy.fileName,
    view: isDraftView(view) ? view : 'verification',
    periodLabel: formatPeriodLabel((copy.snapshot?.selectedPeriod as TasPeriod | undefined) ?? null),
    savedAt: copy.savedAt,
    partialSubmit: false,
    resumable: true,
    uiVersion: DRAFT_UI_VERSION,
    jobActive: false,
  };
}

// ReviewScreen runs its own faster /db-health poll and shows a contextual banner,
// so the global banner is suppressed on these views to avoid a conflicting signal.
const REVIEW_TAS_VIEWS = new Set(['review', 'submitting', 'polling']);

type BackendState = 'starting' | 'ready' | 'error';

export default function App() {
  const [backendState, setBackendState] = useState<BackendState>('starting');
  const [retryKey, setRetryKey] = useState(0);
  const [startAttempts, setStartAttempts] = useState(0);
  const [startFailure, setStartFailure] = useState<BackendStartFailure | null>(null);
  const [dbHealthy, setDbHealthy] = useState<boolean | null>(null);
  const [currentView, setCurrentView] = useState<AppView>('tas');
  const [tasFileName, setTasFileName] = useState('');
  const [draftSummary, setDraftSummary] = useState<DraftSummary | null>(null);
  // Offered when the backend has no session it can resume.
  const [localCopy, setLocalCopy] = useState<LocalCopy | null>(null);
  const fileNameRef = useRef('');

  const setTasView         = useTasStore(s => s.setTasView);
  const setUploadToken     = useTasStore(s => s.setUploadToken);
  const setStateRevision   = useTasStore(s => s.setStateRevision);
  const setFlaggedSessions    = useTasStore(s => s.setFlaggedSessions);
  const setResolvedRowCount   = useTasStore(s => s.setResolvedRowCount);
  const setResolvedRows       = useTasStore(s => s.setResolvedRows);
  const setInactiveEmployees  = useTasStore(s => s.setInactiveEmployees);
  const setAbsentEmployees = useTasStore(s => s.setAbsentEmployees);
  const setWarnings          = useTasStore(s => s.setWarnings);
  const setUsedFallbackHolidays = useTasStore(s => s.setUsedFallbackHolidays);
  const setAvailablePeriods = useTasStore(s => s.setAvailablePeriods);
  const setAvailableShifts = useTasStore(s => s.setAvailableShifts);
  const setProcessingMessage = useTasStore(s => s.setProcessingMessage);
  const setError           = useTasStore(s => s.setError);
  const setSessionSummaries = useTasStore(s => s.setSessionSummaries);
  const resetTas           = useTasStore(s => s.resetTas);
  const showToast          = useToastStore(s => s.showToast);
  const tasView            = useTasStore(s => s.tasView);

  const handleTasFile = async (file: File) => {
    setTasFileName(file.name);
    // A new upload replaces the session: its copy on this PC starts empty, never paired with old decisions.
    clearLocalCopy();
    setLocalCopy(null);
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
      // Read alongside the upload, so the copy on this PC never delays it.
      const bytesRead = fileBytes(file).catch(() => null);
      const result = await uploadTasFile(file);
      clearInterval(stageTimer);
      setUploadToken(result.uploadToken);
      setStateRevision(result.stateRevision);
      setFlaggedSessions(result.flaggedSessions);
      setResolvedRowCount(result.resolvedRows?.length ?? 0);
      setResolvedRows(result.resolvedRows ?? []);
      setSessionSummaries(result.sessionSummaries ?? {});
      setInactiveEmployees(result.inactiveEmployeesFound);
      setAbsentEmployees(result.absentActiveEmployees);
      setWarnings(result.warnings ?? []);
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      setAvailablePeriods(result.availablePeriods ?? []);
      setAvailableShifts(result.availableShifts ?? []);
      if (result.inactiveEmployeesFound.length > 0) {
        setTasView('inactiveReview');
      } else {
        const hasNeedsResolution = result.flaggedSessions.some(s => s.needsResolution);
        const hasMultiplePeriods = (result.availablePeriods?.length ?? 0) > 1;
        setTasView(hasNeedsResolution || hasMultiplePeriods ? 'verification' : 'review');
      }
      void bytesRead.then(bytes => {
        const state = useTasStore.getState();
        if (bytes && state.uploadToken === result.uploadToken) {
          // The upload's own days are valid only if no inactive-employee step renumbers them.
          const uploadedDays = result.inactiveEmployeesFound.length === 0
            ? dayKeysOf({ tasView: 'verification', flaggedSessions: result.flaggedSessions })
            : {};
          startLocalCopy(file.name, bytes, localSnapshotOf(state), uploadedDays);
        }
      });
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
    fileNameRef.current = tasFileName;
  }, [tasFileName]);

  useEffect(() => startDraftAutosave(() => fileNameRef.current), []);

  useEffect(() => onAppCloseRequested(prepareToClose), []);

  useEffect(() => {
    if (backendState !== 'ready' || tasView !== 'idle') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const summary = await getDraftSummary();
        if (cancelled) return;
        setDraftSummary(summary);
        setLocalCopy(summary && canResume(summary) ? null : recoverableLocalCopy());
        if (summary?.jobActive) timer = setTimeout(load, DRAFT_JOB_POLL_MS);
      } catch (err) {
        if (cancelled) return;
        console.warn('No se pudo consultar la sesión guardada.', err);
        setDraftSummary(null);
        setLocalCopy(recoverableLocalCopy());
      }
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setDraftSummary(null);
    };
  }, [backendState, tasView]);

  // The backend's saved session is missing or unreadable: rebuild it from the copy on this PC.
  const handleContinueLocal = async (copy: LocalCopy) => {
    setTasFileName(copy.fileName);
    setCurrentView('tas');
    setProcessingMessage(LOCAL_RECOVERY_MESSAGE);
    setTasView('processing');
    try {
      const recovery = await rebuildFromLocalCopy(copy);
      setLocalCopy(null);
      showToast(recovery.wasInReview ? LOCAL_RECOVERED_REVIEW_MESSAGE : LOCAL_RECOVERED_MESSAGE, 'success');
      if (recovery.dropped > 0) {
        showToast(`${recovery.dropped} ${recovery.dropped === 1 ? 'decisión no se pudo recuperar' : 'decisiones no se pudieron recuperar'} porque esos días cambiaron. Revíselos.`, 'warning');
      }
    } catch (err) {
      console.warn('No se pudo reconstruir la sesión desde la copia local.', err);
      showToast(LOCAL_RECOVERY_FAILED_MESSAGE, 'error');
      setTasView('idle');
    }
  };

  const handleContinueDraft = async () => {
    const fileName = draftSummary?.fileName ?? '';
    const fallback = recoverableLocalCopy();
    try {
      const { uploadToken, ui } = await resumeDraft();
      if (ui.uiVersion !== DRAFT_UI_VERSION) {
        if (fallback) return handleContinueLocal(fallback);
        setDraftSummary(prev => (prev ? { ...prev, resumable: false } : prev));
        return;
      }
      if (!isDraftView(ui.tasView)) throw new Error('Vista de borrador inválida.');
      setTasFileName(fileName);
      applySnapshot({ ...ui, uploadToken });
      setCurrentView('tas');
    } catch (err) {
      const outdated = axios.isAxiosError(err) && err.response?.data?.code === 'DRAFT_OUTDATED';
      // Only a session the backend no longer has, or cannot read, is rebuilt; a passing error must not
      // replace a good saved session with a rebuild.
      const gone = axios.isAxiosError(err) && err.response?.status === 404;
      if (fallback && (outdated || gone)) return handleContinueLocal(fallback);
      if (outdated) {
        setDraftSummary(prev => (prev ? { ...prev, resumable: false } : prev));
        return;
      }
      showToast('No se pudo recuperar la sesión anterior.', 'error');
      setDraftSummary(null);
    }
  };

  const handleDiscardDraft = async () => {
    setDraftSummary(null);
    setLocalCopy(null);
    clearLocalCopy();
    try {
      await deleteDraft();
    } catch (err) {
      console.warn('No se pudo descartar la sesión guardada.', err);
    }
  };

  useEffect(() => {
    if (backendState !== 'ready') return;
    const id = setInterval(async () => {
      const healthy = await checkDbHealth();
      setDbHealthy(healthy);
    }, 30_000);
    return () => clearInterval(id);
  }, [backendState]);

  useEffect(() => {
    let cancelled = false;
    let attempts  = 0;

    const poll = async () => {
      if (cancelled) return;
      try {
        await checkHealth();
        if (!cancelled) {
          setBackendState('ready');
          const isDbHealthy = await checkDbHealth();
          if (!cancelled) setDbHealthy(isDbHealthy);
        }
      } catch {
        attempts++;
        setStartAttempts(attempts);
        const failure = asStartFailure(await getBackendStatus());
        if (cancelled) return;
        if (failure) {
          setStartFailure(failure);
          setBackendState('error');
        } else if (attempts >= MAX_ATTEMPTS) {
          setBackendState('error');
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
    setStartFailure(null);
    setDbHealthy(null);
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
  if (backendState === 'error' && startFailure) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center bg-surface-container-lowest">
        <p className="text-body-lg text-error">
          {startFailure.state === 'port_blocked'
            ? `No se pudo iniciar el servicio: es posible que otro programa esté usando el puerto ${startFailure.port}.`
            : `El servicio se detuvo inesperadamente al iniciar${startFailure.exitCode !== null ? ` (código ${startFailure.exitCode})` : ''}.`}
        </p>
        <p className="text-body-md text-on-surface-variant">
          {startFailure.state === 'port_blocked'
            ? 'Cierre ese programa o reinicie el equipo, y luego vuelva a abrir la aplicación.'
            : 'Cierre y vuelva a abrir la aplicación. Si el problema continúa, envíe a soporte los archivos de la carpeta .planilla\\logs de su usuario.'}
        </p>
      </div>
    );
  }

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
        onDiscardSession={async () => {
          setCurrentView('tas');
          await discardDraftSession();
        }}
      />

      {dbHealthy === false && !REVIEW_TAS_VIEWS.has(tasView) && (
        <div className="px-4 pt-2">
          <AlertMessage
            message="Base de datos no disponible. No se podrán enviar registros hasta que la conexión sea restaurada."
            variant="error"
          />
        </div>
      )}

      {currentView === 'config' && <ConfigPage />}

      {currentView === 'tas' && tasView === 'idle' && (
        <EmptyState
          onTasFile={handleTasFile}
          draft={localCopy ? localCopySummary(localCopy) : draftSummary}
          onContinueDraft={localCopy ? () => handleContinueLocal(localCopy) : handleContinueDraft}
          onDiscardDraft={handleDiscardDraft}
        />
      )}

      {currentView === 'tas' && tasView !== 'idle' && <TasUploadFlow fileName={tasFileName} />}

      <ToastContainer />
    </ErrorBoundary>
  );
}
