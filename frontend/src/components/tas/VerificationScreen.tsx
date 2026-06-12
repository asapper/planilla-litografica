import { useState } from 'react';
import { useTasStore } from '../../tasStore';
import { resolveVerification } from '../../tasApi';
import type { TasResolution } from '../../tasApi';
import { MONTH_NAMES_ES } from '../../dateNames';
import type { TasSession, TasFlag, TasPeriod, ShiftOption } from '../../tasTypes';

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

function flagLabel(flag: TasFlag, session: TasSession): string {
  if (flag === 'MISSING_ENTRY' && session.lastScan) {
    return `${FLAG_LABELS[flag]} · Salida ${toHHMM(session.lastScan)}`;
  }
  if (flag === 'MISSING_EXIT' && session.effectiveStart) {
    return `${FLAG_LABELS[flag]} · Entrada ${toHHMM(session.effectiveStart)}`;
  }
  return FLAG_LABELS[flag];
}

function formatDate(dateStr: string): string {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${months[month - 1]} ${year}`;
}

function toHHMM(timeStr: string | null): string {
  if (!timeStr) return '';
  const timePart = timeStr.includes('T') ? timeStr.split('T')[1] : timeStr;
  return timePart.slice(0, 5);
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

function getSessionPeriod(dateStr: string): TasPeriod {
  const [anio, mes, day] = dateStr.split('-').map(Number);
  return { anio, mes, numeroDequincena: day <= 15 ? 1 : 2 };
}

function periodsEqual(a: TasPeriod | null, b: TasPeriod | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.anio === b.anio && a.mes === b.mes && a.numeroDequincena === b.numeroDequincena;
}

function periodLabel(p: TasPeriod): string {
  const month = MONTH_NAMES_ES[p.mes];
  const capitalized = month.charAt(0).toUpperCase() + month.slice(1);
  return `${capitalized} ${p.anio} - Quincena ${p.numeroDequincena}`;
}

function periodKey(p: TasPeriod): string {
  return `${p.anio}-${p.mes}-${p.numeroDequincena}`;
}

function sessionMatchesFilter(session: TasSession, filter: FilterChip): boolean {
  if (filter === 'all') return true;
  if (filter === 'missing_entry')  return session.flags.includes('MISSING_ENTRY');
  if (filter === 'missing_exit')   return session.flags.includes('MISSING_EXIT');
  if (filter === 'shift_mismatch') return session.flags.includes('SHIFT_MISMATCH');
  if (filter === 'cutoff')         return session.flags.includes('START_CUTOFF') || session.flags.includes('END_CUTOFF');
  return false;
}

interface ShiftMismatchCardProps {
  session: TasSession;
  availableShifts: ShiftOption[];
  confirmed: boolean;
  onConfirm: (acceptedShiftId: string) => void;
}

function ShiftMismatchCard({ session, availableShifts, confirmed, onConfirm }: ShiftMismatchCardProps) {
  const [selectedShiftId, setSelectedShiftId] = useState(session.matchedShiftId ?? '');
  const [choosingShift, setChoosingShift] = useState(false);
  const [pendingShiftId, setPendingShiftId] = useState(selectedShiftId);

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

  const selectedShift = availableShifts.find(s => s.id === selectedShiftId);
  const selectedShiftName = selectedShift?.name ?? session.matchedShiftName ?? '';
  const selectedShiftTimes = selectedShift ? ` (${selectedShift.startTime}–${selectedShift.endTime})` : '';

  return (
    <div className="bg-white rounded-shape-md border border-outline-variant p-4 mb-3 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium text-on-surface">{session.employeeName}</span>
        <span className="text-on-surface-variant text-body-sm">{formatDate(session.date)}</span>
        <div className="flex gap-1 flex-wrap">
          {session.flags.map(f => (
            <span key={f} className={`text-label-sm px-2 py-0.5 rounded-full ${FLAG_COLORS[f]}`}>
              {flagLabel(f, session)}
            </span>
          ))}
        </div>
      </div>

      {session.scans.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {session.scans.map((s, i) => (
            <span key={i} className="px-2 py-1 rounded-shape-sm bg-surface-container text-body-sm text-on-surface-variant">
              {toHHMM(s)}
            </span>
          ))}
        </div>
      )}

      <div className="mb-3 rounded-shape-md border border-green-200 bg-green-50 px-3 py-2 text-body-sm">
        {`Turno asignado: ${session.assignedShiftName ?? '—'} → se aplicará ${selectedShiftName}${selectedShiftTimes} según las marcaciones.`}
        {!choosingShift && (
          <button
            type="button"
            onClick={() => { setPendingShiftId(selectedShiftId); setChoosingShift(true); }}
            className="ml-2 text-primary underline cursor-pointer"
          >
            Elegir otro turno
          </button>
        )}
      </div>

      {choosingShift && (
        <div className="mb-3 flex items-center gap-2">
          <select
            value={pendingShiftId}
            onChange={e => setPendingShiftId(e.target.value)}
            className="h-9 px-3 rounded-shape-sm border border-outline bg-white text-body-md focus:outline-none focus:border-primary"
          >
            {availableShifts.map(shift => (
              <option key={shift.id} value={shift.id}>
                {shift.name} ({shift.startTime}–{shift.endTime})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { setSelectedShiftId(pendingShiftId); setChoosingShift(false); }}
            className="m3-btn-filled"
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={() => setChoosingShift(false)}
            className="m3-btn-text"
          >
            Cancelar
          </button>
        </div>
      )}

      <button
        onClick={() => onConfirm(selectedShiftId)}
        className="m3-btn-filled"
      >
        Confirmar
      </button>
    </div>
  );
}

interface SessionCardProps {
  session: TasSession;
  confirmed: boolean;
  onConfirm: (resolvedStart: string, resolvedEnd: string) => void;
}

function SessionCard({ session, confirmed, onConfirm }: SessionCardProps) {
  const [entry, setEntry] = useState(toHHMM(session.effectiveStart));
  const [exit,  setExit]  = useState(toHHMM(session.lastScan));

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
              {flagLabel(f, session)}
            </span>
          ))}
        </div>
      </div>

      {session.scans.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {session.scans.map((s, i) => (
            <span key={i} className="px-2 py-1 rounded-shape-sm bg-surface-container text-body-sm text-on-surface-variant">
              {toHHMM(s)}
            </span>
          ))}
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
        onClick={() => onConfirm(entry, exit)}
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
  const setResolvedRowCount      = useTasStore(s => s.setResolvedRowCount);
  const setResolvedRows          = useTasStore(s => s.setResolvedRows);
  const setUsedFallbackHolidays  = useTasStore(s => s.setUsedFallbackHolidays);
  const setFlaggedSessions    = useTasStore(s => s.setFlaggedSessions);
  const setUploadToken        = useTasStore(s => s.setUploadToken);
  const setError              = useTasStore(s => s.setError);
  const availablePeriods      = useTasStore(s => s.availablePeriods);
  const selectedPeriod        = useTasStore(s => s.selectedPeriod);
  const setSelectedPeriod     = useTasStore(s => s.setSelectedPeriod);
  const setAvailablePeriods   = useTasStore(s => s.setAvailablePeriods);
  const availableShifts    = useTasStore(s => s.availableShifts);
  const setAvailableShifts  = useTasStore(s => s.setAvailableShifts);
  const shiftAcceptances    = useTasStore(s => s.shiftAcceptances);
  const setShiftAcceptance  = useTasStore(s => s.setShiftAcceptance);

  const [activeFilter, setActiveFilter] = useState<FilterChip>('all');

  const needsResolutionSessions = flaggedSessions.filter(
    s => s.needsResolution && periodsEqual(getSessionPeriod(s.date), selectedPeriod),
  );
  const confirmedCount  = Object.keys(resolvedSessions).length + Object.keys(shiftAcceptances).length;
  const totalToResolve  = needsResolutionSessions.length;
  const pendingCount    = totalToResolve - confirmedCount;

  const filtered = needsResolutionSessions.filter(s => sessionMatchesFilter(s, activeFilter));
  const shiftMismatchOnly = filtered.filter(s => s.flags.length === 1 && s.flags[0] === 'SHIFT_MISMATCH');
  const regular = filtered.filter(s => !shiftMismatchOnly.includes(s));

  const chipCounts = {
    all:           needsResolutionSessions.length,
    missing_entry: needsResolutionSessions.filter(s => s.flags.includes('MISSING_ENTRY')).length,
    missing_exit:  needsResolutionSessions.filter(s => s.flags.includes('MISSING_EXIT')).length,
    shift_mismatch: needsResolutionSessions.filter(s => s.flags.includes('SHIFT_MISMATCH')).length,
    cutoff:        needsResolutionSessions.filter(s => s.flags.includes('START_CUTOFF') || s.flags.includes('END_CUTOFF')).length,
  };

  const allConfirmed = pendingCount === 0;

  const handleSubmit = async () => {
    if (!uploadToken) return;
    try {
      const resolutions: TasResolution[] = [
        ...Object.entries(resolvedSessions).map(([id, entry]) => ({
          sessionId: Number(id),
          resolvedStart: entry.resolvedStart,
          resolvedEnd:   entry.resolvedEnd,
        })),
        ...Object.entries(shiftAcceptances).map(([id, acceptedShiftId]) => ({
          sessionId: Number(id),
          acceptedShiftId,
        })),
      ];
      const result = await resolveVerification(uploadToken, resolutions, selectedPeriod);
      const stillNeedsResolution = result.flaggedSessions.some(
        s => s.needsResolution && periodsEqual(getSessionPeriod(s.date), selectedPeriod),
      );
      if (stillNeedsResolution) {
        clearResolvedSessions();
        setFlaggedSessions(result.flaggedSessions);
        setUploadToken(result.uploadToken);
        setAvailablePeriods(result.availablePeriods ?? []);
        setAvailableShifts(result.availableShifts ?? []);
        return;
      }
      setFlaggedSessions(result.flaggedSessions);
      setUploadToken(result.uploadToken);
      setResolvedRowCount(result.resolvedRows?.length ?? 0);
      setResolvedRows(result.resolvedRows ?? []);
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      setAvailablePeriods(result.availablePeriods ?? []);
      setAvailableShifts(result.availableShifts ?? []);
      setTasView('review');
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

        {availablePeriods.length > 1 && (
          <div className="flex flex-col gap-1 mb-2">
            <label htmlFor="period-select" className="text-label-sm text-on-surface-variant">Periodo</label>
            <select
              id="period-select"
              aria-label="Periodo"
              value={selectedPeriod ? periodKey(selectedPeriod) : ''}
              onChange={e => {
                const period = availablePeriods.find(p => periodKey(p) === e.target.value);
                if (period) setSelectedPeriod(period);
              }}
              className="h-9 px-3 rounded-shape-sm border border-outline bg-white text-body-md focus:outline-none focus:border-primary"
            >
              {availablePeriods.map(p => (
                <option key={periodKey(p)} value={periodKey(p)}>{periodLabel(p)}</option>
              ))}
            </select>
          </div>
        )}

        <p className="text-body-sm text-on-surface-variant mb-4">
          Solo se enviará el periodo seleccionado. Para procesar otros periodos, vuelva a cargar el archivo.
        </p>

        {totalToResolve === 0 ? (
          <div className="rounded-shape-md border border-outline-variant bg-white px-4 py-6 text-center">
            <p className="text-body-md text-on-surface">
              ✓ Este periodo no presenta inconsistencias — los datos están completos y no requieren revisión manual. Puede continuar y enviar.
            </p>
          </div>
        ) : (
          <>
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

            {regular.map(session => (
              <SessionCard
                key={session.sessionId}
                session={session}
                confirmed={!!resolvedSessions[session.sessionId]}
                onConfirm={(resolvedStart, resolvedEnd) =>
                  setResolvedSession(session.sessionId, { resolvedStart, resolvedEnd })
                }
              />
            ))}

            {shiftMismatchOnly.map(session => (
              <ShiftMismatchCard
                key={session.sessionId}
                session={session}
                availableShifts={availableShifts}
                confirmed={shiftAcceptances[session.sessionId] !== undefined}
                onConfirm={(acceptedShiftId) => setShiftAcceptance(session.sessionId, acceptedShiftId)}
              />
            ))}
          </>
        )}
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
