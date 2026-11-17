import { useRef, useState } from 'react';
import { isTasFile } from '../isTasFile';
import ScreenLayout from './ui/ScreenLayout';
import IconBadge from './ui/IconBadge';
import AlertMessage from './ui/AlertMessage';
import ConfirmModal from './ui/ConfirmModal';
import ResumeDraftCard from './ResumeDraftCard';
import type { DraftSummary } from '../tasTypes';

interface Props {
  onTasFile: (file: File) => Promise<boolean>;
  draft: DraftSummary | null;
  onContinueDraft: () => void;
  onDiscardDraft: () => void;
}

export default function EmptyState({ onTasFile, draft, onContinueDraft, onDiscardDraft }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const uploadFile = async (file: File) => {
    setLoading(true);
    try {
      await onTasFile(file);
    } catch {
      setError('No se pudo procesar el archivo TAS. Intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setLoading(true);
    try {
      if (await isTasFile(file)) {
        if (draft) {
          setPendingFile(file);
          return;
        }
        await onTasFile(file);
      } else {
        setError('El archivo no tiene el formato esperado de marcaciones TAS.');
      }
    } catch {
      setError('No se pudo procesar el archivo TAS. Intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <ScreenLayout maxWidth="max-w-md" centerText>
      <IconBadge bg="bg-primary-container" color="text-on-primary-container">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </IconBadge>

      <h1 className="text-headline-sm font-medium text-on-surface mb-2">
        Cargador de Planilla
      </h1>
      <p className="text-body-md text-on-surface-variant mb-8">
        Sube tu archivo CSV para comenzar
      </p>

      {draft && (
        <ResumeDraftCard
          draft={draft}
          onContinue={onContinueDraft}
          onDiscard={() => setConfirmDiscard(true)}
        />
      )}

      <button
        className="m3-btn-filled w-full mb-4"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
      >
        {loading ? 'Procesando...' : 'Seleccionar archivo'}
      </button>

      <div
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`
          mt-2 rounded-shape-md border-2 border-dashed px-6 py-8 cursor-pointer
          transition-colors duration-150
          ${dragging
            ? 'border-primary bg-primary-container'
            : 'border-outline-variant hover:border-primary hover:bg-surface-container-low'}
        `}
      >
        <svg className="w-6 h-6 mx-auto mb-2 text-on-surface-variant" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <p className="text-body-sm text-on-surface-variant">
          {dragging ? 'Suelta aquí' : 'O arrastra tu archivo aquí'}
        </p>
      </div>

      {error && <AlertMessage message={error} className="mt-4" />}

      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />

      {confirmDiscard && (
        <ConfirmModal
          title="Descartar sesión"
          message="¿Descartar la sesión guardada? Se perderán las decisiones tomadas."
          confirmLabel="Sí, descartar"
          cancelLabel="Cancelar"
          onConfirm={() => {
            setConfirmDiscard(false);
            onDiscardDraft();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {pendingFile && (
        <ConfirmModal
          title="Cargar archivo nuevo"
          message="Ya hay una sesión sin terminar. Si carga un archivo nuevo, se descartará."
          confirmLabel="Cargar archivo"
          cancelLabel="Cancelar"
          onConfirm={() => {
            const file = pendingFile;
            setPendingFile(null);
            uploadFile(file);
          }}
          onCancel={() => setPendingFile(null)}
        />
      )}
    </ScreenLayout>
  );
}
