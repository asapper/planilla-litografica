import { useTasStore } from '../../tasStore';
import Spinner from '../ui/Spinner';

interface Props {
  fileName: string;
}

export default function ProcessingScreen({ fileName }: Props) {
  const processingMessage       = useTasStore(s => s.processingMessage);
  const usedFallbackHolidays    = useTasStore(s => s.usedFallbackHolidays);
  const fallbackBannerDismissed = useTasStore(s => s.fallbackBannerDismissed);
  const dismissFallbackBanner   = useTasStore(s => s.dismissFallbackBanner);

  const showBanner = usedFallbackHolidays && !fallbackBannerDismissed;

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-white px-6">
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
        <div className="w-full max-w-lg rounded-shape-md border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <p className="flex-1 text-body-sm text-amber-800">
            No se pudo verificar el calendario de feriados en línea. Se usó la lista incluida en la
            aplicación. Revise la configuración si falta algún feriado.
          </p>
          <button
            onClick={dismissFallbackBanner}
            aria-label="Cerrar aviso de feriados"
            className="text-amber-600 hover:text-amber-800 transition-colors shrink-0 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
