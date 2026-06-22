import { useTasStore } from '../../tasStore';
import AlertMessage from '../ui/AlertMessage';
import Spinner from '../ui/Spinner';

interface Props {
  fileName: string;
}

export default function ProcessingScreen({ fileName }: Props) {
  const processingMessage       = useTasStore(s => s.processingMessage);
  const error                   = useTasStore(s => s.error);
  const usedFallbackHolidays    = useTasStore(s => s.usedFallbackHolidays);
  const fallbackBannerDismissed = useTasStore(s => s.fallbackBannerDismissed);
  const dismissFallbackBanner   = useTasStore(s => s.dismissFallbackBanner);

  const showBanner = usedFallbackHolidays && !fallbackBannerDismissed;

  if (error) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-surface-container-lowest px-6">
        <AlertMessage message={error} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-surface-container-lowest px-6">
      <div className="flex items-center gap-3">
        <Spinner size="w-5 h-5" />
        <span className="text-body-md text-on-surface-variant font-medium">
          {fileName} — procesando...
        </span>
      </div>

      {processingMessage && (
        <p className="text-body-sm text-on-surface-variant">{processingMessage}</p>
      )}

      {showBanner && (
        <AlertMessage
          variant="warning"
          message="No se pudo verificar el calendario de feriados en línea. Se usó la lista incluida en la aplicación. Revise la configuración si falta algún feriado."
          onDismiss={dismissFallbackBanner}
          className="w-full max-w-lg"
        />
      )}
    </div>
  );
}
