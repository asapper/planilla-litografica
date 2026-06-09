import { useState } from 'react';
import { useTasStore } from '../../tasStore';
import { resolveVerification, submitTas } from '../../tasApi';
import type { TasSession, TasFlag } from '../../tasTypes';

type FilterChip = 'all' | 'missing_entry' | 'missing_exit' | 'shift_mismatch' | 'cutoff';

const FLAG_LABELS: Record<TasFlag, string> = {
  MISSING_ENTRY:  'Falta entrada',
  MISSING_EXIT:   'Falta salida',
  SHIFT_MISMATCH: 'Cambio de turno',
  SAME_DAY_DOUBLE: 'Doble marcación',
  START_CUTOFF:   'Corte de período',
  END_CUTOFF:     'Corte de período',
};

const FLAG_COLORS: Record<TasFlag, string> = {
  MISSING_ENTRY:  'bg-red-100 text-red-700',
  MISSING_EXIT:   'bg-red-100 text-red-700',
  SHIFT_MISMATCH: 'bg-amber-100 text-amber-700',
  SAME_DAY_DOUBLE: 'bg-orange-100 text-orange-700',
  START_CUTOFF:   'bg-blue-100 text-blue-700',
  END_CUTOFF:     'bg-blue-100 text-blue-700',
};

