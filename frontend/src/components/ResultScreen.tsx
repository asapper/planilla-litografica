import { useStore } from '../store';

export default function ResultScreen() {
  const submitResult = useStore(s => s.submitResult);
  const reset        = useStore(s => s.reset);

  if (!submitResult) return null;

  const { totalSubmitted, totalSkippedDuplicates, totalFailed } = submitResult;
  const isSuccess      = totalFailed === 0;
  const isPartial      = totalFailed > 0 && totalSubmitted > 0;
  const isFullFailure  = totalSubmitted === 0 && totalFailed > 0;

  type Variant = 'success' | 'partial' | 'error';
  const variant: Variant = isSuccess ? 'success' : isPartial ? 'partial' : 'error';

  const config = {
    success: {
      iconBg:   'bg-primary-container',
      iconColor:'text-on-primary-container',
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
      title:    'Carga completada',
      btnLabel: 'Nueva carga',
    },
    partial: {
      iconBg:   'bg-warning-container',
      iconColor:'text-on-warning-container',
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />,
      title:    'Carga completada con errores',
      btnLabel: 'Nueva carga',
    },
    error: {
      iconBg:   'bg-error-container',
      iconColor:'text-on-error-container',
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
      title:    'Error al enviar',
      btnLabel: 'Intentar de nuevo',
    },
  }[variant];

  const failedRows = submitResult.rows.filter(r => !r.submitted && !r.skippedDuplicate);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="m3-card-elevated w-full max-w-lg text-center">

        {/* Icon */}
        <div className={`w-16 h-16 rounded-shape-xl ${config.iconBg} flex items-center justify-center mx-auto mb-6`}>
          <svg className={`w-8 h-8 ${config.iconColor}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {config.icon}
          </svg>
        </div>

        <h2 className="text-headline-sm font-medium text-on-surface mb-3">{config.title}</h2>

        {/* Stats */}
        <div className="flex justify-center gap-6 mb-6">
          {totalSubmitted > 0 && (
            <div className="text-center">
              <p className="text-display-sm font-medium text-primary">{totalSubmitted}</p>
              <p className="text-body-sm text-on-surface-variant">enviado{totalSubmitted !== 1 ? 's' : ''}</p>
            </div>
          )}
          {totalSkippedDuplicates > 0 && (
            <div className="text-center">
              <p className="text-display-sm font-medium text-on-surface-variant">{totalSkippedDuplicates}</p>
              <p className="text-body-sm text-on-surface-variant">duplicado{totalSkippedDuplicates !== 1 ? 's' : ''}</p>
            </div>
          )}
          {totalFailed > 0 && (
            <div className="text-center">
              <p className="text-display-sm font-medium text-error">{totalFailed}</p>
              <p className="text-body-sm text-on-surface-variant">fallido{totalFailed !== 1 ? 's' : ''}</p>
            </div>
          )}
          {isFullFailure && (
            <p className="text-body-md text-on-surface-variant">
              No se pudo completar la carga. Verifica la conexión e intenta de nuevo.
            </p>
          )}
        </div>

        {/* Failed rows detail */}
        {failedRows.length > 0 && (
          <div className="m3-card-filled text-left mb-6">
            <p className="text-label-lg text-on-surface-variant mb-3">Registros con error</p>
            <div className="divide-y divide-outline-variant">
              {failedRows.map(r => (
                <div key={r.codigoEmpleado} className="flex justify-between items-center py-2">
                  <span className="text-body-md text-on-surface">Empleado {r.codigoEmpleado}</span>
                  <span className="text-body-sm text-error">{r.error ?? 'Error desconocido'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button className="m3-btn-filled w-full" onClick={reset}>
          {config.btnLabel}
        </button>
      </div>
    </div>
  );
}
