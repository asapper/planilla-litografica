import { useRef, useState } from 'react';
import { uploadCsv } from '../api';
import { useStore } from '../store';

export default function EmptyState() {
  const inputRef = useRef<HTMLInputElement>(null);

  const setLoaded = useStore(s => s.setLoaded);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setLoading(true);
    try {
      const result = await uploadCsv(file);
      setLoaded(result.rows, result.monthOptions, result.multiMonth, result.parseWarnings);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo leer el archivo. Verifica que el formato sea correcto e intenta de nuevo.');
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
    <div className="min-h-screen bg-background flex items-center justify-center px-6 pb-6 pt-16">
      <div className="m3-card-elevated w-full max-w-md text-center">

        {/* Icon */}
        <div className="w-16 h-16 rounded-shape-xl bg-primary-container flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-on-primary-container" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>

        <h1 className="text-headline-sm font-medium text-on-surface mb-2">
          Cargador de Planilla
        </h1>
        <p className="text-body-md text-on-surface-variant mb-8">
          Sube tu archivo CSV para comenzar
        </p>

        {/* Primary action */}
        <button
          className="m3-btn-filled w-full mb-4"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
        >
          {loading ? 'Procesando...' : 'Seleccionar archivo'}
        </button>

        {/* Drop zone */}
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

        {/* Error message */}
        {error && (
          <div className="mt-4 rounded-shape-sm bg-error-container px-4 py-3 text-left">
            <p className="text-body-sm text-on-error-container">{error}</p>
          </div>
        )}

        <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
      </div>
    </div>
  );
}
