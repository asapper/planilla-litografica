import type { DraftSummary, DraftView } from '../tasTypes';
import { formatSavedAt } from '../formatSavedAt';
import { canResume } from '../tasDraft';

const STEP_LABELS: Record<DraftView, string> = {
  inactiveReview: 'Empleados inactivos',
  verification: 'Verificación',
  review: 'Revisión',
};

interface Props {
  draft: DraftSummary;
  onContinue: () => void;
  onDiscard: () => void;
}

export default function ResumeDraftCard({ draft, onContinue, onDiscard }: Props) {
  const resumable = canResume(draft);
  return (
    <section
      aria-label="Sesión sin terminar"
      className="w-full mb-6 rounded-shape-md border border-outline-variant bg-surface-container-low px-5 py-4 text-left"
    >
      <h2 className="text-title-sm font-medium text-on-surface mb-1">Sesión sin terminar</h2>
      {draft.fileName && (
        <p className="text-body-md text-on-surface break-all">{draft.fileName}</p>
      )}
      <p className="text-body-sm text-on-surface-variant">
        Paso: {STEP_LABELS[draft.view]} · Guardada {formatSavedAt(draft.savedAt)}
      </p>
      {draft.partialSubmit && (
        <p className="mt-2 text-body-sm text-on-warning-container bg-warning-container rounded-shape-sm px-3 py-2">
          Envío parcial: algunos registros ya se enviaron y aparecerán como duplicados.
        </p>
      )}
      {!resumable && (
        <p className="mt-2 text-body-sm text-on-warning-container bg-warning-container rounded-shape-sm px-3 py-2">
          Esta sesión se guardó con otra versión de la aplicación y no se puede continuar. Descártela y vuelva a cargar el archivo.
        </p>
      )}
      {draft.jobActive && (
        <p className="mt-2 text-body-sm text-on-surface-variant" role="status">
          Envío en curso, espere a que termine.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-3">
        {!draft.jobActive && (
          <>
            <button className="m3-btn-outlined" onClick={onDiscard}>
              Descartar
            </button>
            {resumable && (
              <button className="m3-btn-filled" onClick={onContinue}>
                Continuar
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
