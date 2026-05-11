import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { getJob, retryJob } from '../api';
import type { JobResponse, SubmitResponse } from '../types';
import ScreenLayout from './ui/ScreenLayout';
import IconBadge from './ui/IconBadge';
import Spinner from './ui/Spinner';
import StatCounter from './ui/StatCounter';
import AlertMessage from './ui/AlertMessage';
import FailedRowsList from './ui/FailedRowsList';

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
      <ScreenLayout maxWidth="max-w-2xl" centerText>
        <IconBadge bg="bg-error-container" color="text-on-error-container">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </IconBadge>
        <h2 className="text-headline-sm font-medium text-on-surface mb-3">
          Se perdió la conexión con el servidor
        </h2>
        <p className="text-body-md text-on-surface-variant mb-6">
          No se pudo contactar el servicio. Verifica que el backend esté activo e intenta de nuevo.
        </p>
        <button className="m3-btn-filled w-full" onClick={cancelSubmit}>
          Volver a la planilla
        </button>
      </ScreenLayout>
    );
  }

  const failedRows = job
    ? job.rows
        .filter(r => r.status === 'FAILED')
        .map(r => ({
          id: r.codigoEmpleado,
          name: r.nombreEmpleado || `Empleado ${r.codigoEmpleado}`,
          error: r.error,
        }))
    : [];

  return (
    <ScreenLayout maxWidth="max-w-2xl">
      <div className="flex items-center gap-4 mb-6">
        {!isDone && <Spinner />}
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

      {job && (
        <div className="flex gap-6 mb-6">
          {job.submitted > 0 && (
            <StatCounter value={job.submitted} label={`enviado${job.submitted !== 1 ? 's' : ''}`} />
          )}
          {job.skipped > 0 && (
            <StatCounter value={job.skipped} label={`duplicado${job.skipped !== 1 ? 's' : ''}`} color="text-on-surface-variant" />
          )}
          {job.failed > 0 && (
            <StatCounter value={job.failed} label={`fallido${job.failed !== 1 ? 's' : ''}`} color="text-error" />
          )}
        </div>
      )}

      <FailedRowsList rows={failedRows} scrollable />

      {retryError && <AlertMessage message={retryError} className="mb-3" />}
      {canRetry && (
        <button className="m3-btn-filled w-full" onClick={handleRetry}>
          Reintentar filas fallidas
        </button>
      )}
    </ScreenLayout>
  );
}