function formatDate(dateStr: string): string {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${months[month - 1]} ${year}`;
}

function toHHMM(timeStr: string | null): string {
  if (!timeStr) return '';
  return timeStr.slice(0, 5);
}

function calcHours(entry: string, exit: string): string {
  if (!entry || !exit) return '—';
  const [eh, em] = entry.split(':').map(Number);
  const [xh, xm] = exit.split(':').map(Number);
  const entryMin = eh * 60 + em;
  const exitMin  = xh * 60 + xm;
  if (exitMin <= entryMin) return '—';
  const hours = Math.floor((exitMin - entryMin) / 30) / 2;
  return `${hours.toFixed(1)}h`;
}

function sessionMatchesFilter(session: TasSession, filter: FilterChip): boolean {
  if (filter === 'all') return true;
  if (filter === 'missing_entry')  return session.flags.includes('MISSING_ENTRY');
  if (filter === 'missing_exit')   return session.flags.includes('MISSING_EXIT');
  if (filter === 'shift_mismatch') return session.flags.includes('SHIFT_MISMATCH');
  if (filter === 'cutoff')         return session.flags.includes('START_CUTOFF') || session.flags.includes('END_CUTOFF');
  return false;
}

interface SessionCardProps {
  session: TasSession;
  confirmed: boolean;
  onConfirm: (resolvedStart: string, resolvedEnd: string, mismatchChoice: 'update' | 'keep' | null) => void;
}

function SessionCard({ session, confirmed, onConfirm }: SessionCardProps) {
  const [entry, setEntry] = useState(toHHMM(session.effectiveStart));
  const [exit,  setExit]  = useState(toHHMM(session.lastScan));
  const [mismatchChoice, setMismatchChoice] = useState<'update' | 'keep' | null>(null);

  const needsEntry = session.flags.includes('MISSING_ENTRY');
  const needsExit  = session.flags.includes('MISSING_EXIT');
  const entryReadOnly = !needsEntry && !!session.effectiveStart;
  const exitReadOnly  = !needsExit  && !!session.lastScan;

  const canConfirm = (!needsEntry || !!entry) && (!needsExit || !!exit);

  const hoursPreview = calcHours(entry, exit);

  if (confirmed) {
    return (
      <div className="border-l-4 border-green-500 bg-white rounded-shape-md px-4 py-3 mb-3 flex items-center gap-4 shadow-sm">
        <div className="flex-1">
          <span className="font-medium text-on-surface">{session.employeeName}</span>
          <span className="mx-2 text-on-surface-variant">·</span>
          <span className="text-on-surface-variant text-body-sm">{formatDate(session.date)}</span>
        </div>
        <span className="text-green-600 text-body-sm font-medium">Confirmado</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-shape-md border border-outline-variant p-4 mb-3 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium text-on-surface">{session.employeeName}</span>
        <span className="text-on-surface-variant text-body-sm">{formatDate(session.date)}</span>
        <div className="flex gap-1 flex-wrap">
          {session.flags.map(f => (
            <span key={f} className={`text-label-sm px-2 py-0.5 rounded-full ${FLAG_COLORS[f]}`}>
              {FLAG_LABELS[f]}
            </span>
          ))}
        </div>
      </div>

      {session.matchedShiftName && (
        <p className="text-body-sm text-on-surface-variant mb-2">
          Turno asignado: {session.matchedShiftName}
        </p>
      )}

      {session.scans.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {session.scans.map((s, i) => (
            <span key={i} className="px-2 py-1 rounded-shape-sm bg-surface-container text-body-sm text-on-surface-variant">
              {toHHMM(s)}
            </span>
          ))}
        </div>
      )}

      {session.consistentMismatch && (
        <div className="mb-3 rounded-shape-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-body-sm text-amber-800 mb-2">
            Las marcaciones de {session.employeeName} corresponden al turno {session.matchedShiftName} en toda la quincena.
            ¿Desea actualizar su turno asignado?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setMismatchChoice('update')}
              className={`px-3 py-1 text-label-sm rounded-shape-full border transition-colors cursor-pointer ${
                mismatchChoice === 'update'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'border-amber-400 text-amber-700 hover:bg-amber-100'
              }`}
            >
              Sí, actualizar turno
            </button>
            <button
              onClick={() => setMismatchChoice('keep')}
              className={`px-3 py-1 text-label-sm rounded-shape-full border transition-colors cursor-pointer ${
                mismatchChoice === 'keep'
                  ? 'bg-surface-container text-on-surface border-outline'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              No, mantener
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-4 items-end mb-3">
        <div className="flex flex-col gap-1">
          <label className="text-label-sm text-on-surface-variant">Entrada</label>
          <input
            type="time"
            value={entry}
            onChange={e => setEntry(e.target.value)}
            readOnly={entryReadOnly}
            aria-label="Entrada"
            className={`h-9 px-3 rounded-shape-sm border text-body-md focus:outline-none focus:border-primary transition-colors ${
              entryReadOnly
                ? 'bg-surface-container border-outline-variant text-on-surface-variant cursor-default'
                : 'bg-white border-outline focus:ring-1 focus:ring-primary'
            }`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-label-sm text-on-surface-variant">Salida</label>
          <input
            type="time"
            value={exit}
            onChange={e => setExit(e.target.value)}
            readOnly={exitReadOnly}
            aria-label="Salida"
            className={`h-9 px-3 rounded-shape-sm border text-body-md focus:outline-none focus:border-primary transition-colors ${
              exitReadOnly
                ? 'bg-surface-container border-outline-variant text-on-surface-variant cursor-default'
                : 'bg-white border-outline focus:ring-1 focus:ring-primary'
            }`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-label-sm text-on-surface-variant">Horas calculadas</span>
          <span className="h-9 flex items-center text-body-md text-on-surface">
            {hoursPreview === '—' ? '—' : `Horas calculadas: ${hoursPreview}`}
          </span>
        </div>
      </div>

      <button
        disabled={!canConfirm}
        onClick={() => onConfirm(entry, exit, mismatchChoice)}
        className="m3-btn-filled disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Confirmar
      </button>
    </div>
  );
}

export default function VerificationScreen() {
  const uploadToken           = useTasStore(s => s.uploadToken);
  const flaggedSessions       = useTasStore(s => s.flaggedSessions);
  const resolvedSessions      = useTasStore(s => s.resolvedSessions);
  const setResolvedSession    = useTasStore(s => s.setResolvedSession);
  const clearResolvedSessions = useTasStore(s => s.clearResolvedSessions);
  const setTasView            = useTasStore(s => s.setTasView);
  const setResolvedRowCount   = useTasStore(s => s.setResolvedRowCount);
  const setJobId              = useTasStore(s => s.setJobId);
  const setFlaggedSessions    = useTasStore(s => s.setFlaggedSessions);
  const setUploadToken        = useTasStore(s => s.setUploadToken);
  const setError              = useTasStore(s => s.setError);

  const [activeFilter, setActiveFilter] = useState<FilterChip>('all');

  const needsResolutionSessions = flaggedSessions.filter(s => s.needsResolution);
  const confirmedCount  = Object.keys(resolvedSessions).length;
  const totalToResolve  = needsResolutionSessions.length;
  const pendingCount    = totalToResolve - confirmedCount;

  const filtered = needsResolutionSessions.filter(s => sessionMatchesFilter(s, activeFilter));

  const chipCounts = {
    all:           needsResolutionSessions.length,
    missing_entry: needsResolutionSessions.filter(s => s.flags.includes('MISSING_ENTRY')).length,
    missing_exit:  needsResolutionSessions.filter(s => s.flags.includes('MISSING_EXIT')).length,
    shift_mismatch: needsResolutionSessions.filter(s => s.flags.includes('SHIFT_MISMATCH')).length,
    cutoff:        needsResolutionSessions.filter(s => s.flags.includes('START_CUTOFF') || s.flags.includes('END_CUTOFF')).length,
  };

  const allConfirmed = pendingCount === 0 && totalToResolve > 0;

  const handleSubmit = async () => {
    if (!uploadToken) return;
    try {
      const resolutions = Object.entries(resolvedSessions).map(([id, entry]) => ({
        sessionId: Number(id),
        resolvedStart: entry.resolvedStart,
        resolvedEnd:   entry.resolvedEnd,
        updateShift:   entry.updateShift,
      }));
      const result = await resolveVerification(uploadToken, resolutions);
      if (result.flaggedSessions.some(s => s.needsResolution)) {
        clearResolvedSessions();
        setFlaggedSessions(result.flaggedSessions);
        setUploadToken(result.uploadToken);
        return;
      }
      setFlaggedSessions(result.flaggedSessions);
      setUploadToken(result.uploadToken);
      setResolvedRowCount(result.resolvedRows?.length ?? 0);
      setTasView('submitting');
      const { jobId } = await submitTas(result.uploadToken);
      setJobId(jobId);
      setTasView('result');
    } catch {
      setTasView('verification');
      setError('Ocurrió un error al enviar. Intente nuevamente.');
    }
  };

  const chips: { key: FilterChip; label: string }[] = [
    { key: 'all',           label: 'Todos' },
    { key: 'missing_entry', label: 'Falta entrada' },
    { key: 'missing_exit',  label: 'Falta salida' },
    { key: 'shift_mismatch', label: 'Cambio de turno' },
    { key: 'cutoff',        label: 'Corte de período' },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div className="flex-1 overflow-auto px-6 py-6">
        <h2 className="text-headline-sm font-medium text-on-surface mb-4">
          Verificación de marcaciones
        </h2>

        <div className="flex gap-2 flex-wrap mb-6">
          {chips.map(chip => (
            chipCounts[chip.key] > 0 || chip.key === 'all' ? (
              <button
                key={chip.key}
                onClick={() => setActiveFilter(chip.key)}
                className={`px-3 py-1 rounded-full text-label-md font-medium border transition-colors cursor-pointer ${
                  activeFilter === chip.key
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-on-surface-variant border-outline-variant hover:bg-surface-container-low'
                }`}
              >
                {chip.label} {chipCounts[chip.key] > 0 ? `(${chipCounts[chip.key]})` : ''}
              </button>
            ) : null
          ))}
        </div>

        {filtered.map(session => (
          <SessionCard
            key={session.sessionId}
            session={session}
            confirmed={!!resolvedSessions[session.sessionId]}
            onConfirm={(resolvedStart, resolvedEnd, mismatchChoice) =>
              setResolvedSession(session.sessionId, {
                resolvedStart,
                resolvedEnd,
                updateShift: mismatchChoice === 'update' ? true : mismatchChoice === 'keep' ? false : undefined,
              })
            }
          />
        ))}
      </div>

      <div className="sticky bottom-0 bg-white border-t border-outline-variant px-6 py-4 flex items-center justify-between">
        <div>
          {pendingCount > 0 && (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-error text-white text-label-md font-medium">
              {pendingCount} por resolver
            </span>
          )}
        </div>
        <button
          disabled={!allConfirmed}
          onClick={handleSubmit}
          className="m3-btn-filled disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
