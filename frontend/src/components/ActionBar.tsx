import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { validateRows, startJob, checkDbHealth } from '../api';
import Spinner from './ui/Spinner';
import StatusBadge from './ui/StatusBadge';

const ERR_SERVER = 'Error al conectar con el servidor. Verifica que el servicio esté activo.';

const ICON_WARNING = <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />;
const ICON_SORT    = <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />;

export default function ActionBar() {
  const validation       = useStore(s => s.validation);
  const selectedQuincena = useStore(s => s.selectedQuincena);
  const selectedMonth    = useStore(s => s.selectedMonth);
  const multiMonth       = useStore(s => s.multiMonth);
  const dbReachable      = useStore(s => s.dbReachable);
  const setValidation    = useStore(s => s.setValidation);
  const setDbReachable   = useStore(s => s.setDbReachable);
  const setSubmitting    = useStore(s => s.setSubmitting);
  const cancelSubmit     = useStore(s => s.cancelSubmit);
  const setPolling       = useStore(s => s.setPolling);
  const getRowsForSubmit = useStore(s => s.getRowsForSubmit);

  const [isValidating, setIsValidating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectionComplete = selectedQuincena !== null && (!multiMonth || selectedMonth !== null);
  const hasErrors         = validation?.rows.some(r => !r.valid) ?? false;
  const validationPassed  = validation?.allValid === true;

  useEffect(() => {
    if (!validationPassed) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        await checkDbHealth();
        if (!cancelled) setDbReachable(true);
      } catch {
        if (!cancelled) {
          setDbReachable(false);
          timer = setTimeout(poll, 3_000);
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [validationPassed, setDbReachable]);

  const buttonDisabled =
    isValidating ||
    !selectionComplete ||
    (validation !== null && hasErrors) ||
    (validationPassed && dbReachable !== true);

  const errorCount = validation?.rows.filter(r => !r.valid).length ?? 0;
  const dupCount   = validation?.rows.filter(r => r.duplicate).length ?? 0;

  const handleValidateAndSubmit = async () => {
    const rows = getRowsForSubmit();

    if (validationPassed && dbReachable === true) {
      try {
        setActionError(null);
        setSubmitting();
        const { jobId } = await startJob(rows);
        setPolling(jobId);
      } catch {
        cancelSubmit();
        setActionError(ERR_SERVER);
      }
      return;
    }

    const snapshotQuincena = selectedQuincena;
    const snapshotMonthMes = selectedMonth?.mes ?? null;
    const snapshotMonthAnio = selectedMonth?.anio ?? null;

    setIsValidating(true);
    setActionError(null);
    try {
      const result = await Promise.race([
        validateRows(rows),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 15_000)
        ),
      ]);
      const current = useStore.getState();
      const selectionUnchanged =
        current.selectedQuincena === snapshotQuincena &&
        (current.selectedMonth?.mes ?? null) === snapshotMonthMes &&
        (current.selectedMonth?.anio ?? null) === snapshotMonthAnio;
      if (selectionUnchanged) {
        setValidation(result);
      }
    } catch {
      setActionError(ERR_SERVER);
    } finally {
      setIsValidating(false);
    }
  };

  const btnLabel = isValidating
    ? 'Validando...'
    : (validation !== null && hasErrors)
      ? 'Corrige los errores'
      : validationPassed
        ? 'Enviar'
        : 'Validar';

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-surface-container-low border-t border-outline-variant px-6 py-3 flex items-center justify-between"
         style={{ boxShadow: 'var(--md-sys-elevation-2)' }}>

      <div className="flex gap-2">
        {errorCount > 0 && (
          <StatusBadge variant="error" icon={ICON_WARNING}>
            {errorCount} error{errorCount > 1 ? 'es' : ''}
          </StatusBadge>
        )}
        {dupCount > 0 && (
          <StatusBadge variant="warning" icon={ICON_SORT}>
            {dupCount} duplicado{dupCount > 1 ? 's' : ''}
          </StatusBadge>
        )}
        {!selectionComplete && (
          <span className="text-body-sm text-on-surface-variant self-center">
            Selecciona la quincena para continuar
          </span>
        )}
        {validationPassed && dbReachable === null && (
          <span className="inline-flex items-center gap-1.5 text-body-sm text-on-surface-variant">
            <Spinner size="w-3.5 h-3.5" />
            Verificando conexión...
          </span>
        )}
        {validationPassed && dbReachable === false && (
          <StatusBadge variant="error" icon={ICON_WARNING}>
            Base de datos no disponible
          </StatusBadge>
        )}
        {actionError && (
          <StatusBadge variant="error" icon={ICON_WARNING}>
            {actionError}
          </StatusBadge>
        )}
      </div>

      <button
        className={buttonDisabled ? 'm3-btn-tonal opacity-40 cursor-not-allowed pointer-events-none' : 'm3-btn-filled'}
        disabled={buttonDisabled}
        onClick={handleValidateAndSubmit}
      >
        {btnLabel}
      </button>
    </div>
  );
}
