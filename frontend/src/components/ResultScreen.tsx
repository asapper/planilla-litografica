import { useStore } from '../store';
import ScreenLayout from './ui/ScreenLayout';
import IconBadge from './ui/IconBadge';
import StatCounter from './ui/StatCounter';
import FailedRowsList from './ui/FailedRowsList';

export default function ResultScreen() {
  const submitResult  = useStore(s => s.submitResult);
  const reset         = useStore(s => s.reset);
  const cancelSubmit  = useStore(s => s.cancelSubmit);

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

  const failedRows = submitResult.rows
    .filter(r => !r.submitted && !r.skippedDuplicate)
    .map(r => ({ id: r.codigoEmpleado, name: `Empleado ${r.codigoEmpleado}`, error: r.error }));

  return (
    <ScreenLayout maxWidth="max-w-lg" centerText>
      <IconBadge bg={config.iconBg} color={config.iconColor}>
        {config.icon}
      </IconBadge>

      <h2 className="text-headline-sm font-medium text-on-surface mb-3">{config.title}</h2>

      <div className="flex justify-center gap-6 mb-6">
        {totalSubmitted > 0 && (
          <StatCounter value={totalSubmitted} label={`enviado${totalSubmitted !== 1 ? 's' : ''}`} />
        )}
        {totalSkippedDuplicates > 0 && (
          <StatCounter value={totalSkippedDuplicates} label={`duplicado${totalSkippedDuplicates !== 1 ? 's' : ''}`} color="text-on-surface-variant" />
        )}
        {totalFailed > 0 && (
          <StatCounter value={totalFailed} label={`fallido${totalFailed !== 1 ? 's' : ''}`} color="text-error" />
        )}
        {isFullFailure && (
          <p className="text-body-md text-on-surface-variant">
            No se pudo completar la carga. Verifica la conexión e intenta de nuevo.
          </p>
        )}
      </div>

      <FailedRowsList rows={failedRows} />

      <button className="m3-btn-filled w-full" onClick={variant === 'error' ? cancelSubmit : reset}>
        {config.btnLabel}
      </button>
    </ScreenLayout>
  );
}
