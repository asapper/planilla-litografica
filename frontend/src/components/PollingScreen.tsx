import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { getJob, retryJob } from '../api';
import type { JobResponse, SubmitResponse } from '../types';

const POLL_INTERVAL_MS = 2_500;
const MAX_CONSECUTIVE_FAILURES = 5;

function toSubmitResponse(job: JobResponse): SubmitResponse {
  return {
    totalSubmitted: job.submitted,
    totalSkippedDuplicates: job.skipped,
    totalFailed: job.failed,
    rows: job.rows.map(r => ({
      codigoEmpleado: r.codigoEmpleado,
      submitted: r.status === 'SUBMITTED',
      skippedDuplicate: r.status === 'SKIPPED',
      error: r.error,
    })),
  };
}

export default function PollingScreen() {
  const jobId             = useStore(s => s.jobId);
  const jobResponse       = useStore(s => s.jobResponse);
  const updateJobResponse = useStore(s => s.updateJobResponse);
  const setPolling        = useStore(s => s.setPolling);
  const setResult         = useStore(s => s.setResult);
  const cancelSubmit      = useStore(s => s.cancelSubmit);

  const [retryError, setRetryError] = useState<string | null>(null);
  const [pollError, setPollError]   = useState(false);

  const doneRef              = useRef(false);
  const consecutiveFailures  = useRef(0);

  useEffect(() => {
    if (!jobId) return;
    doneRef.current = false;
    consecutiveFailures.current = 0;
    setPollError(false);

    const poll = async () => {
      if (doneRef.current) return;
      try {
        const resp = await getJob(jobId);
        consecutiveFailures.current = 0;
        updateJobResponse(resp);

        if (resp.status === 'DONE') {
          doneRef.current = true;
          setResult(toSubmitResponse(resp));
        } else if (resp.status === 'DONE_WITH_ERRORS' && resp.attemptNumber >= resp.maxRetries) {
          doneRef.current = true;
          setResult(toSubmitResponse(resp));
        }
      } catch {
        consecutiveFailures.current += 1;
        if (consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES) {
          doneRef.current = true;
          setPollError(true);
        }
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      doneRef.current = true;
    };
  }, [jobId, updateJobResponse, setResult]);

  const handleRetry = async () => {
    if (!jobId) return;
    setRetryError(null);
    try {
      const { jobId: newJobId } = await retryJob(jobId);
      setPolling(newJobId);
    } catch {
      setRetryError('Error al reintentar. Verifica que el servicio esté activo.');
    }
  };

  const job = jobResponse;
  const isDone = job?.status === 'DONE' || job?.status === 'DONE_WITH_ERRORS';
  const canRetry = isDone &&
    job?.status === 'DONE_WITH_ERRORS' &&
    (job?.attemptNumber ?? 0) < (job?.maxRetries ?? 0);

  const progress = job && job.totalRows > 0
    ? Math.round((job.processed / job.totalRows) * 100)
    : 0;

  if (pollError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6 pb-6 pt-16">
        <div className="m3-card-elevated w-full max-w-2xl text-center">
          <div className="w-16 h-16 rounded-shape-xl bg-error-container flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-on-error-container" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-headline-sm font-medium text-on-surface mb-3">
            Se perdió la conexión con el servidor
          </h2>
          <p className="text-body-md text-on-surface-variant mb-6">
            No se pudo contactar el servicio. Verifica que el backend esté activo e intenta de nuevo.
          </p>
          <button className="m3-btn-filled w-full" onClick={cancelSubmit}>
            Volver a la planilla
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 pb-6 pt-16">
      <div className="m3-card-elevated w-full max-w-2xl">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          {!isDone && (
            <svg className="animate-spin w-6 h-6 text-primary flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          <div>
            <h2 className="text-headline-sm font-medium text-on-surface">
              {!job ? 'Iniciando envío...' : !isDone ? 'Enviando registros...' : 'Envío completado'}
            </h2>
            {job && job.attemptNumber > 1 && (
              <p className="text-body-sm text-on-surface-variant mt-0.5">
                Intento {job.attemptNumber} de {job.maxRetries}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {job && (
          <div className="mb-4">
            <div className="flex justify-between text-body-sm text-on-surface-variant mb-1">
              <span>{job.processed} de {job.totalRows} registros</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-surface-container-highest rounded-shape-full h-2">
              <div
                className="bg-primary h-2 rounded-shape-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Counters */}
        {job && (
          <div className="flex gap-6 mb-6">
            {job.submitted > 0 && (
              <div className="text-center">
                <p className="text-display-sm font-medium text-primary">{job.submitted}</p>
                <p className="text-body-sm text-on-surface-variant">enviado{job.submitted !== 1 ? 's' : ''}</p>
              </div>
            )}
            {job.skipped > 0 && (
              <div className="text-center">
                <p className="text-display-sm font-medium text-on-surface-variant">{job.skipped}</p>
                <p className="text-body-sm text-on-surface-variant">duplicado{job.skipped !== 1 ? 's' : ''}</p>
              </div>
            )}
            {job.failed > 0 && (
              <div className="text-center">
                <p className="text-display-sm font-medium text-error">{job.failed}</p>
                <p className="text-body-sm text-on-surface-variant">fallido{job.failed !== 1 ? 's' : ''}</p>
              </div>
            )}
          </div>
        )}

        {/* Failed rows detail */}
        {job && job.failed > 0 && (
          <div className="m3-card-filled text-left mb-6 max-h-64 overflow-y-auto">
            <p className="text-label-lg text-on-surface-variant mb-3">Registros con error</p>
            <div className="divide-y divide-outline-variant">
              {job.rows
                .filter(r => r.status === 'FAILED')
                .map(r => (
                  <div key={r.codigoEmpleado} className="flex justify-between items-center py-2">
                    <span className="text-body-md text-on-surface">
                      {r.nombreEmpleado || `Empleado ${r.codigoEmpleado}`}
                    </span>
                    <span className="text-body-sm text-error ml-4 text-right">
                      {r.error ?? 'Error desconocido'}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {retryError && (
          <div className="rounded-shape-sm bg-error-container px-4 py-3 mb-3 text-left">
            <p className="text-body-sm text-on-error-container">{retryError}</p>
          </div>
        )}
        {canRetry && (
          <button className="m3-btn-filled w-full" onClick={handleRetry}>
            Reintentar filas fallidas
          </button>
        )}
      </div>
    </div>
  );
}
