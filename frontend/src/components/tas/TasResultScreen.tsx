import { useState } from 'react';
import { useTasStore } from '../../tasStore';
import { retryTasJob } from '../../tasApi';
import ScreenLayout from '../ui/ScreenLayout';
import IconBadge from '../ui/IconBadge';

export default function TasResultScreen() {
  const resolvedRowCount = useTasStore(s => s.resolvedRowCount);
  const jobResult        = useTasStore(s => s.jobResult);
  const jobId            = useTasStore(s => s.jobId);
  const absentEmployees  = useTasStore(s => s.absentEmployees);
  const resetTas         = useTasStore(s => s.resetTas);
  const setTasView       = useTasStore(s => s.setTasView);
  const setJobId         = useTasStore(s => s.setJobId);
  const setJobResult     = useTasStore(s => s.setJobResult);

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const hasFailed = jobResult != null && jobResult.failed > 0;
  const canRetry = hasFailed && jobResult.attemptNumber <= jobResult.maxRetries;
  const retriesExhausted = hasFailed && jobResult.attemptNumber > jobResult.maxRetries;

  const handleRetry = async () => {
    if (!jobId) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const result = await retryTasJob(jobId);
      setJobId(result.jobId);
      setJobResult(null);
      setTasView('polling');
    } catch {
      setRetryError('No se pudo reintentar. Intente de nuevo.');
    } finally {
      setRetrying(false);
    }
  };

  const handleReviewAbsent = () => {
    setTasView('absentReview');
  };

  return (
    <ScreenLayout maxWidth="max-w-lg" centerText>
      <IconBadge bg="bg-primary-container" color="text-on-primary-container">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </IconBadge>

      <h2 className="text-headline-sm font-medium text-on-surface mb-3">Carga completada</h2>
      {jobResult ? (
        <>
          <p className="text-body-md text-on-surface-variant mb-2">
            {jobResult.submitted === 1
              ? 'Se envió 1 registro.'
              : `Se enviaron ${jobResult.submitted} registros.`}
          </p>
          {jobResult.skipped > 0 && (
            <p className="text-body-md text-on-surface-variant mb-2">
              {jobResult.skipped} {jobResult.skipped === 1 ? 'omitido' : 'omitidos'} por duplicado.
            </p>
          )}
          {jobResult.failed > 0 && (
            <p className="text-body-md text-error mb-2">
              {jobResult.failed} con error.
            </p>
          )}
          {hasFailed && (
            <p className="text-body-sm text-on-surface-variant mb-2">
              Intento {jobResult.attemptNumber} de {jobResult.maxRetries}
            </p>
          )}
          {retriesExhausted && (
            <p className="text-body-sm text-error mb-2">
              Se agotaron los reintentos.
            </p>
          )}
          {retryError && (
            <p className="text-body-sm text-error mb-2">{retryError}</p>
          )}
          <div className="mb-6" />
        </>
      ) : (
        <p className="text-body-md text-on-surface-variant mb-6">
          {resolvedRowCount === 1
            ? 'Se envió 1 registro.'
            : `Se enviaron ${resolvedRowCount} registros.`}
        </p>
      )}

      {absentEmployees.length > 0 && (
        <p className="text-body-md text-on-surface-variant mb-6">
          {absentEmployees.length} empleado{absentEmployees.length !== 1 ? 's' : ''} activo
          {absentEmployees.length !== 1 ? 's' : ''} no {absentEmployees.length !== 1 ? 'tuvieron' : 'tuvo'} marcaciones en este período.
        </p>
      )}

      {canRetry && (
        <button
          className="m3-btn-filled w-full mb-3"
          onClick={handleRetry}
          disabled={retrying}
        >
          {retrying ? 'Reintentando...' : 'Reintentar registros fallidos'}
        </button>
      )}

      {absentEmployees.length > 0 && (
        <button
          className={`${canRetry ? 'm3-btn-outlined' : 'm3-btn-filled'} w-full mb-3`}
          onClick={handleReviewAbsent}
        >
          Revisar empleados sin marcaciones →
        </button>
      )}

      <button
        className={absentEmployees.length > 0 || canRetry ? 'm3-btn-outlined w-full' : 'm3-btn-filled w-full'}
        onClick={resetTas}
      >
        Nueva carga
      </button>
    </ScreenLayout>
  );
}
