import { useEffect, useRef, useState } from 'react';
import { useTasStore } from '../../tasStore';
import { getTasJobStatus } from '../../tasApi';
import ScreenLayout from '../ui/ScreenLayout';
import Spinner from '../ui/Spinner';
import type { JobStatus } from '../../tasTypes';

const POLL_INTERVAL = 2000;
const MAX_FAILURES = 3;

export default function PollingScreen() {
  const jobId = useTasStore(s => s.jobId);
  const setTasView = useTasStore(s => s.setTasView);
  const setJobResult = useTasStore(s => s.setJobResult);
  const resetTas = useTasStore(s => s.resetTas);

  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const failCountRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const activeRef = useRef(true);
  const pollRef = useRef<() => Promise<void>>();

  useEffect(() => {
    if (!jobId) return;
    activeRef.current = true;

    const poll = async () => {
      try {
        const data = await getTasJobStatus(jobId);
        if (!activeRef.current) return;
        failCountRef.current = 0;
        setError(null);
        setStatus(data);

        if (data.status === 'DONE' || data.status === 'DONE_WITH_ERRORS') {
          setJobResult({
            submitted: data.submitted,
            skipped: data.skipped,
            failed: data.failed,
          });
          setTasView('result');
        }
      } catch (err) {
        if (!activeRef.current) return;
        if ((err as any).response?.status === 404) {
          clearInterval(intervalRef.current!);
          setNotFound(true);
          return;
        }
        failCountRef.current += 1;
        if (failCountRef.current >= MAX_FAILURES) {
          clearInterval(intervalRef.current!);
          setError('No se pudo conectar al servidor. Verifique su conexión.');
        }
      }
    };

    pollRef.current = poll;
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => { activeRef.current = false; clearInterval(intervalRef.current!); };
  }, [jobId, setTasView, setJobResult]);

  if (notFound) {
    return (
      <ScreenLayout maxWidth="max-w-md" centerText>
        <h2 className="text-headline-sm font-medium text-on-surface mb-3">
          Trabajo no encontrado
        </h2>
        <p className="text-body-md text-on-surface-variant mb-6">
          El trabajo no fue encontrado. Por favor, intente una nueva carga.
        </p>
        <button className="m3-btn-filled w-full" onClick={resetTas}>
          Nueva carga
        </button>
      </ScreenLayout>
    );
  }

  if (error) {
    return (
      <ScreenLayout maxWidth="max-w-md" centerText>
        <h2 className="text-headline-sm font-medium text-error mb-3">
          Error de conexión
        </h2>
        <p className="text-body-md text-on-surface-variant mb-6">{error}</p>
        <button
          className="m3-btn-filled w-full"
          onClick={() => {
            failCountRef.current = 0;
            setError(null);
            pollRef.current?.();
            intervalRef.current = setInterval(pollRef.current!, POLL_INTERVAL);
          }}
        >
          Reintentar
        </button>
      </ScreenLayout>
    );
  }

  const processed = status
    ? status.submitted + status.skipped + status.failed
    : 0;
  const total = status?.totalRows ?? 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <ScreenLayout maxWidth="max-w-md" centerText>
      <Spinner size="w-8 h-8" className="mx-auto mb-4" />
      <h2 className="text-headline-sm font-medium text-on-surface mb-3">
        Procesando registros
      </h2>
      <p className="text-body-md text-on-surface-variant mb-4">
        {status
          ? `Procesando registros... (${processed} de ${total})`
          : 'Iniciando...'}
      </p>

      <div className="w-full bg-surface-container rounded-full h-2 mb-4">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="bg-primary h-2 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {status && status.failedRows.length > 0 && (
        <div className="mt-4 w-full text-left">
          <h3 className="text-label-lg text-error mb-2">
            Registros con error ({status.failedRows.length})
          </h3>
          <div className="max-h-40 overflow-auto border border-outline-variant rounded-shape-md">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-outline-variant">
                  <th className="py-1 px-3 text-left text-label-sm">Código</th>
                  <th className="py-1 px-3 text-left text-label-sm">Empleado</th>
                  <th className="py-1 px-3 text-left text-label-sm">Error</th>
                </tr>
              </thead>
              <tbody>
                {status.failedRows.map(row => (
                  <tr key={row.codigoEmpleado} className="border-b border-outline-variant last:border-b-0">
                    <td className="py-1 px-3 text-on-surface-variant">{row.codigoEmpleado}</td>
                    <td className="py-1 px-3 text-on-surface-variant">{row.nombreEmpleado}</td>
                    <td className="py-1 px-3 text-error">{row.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ScreenLayout>
  );
}
