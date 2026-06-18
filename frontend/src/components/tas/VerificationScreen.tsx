import { useEffect, useRef, useState } from 'react';
import { useTasStore } from '../../tasStore';
import { resolveVerification } from '../../tasApi';
import type { TasResolution } from '../../tasApi';
import { MONTH_NAMES_ES } from '../../dateNames';
import type { TasSession, TasFlag, TasPeriod, ShiftOption } from '../../tasTypes';
import AlertMessage from '../ui/AlertMessage';
import EmployeeGroup from './EmployeeGroup';
import { buildEmployeeGroups } from './verificationGrouping';

const FLAG_LABELS: Record<TasFlag, string> = {
  MISSING_ENTRY:   'Falta entrada',
  MISSING_EXIT:    'Falta salida',
  SHIFT_MISMATCH:  'Cambio de turno',
  SAME_DAY_DOUBLE: 'Doble marcación',
  START_CUTOFF:    'Corte de período',
  END_CUTOFF:      'Corte de período',
  BEST_FIT_SHIFT: 'Turno estimado',
  SHORT_DAY:       'Jornada corta',
};

const FLAG_COLORS: Record<TasFlag, string> = {
  MISSING_ENTRY:   'bg-red-100 text-red-700',
  MISSING_EXIT:    'bg-red-100 text-red-700',
  SHIFT_MISMATCH:  'bg-amber-100 text-amber-700',
  SAME_DAY_DOUBLE: 'bg-orange-100 text-orange-700',
  START_CUTOFF:    'bg-blue-100 text-blue-700',
  END_CUTOFF:      'bg-blue-100 text-blue-700',
  BEST_FIT_SHIFT: 'bg-surface-container text-on-surface-variant',
  SHORT_DAY:       'bg-amber-100 text-amber-700',
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

interface ShiftMismatchCardProps {
  session: TasSession;
  availableShifts: ShiftOption[];
  acceptedShiftId: string;
  onChange: (acceptedShiftId: string) => void;
}

function ShiftMismatchCard({ session, availableShifts, acceptedShiftId, onChange }: ShiftMismatchCardProps) {
  const [choosingShift, setChoosingShift] = useState(false);
  const [pendingShiftId, setPendingShiftId] = useState(acceptedShiftId);

  const selectedShift = availableShifts.find(s => s.id === acceptedShiftId);
  const selectedShiftName = selectedShift?.name ?? session.matchedShiftName ?? '';
  const selectedShiftTimes = selectedShift ? ` (${selectedShift.startTime}–${selectedShift.endTime})` : '';

  return (
    <div className="bg-white rounded-shape-md border border-outline-variant p-4 shadow-sm">
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
            onClick={() => { setPendingShiftId(acceptedShiftId); setChoosingShift(true); }}
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
            onClick={() => { onChange(pendingShiftId); setChoosingShift(false); }}
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

      <p className="text-label-sm text-on-surface-variant">
        Esta opción se aplicará automáticamente si no realiza ningún cambio.
      </p>
    </div>
  );
}

interface SameDayDoubleGroupCardProps {
  sessions: TasSession[];
  choice: number | 'all';
  onChange: (keepSessionId: number | 'all') => void;
}

function SameDayDoubleGroupCard({ sessions, choice, onChange }: SameDayDoubleGroupCardProps) {
  const first = sessions[0];

  return (
    <div className="bg-white rounded-shape-md border border-outline-variant p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium text-on-surface">{first.employeeName}</span>
        <span className="text-on-surface-variant text-body-sm">{formatDate(first.date)}</span>
        <span className={`text-label-sm px-2 py-0.5 rounded-full ${FLAG_COLORS.SAME_DAY_DOUBLE}`}>
          {FLAG_LABELS.SAME_DAY_DOUBLE}
        </span>
      </div>

      <div className="flex flex-col gap-2 mb-3">
        {sessions.map(session => (
          <label key={session.sessionId} className="flex items-center gap-2 text-body-sm text-on-surface cursor-pointer">
            <input
              type="radio"
              name={`same-day-double-${first.employeeId}-${first.date}`}
              checked={choice === session.sessionId}
              onChange={() => onChange(session.sessionId)}
            />
            {session.matchedShiftName ?? '—'} ({toHHMM(session.effectiveStart)}–{toHHMM(session.lastScan)}) — marcaciones:{' '}
            {session.scans.map(toHHMM).join(', ')}
          </label>
        ))}
        <label className="flex items-center gap-2 text-body-sm text-on-surface cursor-pointer">
          <input
            type="radio"
            name={`same-day-double-${first.employeeId}-${first.date}`}
            checked={choice === 'all'}
            onChange={() => onChange('all')}
          />
          Mantener todas
        </label>
      </div>

      <p className="text-label-sm text-on-surface-variant">
        Esta opción se aplicará automáticamente si no realiza ningún cambio.
      </p>
    </div>
  );
}

interface ShortDayCardProps {
  session: TasSession;
  onSaveOverride: (resolvedStart: string, resolvedEnd: string) => void;
}

function ShortDayCard({ session, onSaveOverride }: ShortDayCardProps) {
  const originalExit = toHHMM(session.lastScan);
  const [exit, setExit] = useState(originalExit);
  const changed = !!exit && exit !== originalExit;

  return (
    <div className="bg-white rounded-shape-md border border-outline-variant p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium text-on-surface">{session.employeeName}</span>
        <span className="text-on-surface-variant text-body-sm">{formatDate(session.date)}</span>
        <span className={`text-label-sm px-2 py-0.5 rounded-full ${FLAG_COLORS['SHORT_DAY']}`}>
          {FLAG_LABELS['SHORT_DAY']}
        </span>
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
            value={toHHMM(session.effectiveStart)}
            readOnly
            aria-label="Entrada"
            className="h-9 px-3 rounded-shape-sm border border-outline-variant bg-surface-container text-body-md text-on-surface-variant cursor-default"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-label-sm text-on-surface-variant">Salida</label>
          <input
            type="time"
            value={exit}
            onChange={e => setExit(e.target.value)}
            aria-label="Salida"
            className="h-9 px-3 rounded-shape-sm border border-outline bg-white text-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {changed && (
        <button
          onClick={() => onSaveOverride(toHHMM(session.effectiveStart), exit)}
          className="m3-btn-filled"
        >
          Registrar corrección
        </button>
      )}
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
  const [exit,  setExit]  = useState(session.flags.includes('MISSING_EXIT') ? '' : toHHMM(session.lastScan));

  const needsEntry = session.flags.includes('MISSING_ENTRY');
  const needsExit  = session.flags.includes('MISSING_EXIT');
  const entryReadOnly = !needsEntry && !!session.effectiveStart;
  const exitReadOnly  = !needsExit  && !!session.lastScan;

  const hoursPreview = calcHours(entry, exit);
  const timesInverted = !!entry && !!exit && hoursPreview === '—';
  const canConfirm = (!needsEntry || !!entry) && (!needsExit || !!exit) && !timesInverted;

  if (confirmed) {
    return (
      <div className="border-l-4 border-green-500 bg-white rounded-shape-md px-4 py-3 flex items-center gap-4 shadow-sm">
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
    <div className="bg-white rounded-shape-md border border-outline-variant p-4 shadow-sm">
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
          {/* onInput fires on AM/PM spinner clicks where onChange does not */}
          <input
            type="time"
            value={entry}
            onChange={e => setEntry(e.target.value)}
            onInput={e => setEntry((e.target as HTMLInputElement).value)}
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
            onInput={e => setExit((e.target as HTMLInputElement).value)}
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

      {timesInverted && (
        <p className="text-body-sm text-error mb-2">La entrada debe ser antes de la salida</p>
      )}

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
  const setSessionSummaries      = useTasStore(s => s.setSessionSummaries);
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
  const sameDayDoubleResolutions    = useTasStore(s => s.sameDayDoubleResolutions);
  const setSameDayDoubleResolution  = useTasStore(s => s.setSameDayDoubleResolution);
  const error                       = useTasStore(s => s.error);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, []);

  // Inverts the computed default expansion for an employeeId (not an absolute
  // expanded/collapsed state), so a manual toggle doesn't permanently "stick"
  // once the underlying default changes (e.g. a group auto-collapses on resolve).
  const [expansionOverrides, setExpansionOverrides] = useState<Set<string>>(new Set());

  const needsResolutionSessions = flaggedSessions.filter(
    s => s.needsResolution && periodsEqual(getSessionPeriod(s.date), selectedPeriod),
  );
  const sameDayDoubleSessions = needsResolutionSessions.filter(s => s.flags.includes('SAME_DAY_DOUBLE'));
  const allShiftMismatchOnly = needsResolutionSessions.filter(
    s => !sameDayDoubleSessions.includes(s) && s.flags.length === 1 && s.flags[0] === 'SHIFT_MISMATCH',
  );
  const regular = needsResolutionSessions.filter(
    s => !sameDayDoubleSessions.includes(s) && !allShiftMismatchOnly.includes(s),
  );

  const shortDaySessions = flaggedSessions.filter(
    s => !s.needsResolution && s.flags.includes('SHORT_DAY') && periodsEqual(getSessionPeriod(s.date), selectedPeriod),
  );

  const sameDayDoubleGroups = new Map<string, TasSession[]>();
  for (const session of sameDayDoubleSessions) {
    const key = `${session.employeeId}|${session.date}`;
    const group = sameDayDoubleGroups.get(key) ?? [];
    group.push(session);
    sameDayDoubleGroups.set(key, group);
  }

  const rawGroups = buildEmployeeGroups(regular, allShiftMismatchOnly, sameDayDoubleGroups, resolvedSessions, sameDayDoubleResolutions);

  // Freeze the initial sort order so that resolving an employee's items doesn't
  // move their group to the bottom of the list mid-session. Reset when the
  // selected period changes so each period gets its own clean initial order.
  const groupOrderRef = useRef<string[]>([]);
  const activePeriodRef = useRef<string | null>(null);
  const currentPeriodKey = selectedPeriod ? periodKey(selectedPeriod) : null;
  if (activePeriodRef.current !== currentPeriodKey) {
    activePeriodRef.current = currentPeriodKey;
    groupOrderRef.current = [];
  }
  if (groupOrderRef.current.length === 0 && rawGroups.length > 0) {
    groupOrderRef.current = rawGroups.map(g => g.employeeId);
  } else {
    const known = new Set(groupOrderRef.current);
    const added = rawGroups.map(g => g.employeeId).filter(id => !known.has(id));
    if (added.length > 0) groupOrderRef.current = [...groupOrderRef.current, ...added];
  }
  const employeeGroups = groupOrderRef.current.length > 0
    ? groupOrderRef.current
        .map(id => rawGroups.find(g => g.employeeId === id))
        .filter((g): g is (typeof rawGroups)[number] => g !== undefined)
    : rawGroups;

  const totalToResolve = needsResolutionSessions.length;
  const pendingCount   = employeeGroups.reduce((sum, g) => sum + g.pendingCount, 0);
  const allConfirmed   = pendingCount === 0;

  const toggleGroup = (employeeId: string) => {
    setExpansionOverrides(prev => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!uploadToken) return;
    setError(null);
    try {
      const sessionDateById = new Map(flaggedSessions.map(s => [s.sessionId, s.date]));
      const resolutions: TasResolution[] = [
        ...Object.entries(resolvedSessions).map(([id, entry]) => {
          const date = sessionDateById.get(Number(id)) ?? '';
          return {
            sessionId: Number(id),
            resolvedStart: `${date} ${entry.resolvedStart}`,
            resolvedEnd:   `${date} ${entry.resolvedEnd}`,
          };
        }),
        ...allShiftMismatchOnly.map(session => ({
          sessionId: session.sessionId,
          acceptedShiftId: shiftAcceptances[session.sessionId] ?? session.matchedShiftId ?? '',
        })),
        ...Array.from(sameDayDoubleGroups.keys()).map(groupKey => {
          const [employeeId, date] = groupKey.split('|');
          return { employeeId, date, keepSessionId: sameDayDoubleResolutions[groupKey] ?? 'all' };
        }),
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
      setSessionSummaries(result.sessionSummaries ?? {});
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      setAvailablePeriods(result.availablePeriods ?? []);
      setAvailableShifts(result.availableShifts ?? []);
      setTasView('review');
    } catch {
      setTasView('verification');
      setError('Ocurrió un error al enviar. Intente nuevamente.');
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-6">
        <h2 className="text-headline-sm font-medium text-on-surface mb-4">
          Verificación de marcaciones
        </h2>

        {error && <AlertMessage message={error} />}

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

        {allConfirmed && totalToResolve > 0 && (
          <div className="flex items-center gap-2 rounded-shape-md border border-green-300 bg-green-50 px-4 py-3 mb-4 text-body-sm font-medium text-green-700">
            ✓ Todos los grupos están resueltos — puede continuar y enviar.
          </div>
        )}

        {totalToResolve === 0 ? (
          <div className="rounded-shape-md border border-outline-variant bg-white px-4 py-6 text-center">
            <p className="text-body-md text-on-surface">
              ✓ Este periodo no presenta inconsistencias — los datos están completos y no requieren revisión manual. Puede continuar y enviar.
            </p>
          </div>
        ) : (
          employeeGroups.map(group => {
            const defaultExpanded = group.pendingCount > 0;
            const expanded = expansionOverrides.has(group.employeeId) ? !defaultExpanded : defaultExpanded;
            return (
              <EmployeeGroup
                key={group.employeeId}
                employeeName={group.employeeName}
                pendingCount={group.pendingCount}
                expanded={expanded}
                onToggle={() => toggleGroup(group.employeeId)}
              >
                {group.items.map(item => {
                  switch (item.type) {
                    case 'session':
                      return (
                        <SessionCard
                          key={item.session.sessionId}
                          session={item.session}
                          confirmed={!!resolvedSessions[item.session.sessionId]}
                          onConfirm={(resolvedStart, resolvedEnd) =>
                            setResolvedSession(item.session.sessionId, { resolvedStart, resolvedEnd })
                          }
                        />
                      );
                    case 'shift_mismatch':
                      return (
                        <ShiftMismatchCard
                          key={item.session.sessionId}
                          session={item.session}
                          availableShifts={availableShifts}
                          acceptedShiftId={shiftAcceptances[item.session.sessionId] ?? item.session.matchedShiftId ?? ''}
                          onChange={(acceptedShiftId) => setShiftAcceptance(item.session.sessionId, acceptedShiftId)}
                        />
                      );
                    case 'same_day_double':
                      return (
                        <SameDayDoubleGroupCard
                          key={item.groupKey}
                          sessions={item.sessions}
                          choice={sameDayDoubleResolutions[item.groupKey] ?? 'all'}
                          onChange={(keepSessionId) => setSameDayDoubleResolution(item.groupKey, keepSessionId)}
                        />
                      );
                  }
                })}
              </EmployeeGroup>
            );
          })
        )}

        {shortDaySessions.length > 0 && (
          <div className="mt-4">
            <h3 className="text-title-sm font-medium text-on-surface mb-2">Jornadas cortas</h3>
            <div className="flex flex-col gap-3">
              {shortDaySessions.map(session => (
                <ShortDayCard
                  key={session.sessionId}
                  session={session}
                  onSaveOverride={(resolvedStart, resolvedEnd) =>
                    setResolvedSession(session.sessionId, { resolvedStart, resolvedEnd })
                  }
                />
              ))}
            </div>
          </div>
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
          className={
            allConfirmed && totalToResolve > 0
              ? 'm3-btn-filled !bg-green-700 !text-white'
              : 'm3-btn-filled disabled:opacity-40 disabled:cursor-not-allowed'
          }
        >
          {allConfirmed && totalToResolve > 0 ? '✓ Revisar' : 'Revisar'}
        </button>
      </div>
    </div>
  );
}
