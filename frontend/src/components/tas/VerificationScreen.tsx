import { useEffect, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { useTasStore, type ResolvedSessionEntry } from '../../tasStore';
import { resolveVerification } from '../../tasApi';
import type { TasResolution } from '../../tasApi';
import { MONTH_NAMES_ES } from '../../dateNames';
import type { TasSession, TasFlag, TasPeriod, ShiftOption, DoubleChoice } from '../../tasTypes';
import { useToastStore } from '../../toastStore';
import AlertMessage from '../ui/AlertMessage';
import EmployeeGroup from './EmployeeGroup';
import { buildEmployeeGroups, keptSessions, needsTimes } from './verificationGrouping';

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
  MISSING_ENTRY:   'bg-error-container text-on-error-container',
  MISSING_EXIT:    'bg-error-container text-on-error-container',
  SHIFT_MISMATCH:  'bg-warning-container text-on-warning-container',
  SAME_DAY_DOUBLE: 'bg-warning-container text-on-warning-container',
  START_CUTOFF:    'bg-primary-container text-on-primary-container',
  END_CUTOFF:      'bg-primary-container text-on-primary-container',
  BEST_FIT_SHIFT:  'bg-surface-container text-on-surface-variant',
  SHORT_DAY:       'bg-warning-container text-on-warning-container',
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

const MAX_SWAPPED_SPAN_MINUTES = 16 * 60;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const HIGHLIGHT_RING = 'ring-2 ring-error';

function useHighlightScroll(highlighted: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView?.({ block: 'center' });
  }, [highlighted]);
  return ref;
}

function isoDateOf(timestamp: string | null | undefined): string | null {
  return timestamp && /^\d{4}-\d{2}-\d{2}T/.test(timestamp) ? timestamp.slice(0, 10) : null;
}

function shiftIsoDate(date: string, days: number): string {
  if (days === 0 || !date) return date;
  const [y, m, d] = date.split('-').map(Number);
  const nd = new Date(y, m - 1, d + days);
  return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
}

function calcHours(entry: string, exit: string, crossMidnight: boolean): string {
  if (!entry || !exit) return '—';
  const [eh, em] = entry.split(':').map(Number);
  const [xh, xm] = exit.split(':').map(Number);
  const entryMin = eh * 60 + em;
  const exitMin  = xh * 60 + xm;
  let diff = exitMin - entryMin;
  if (diff <= 0) {
    if (!crossMidnight) return '—';
    diff += 1440;
  }
  const hours = Math.floor(diff / 30) / 2;
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
    <div className="bg-surface-container-lowest rounded-shape-md border border-outline-variant p-4 shadow-sm">
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

      <div className="mb-3 rounded-shape-md border border-success bg-success-container px-3 py-2 text-body-sm">
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
            className="h-9 px-3 rounded-shape-sm border border-outline bg-surface-container-lowest text-body-md focus:outline-none focus:border-primary"
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

interface MergedDay {
  sessionId: number;
  start: string;
  end: string;
}

// Two lone scans on one day (07:08 and 22:03) are usually one long day the grouper split, or an
// entry whose exit was missed: offer them as one day from the first scan to the last.
function mergeableDay(sessions: TasSession[]): MergedDay | null {
  if (sessions.length !== 2 || !sessions.every(s => s.scans.length === 1 && needsTimes(s))) return null;
  const [first, last] = [...sessions].sort((x, y) => x.scans[0].localeCompare(y.scans[0]));
  const spanMinutes = (new Date(last.scans[0]).getTime() - new Date(first.scans[0]).getTime()) / 60_000;
  if (spanMinutes <= 0 || spanMinutes > MAX_SWAPPED_SPAN_MINUTES) return null;
  return { sessionId: first.sessionId, start: toHHMM(first.scans[0]), end: toHHMM(last.scans[0]) };
}

function mergedDay(
  sessions: TasSession[], choice: DoubleChoice | undefined, resolvedSessions: Record<number, ResolvedSessionEntry>,
): MergedDay | null {
  const day = mergeableDay(sessions);
  const times = day ? resolvedSessions[day.sessionId] : undefined;
  return day && choice === day.sessionId && times?.resolvedStart === day.start && times?.resolvedEnd === day.end
    ? day
    : null;
}

interface SameDayDoubleGroupCardProps {
  sessions: TasSession[];
  choice: DoubleChoice;
  decided: boolean;
  resolvedSessions: Record<number, ResolvedSessionEntry>;
  renderSessionCard: (session: TasSession) => ReactNode;
  onChange: (keepSessionId: DoubleChoice) => void;
  onMerge: (day: MergedDay) => void;
}

function SameDayDoubleGroupCard({
  sessions, choice, decided, resolvedSessions, renderSessionCard, onChange, onMerge,
}: SameDayDoubleGroupCardProps) {
  const first = sessions[0];
  const [editing, setEditing] = useState(false);
  const mergeable = mergeableDay(sessions);
  const merged = !!mergedDay(sessions, choice, resolvedSessions);
  const needingTimes = merged ? [] : keptSessions(sessions, choice).filter(needsTimes);
  const timesMissing = needingTimes.some(s => !resolvedSessions[s.sessionId]);

  if (decided && !timesMissing && !editing) {
    const kept = choice === 'all' ? null : sessions.find(s => s.sessionId === choice);
    const summary = merged
      ? `Una sola jornada (${mergeable?.start}–${mergeable?.end})`
      : kept
        ? `${kept.matchedShiftName ?? '—'} (${toHHMM(kept.effectiveStart)}–${toHHMM(kept.lastScan)})`
        : 'Mantener todas';
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Editar ${first.employeeName} ${formatDate(first.date)}`}
        className="w-full text-left border-l-4 border-success bg-surface-container-lowest rounded-shape-md px-4 py-3 flex items-center gap-4 shadow-sm hover:bg-surface-container transition-colors"
      >
        <div className="flex-1">
          <span className="font-medium text-on-surface">{first.employeeName}</span>
          <span className="mx-2 text-on-surface-variant">·</span>
          <span className="text-on-surface-variant text-body-sm">{formatDate(first.date)}</span>
          <span className="mx-2 text-on-surface-variant">·</span>
          <span className="text-on-surface-variant text-body-sm">{summary}</span>
        </div>
        <span className="text-success text-body-sm font-medium">Confirmado</span>
        <span className="text-primary text-label-sm">Editar</span>
      </button>
    );
  }

  const radioName = `same-day-double-${first.employeeId}-${first.date}`;
  return (
    <div className="bg-surface-container-lowest rounded-shape-md border border-outline-variant p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium text-on-surface">{first.employeeName}</span>
        <span className="text-on-surface-variant text-body-sm">{formatDate(first.date)}</span>
        <span className={`text-label-sm px-2 py-0.5 rounded-full ${FLAG_COLORS.SAME_DAY_DOUBLE}`}>
          {FLAG_LABELS.SAME_DAY_DOUBLE}
        </span>
      </div>

      {mergeable && (
        <p className="text-body-sm text-on-surface-variant mb-2">
          Cada marcación está sola: falta la otra marcación de cada jornada.
        </p>
      )}

      <div className="flex flex-col gap-2 mb-3">
        {mergeable && (
          <label className="flex items-center gap-2 text-body-sm text-on-surface cursor-pointer">
            <input type="radio" name={radioName} checked={merged} onChange={() => onMerge(mergeable)} />
            Una sola jornada ({mergeable.start} – {mergeable.end})
          </label>
        )}
        {sessions.map(session => (
          <label key={session.sessionId} className="flex items-center gap-2 text-body-sm text-on-surface cursor-pointer">
            <input
              type="radio"
              name={radioName}
              checked={choice === session.sessionId && !merged}
              onChange={() => onChange(session.sessionId)}
            />
            {session.matchedShiftName ?? '—'} ({toHHMM(session.effectiveStart)}–{toHHMM(session.lastScan)}) — marcaciones:{' '}
            {session.scans.map(toHHMM).join(', ')}
          </label>
        ))}
        <label className="flex items-center gap-2 text-body-sm text-on-surface cursor-pointer">
          <input type="radio" name={radioName} checked={choice === 'all'} onChange={() => onChange('all')} />
          Mantener todas
        </label>
      </div>

      {needingTimes.length > 0 && (
        <div className="flex flex-col gap-3 mb-3">
          {needingTimes.map(session => (
            <div key={session.sessionId}>{renderSessionCard(session)}</div>
          ))}
        </div>
      )}

      {editing && !timesMissing ? (
        <button type="button" onClick={() => setEditing(false)} className="m3-btn-filled">
          Listo
        </button>
      ) : needingTimes.length === 0 && (
        <p className="text-label-sm text-on-surface-variant">
          Esta opción se aplicará automáticamente si no realiza ningún cambio.
        </p>
      )}
    </div>
  );
}

interface ShortDayCardProps {
  session: TasSession;
  crossMidnight: boolean;
  registered?: ResolvedSessionEntry;
  highlighted: boolean;
  onSaveOverride: (resolvedStart: string, resolvedEnd: string) => void;
  onUndo: () => void;
}

function ShortDayCard({ session, crossMidnight, registered, highlighted, onSaveOverride, onUndo }: ShortDayCardProps) {
  const originalExit = toHHMM(session.lastScan);
  const entry = toHHMM(session.effectiveStart);
  const [exit, setExit] = useState(registered?.resolvedEnd ?? originalExit);
  const ref = useHighlightScroll(highlighted);
  const changed = !!exit && exit !== (registered?.resolvedEnd ?? originalExit);
  const inverted = !!entry && !!exit && calcHours(entry, exit, crossMidnight) === '—';

  const undo = () => {
    setExit(originalExit);
    onUndo();
  };

  return (
    <div ref={ref} className={`bg-surface-container-lowest rounded-shape-md border border-outline-variant p-4 shadow-sm ${highlighted ? HIGHLIGHT_RING : ''}`}>
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
            lang="en-US"
            value={entry}
            readOnly
            aria-label="Entrada"
            className="h-9 px-3 rounded-shape-sm border border-outline-variant bg-surface-container text-body-md text-on-surface-variant cursor-default"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-label-sm text-on-surface-variant">Salida</label>
          <input
            type="time"
            lang="en-US"
            value={exit}
            onChange={e => setExit(e.target.value)}
            aria-label="Salida"
            className="h-9 px-3 rounded-shape-sm border border-outline bg-surface-container-lowest text-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {inverted && (
        <p role="alert" className="text-error text-body-sm mb-3">
          La hora de salida debe ser posterior a la hora de entrada.
        </p>
      )}

      {registered && !changed && (
        <div className="flex items-center gap-3">
          <span className="text-success text-body-sm font-medium">Corrección registrada · Salida {registered.resolvedEnd}</span>
          <button type="button" onClick={undo} className="m3-btn-text">
            Deshacer
          </button>
        </div>
      )}

      {changed && (
        <p className="text-on-surface-variant text-body-sm mb-2">
          {registered
            ? `Cambio sin registrar: se enviará la salida registrada ${registered.resolvedEnd}.`
            : 'Cambio sin registrar: haga clic en "Registrar corrección" para aplicarlo.'}
        </p>
      )}

      {changed && (
        <button
          onClick={() => onSaveOverride(entry, exit)}
          disabled={inverted}
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
  resolved?: { resolvedStart: string; resolvedEnd: string };
  crossMidnight: boolean;
  highlighted: boolean;
  onConfirm: (resolvedStart: string, resolvedEnd: string, offsets?: Pick<ResolvedSessionEntry, 'startDayOffset' | 'endDayOffset'>) => void;
}

function SessionCard({ session, confirmed, resolved, crossMidnight, highlighted, onConfirm }: SessionCardProps) {
  const ref = useHighlightScroll(highlighted);
  // Prefill from the stored resolution (so re-opening a confirmed row shows what
  // was entered, even after the group collapsed and re-mounted the card).
  const [entry, setEntry] = useState(resolved?.resolvedStart ?? toHHMM(session.effectiveStart));
  const [exit,  setExit]  = useState(resolved?.resolvedEnd ?? (session.flags.includes('MISSING_EXIT') ? '' : toHHMM(session.lastScan)));
  const [editing, setEditing] = useState(false);

  // A single scan is classified as entry or exit by its distance to the shift's
  // start/end; when that guess is wrong the user can swap which side it fills.
  const originallyNeedsEntry = session.flags.includes('MISSING_ENTRY');
  const originallyNeedsExit  = session.flags.includes('MISSING_EXIT');
  const recordedTime = originallyNeedsEntry !== originallyNeedsExit
    ? toHHMM(originallyNeedsEntry ? session.lastScan : session.effectiveStart)
    : '';
  const canSwap = !!recordedTime && session.scans.length === 1;
  const [swapped, setSwapped] = useState(() =>
    canSwap && !!resolved
      && (originallyNeedsEntry ? resolved.resolvedStart === recordedTime : resolved.resolvedEnd === recordedTime));

  const needsEntry = swapped ? originallyNeedsExit : originallyNeedsEntry;
  const needsExit  = swapped ? originallyNeedsEntry : originallyNeedsExit;
  const entryReadOnly = canSwap ? !needsEntry : !needsEntry && !!session.effectiveStart;
  const exitReadOnly  = canSwap ? !needsExit  : !needsExit  && !!session.lastScan;

  const swap = () => {
    const next = !swapped;
    const recordedOnEntry = next ? originallyNeedsEntry : originallyNeedsExit;
    setEntry(recordedOnEntry ? recordedTime : '');
    setExit(recordedOnEntry ? '' : recordedTime);
    setSwapped(next);
  };

  const displayFlagLabel = (flag: TasFlag): string => {
    if (!swapped || (flag !== 'MISSING_ENTRY' && flag !== 'MISSING_EXIT')) return flagLabel(flag, session);
    return flag === 'MISSING_ENTRY'
      ? `${FLAG_LABELS.MISSING_EXIT} · Entrada ${recordedTime}`
      : `${FLAG_LABELS.MISSING_ENTRY} · Salida ${recordedTime}`;
  };

  // A swapped day is anchored on the recorded scan's real date, so it may cross
  // midnight whatever the (possibly misread) matched shift says, up to a sane span.
  const overnight = swapped && !!entry && !!exit && toMinutes(exit) <= toMinutes(entry);
  const swappedSpanTooLong = overnight && toMinutes(exit) + 1440 - toMinutes(entry) > MAX_SWAPPED_SPAN_MINUTES;
  const hoursPreview = swappedSpanTooLong ? '—' : calcHours(entry, exit, swapped || crossMidnight);
  const timesInverted = !!entry && !!exit && hoursPreview === '—';

  const confirm = () => {
    if (!swapped) {
      onConfirm(entry, exit);
      return;
    }
    onConfirm(entry, exit, originallyNeedsEntry
      ? { startDayOffset: 0, endDayOffset: overnight ? 1 : 0 }
      : { startDayOffset: overnight ? -1 : 0, endDayOffset: 0 });
  };
  const canConfirm = (!needsEntry || !!entry) && (!needsExit || !!exit) && !timesInverted;

  if (confirmed && !editing && !highlighted) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Editar ${session.employeeName} ${formatDate(session.date)}`}
        className="w-full text-left border-l-4 border-success bg-surface-container-lowest rounded-shape-md px-4 py-3 flex items-center gap-4 shadow-sm hover:bg-surface-container transition-colors"
      >
        <div className="flex-1">
          <span className="font-medium text-on-surface">{session.employeeName}</span>
          <span className="mx-2 text-on-surface-variant">·</span>
          <span className="text-on-surface-variant text-body-sm">{formatDate(session.date)}</span>
        </div>
        <span className="text-success text-body-sm font-medium">Confirmado</span>
        <span className="text-primary text-label-sm">Editar</span>
      </button>
    );
  }

  return (
    <div ref={ref} className={`bg-surface-container-lowest rounded-shape-md border border-outline-variant p-4 shadow-sm ${highlighted ? HIGHLIGHT_RING : ''}`}>
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium text-on-surface">{session.employeeName}</span>
        <span className="text-on-surface-variant text-body-sm">{formatDate(session.date)}</span>
        <div className="flex gap-1 flex-wrap">
          {session.flags.map(f => (
            <span key={f} className={`text-label-sm px-2 py-0.5 rounded-full ${FLAG_COLORS[f]}`}>
              {displayFlagLabel(f)}
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
            lang="en-US"
            value={entry}
            onChange={e => setEntry(e.target.value)}
            onInput={e => setEntry((e.target as HTMLInputElement).value)}
            readOnly={entryReadOnly}
            aria-label="Entrada"
            className={`h-9 px-3 rounded-shape-sm border text-body-md focus:outline-none focus:border-primary transition-colors ${
              entryReadOnly
                ? 'bg-surface-container border-outline-variant text-on-surface-variant cursor-default'
                : 'bg-surface-container-lowest border-outline focus:ring-1 focus:ring-primary'
            }`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-label-sm text-on-surface-variant">Salida</label>
          <input
            type="time"
            lang="en-US"
            value={exit}
            onChange={e => setExit(e.target.value)}
            onInput={e => setExit((e.target as HTMLInputElement).value)}
            readOnly={exitReadOnly}
            aria-label="Salida"
            className={`h-9 px-3 rounded-shape-sm border text-body-md focus:outline-none focus:border-primary transition-colors ${
              exitReadOnly
                ? 'bg-surface-container border-outline-variant text-on-surface-variant cursor-default'
                : 'bg-surface-container-lowest border-outline focus:ring-1 focus:ring-primary'
            }`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-label-sm text-on-surface-variant">Horas calculadas</span>
          <span className="h-9 flex items-center text-body-md text-on-surface">
            {hoursPreview === '—' ? '—' : `Horas calculadas: ${hoursPreview}`}
          </span>
        </div>
        {canSwap && (
          <button
            type="button"
            onClick={swap}
            className="m3-btn-text h-9"
          >
            {swapped ? 'Deshacer intercambio' : 'Intercambiar entrada/salida'}
          </button>
        )}
      </div>

      {timesInverted && (
        <p className="text-body-sm text-error mb-2">
          {swappedSpanTooLong
            ? 'La jornada no puede durar más de 16 horas'
            : `La entrada debe ser antes de la salida${crossMidnight || swapped ? '' : ' (mismo día)'}`}
        </p>
      )}

      <button
        disabled={!canConfirm}
        onClick={() => { confirm(); setEditing(false); }}
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
  const setStateRevision      = useTasStore(s => s.setStateRevision);
  const availablePeriods      = useTasStore(s => s.availablePeriods);
  const selectedPeriod        = useTasStore(s => s.selectedPeriod);
  const setSelectedPeriod     = useTasStore(s => s.setSelectedPeriod);
  const setAvailablePeriods   = useTasStore(s => s.setAvailablePeriods);
  const availableShifts    = useTasStore(s => s.availableShifts);
  const setAvailableShifts  = useTasStore(s => s.setAvailableShifts);
  const shiftAcceptances    = useTasStore(s => s.shiftAcceptances);
  const setShiftAcceptance  = useTasStore(s => s.setShiftAcceptance);
  const sameDayDoubleResolutions    = useTasStore(s => s.sameDayDoubleResolutions);
  const clearResolvedSession        = useTasStore(s => s.clearResolvedSession);
  const setSameDayDoubleResolution  = useTasStore(s => s.setSameDayDoubleResolution);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, []);

  // Inverts the computed default expansion for an employeeId (not an absolute
  // expanded/collapsed state), so a manual toggle doesn't permanently "stick"
  // once the underlying default changes (e.g. a group auto-collapses on resolve).
  const [expansionOverrides, setExpansionOverrides] = useState<Set<string>>(new Set());
  const [highlightedSessionId, setHighlightedSessionId] = useState<number | null>(null);

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

  const rawGroups = buildEmployeeGroups(
    regular, allShiftMismatchOnly, sameDayDoubleGroups, resolvedSessions, sameDayDoubleResolutions);

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

  const renderSessionCard = (session: TasSession) => {
    const matchedShift = availableShifts.find(s => s.id === session.matchedShiftId);
    return (
      <SessionCard
        key={session.sessionId}
        session={session}
        confirmed={!!resolvedSessions[session.sessionId]}
        resolved={resolvedSessions[session.sessionId]}
        crossMidnight={matchedShift?.crossMidnight ?? session.crossMidnight}
        highlighted={highlightedSessionId === session.sessionId}
        onConfirm={(resolvedStart, resolvedEnd, offsets) => {
          setResolvedSession(session.sessionId, { resolvedStart, resolvedEnd, ...offsets });
          if (highlightedSessionId === session.sessionId) setHighlightedSessionId(null);
        }}
      />
    );
  };

  // Times typed for a half the user then discarded must not be sent: the backend refuses them.
  const discardedSessionIds = new Set<number>();
  for (const [groupKey, sessions] of sameDayDoubleGroups) {
    const kept = keptSessions(sessions, sameDayDoubleResolutions[groupKey]);
    for (const s of sessions) if (!kept.includes(s)) discardedSessionIds.add(s.sessionId);
  }

  const handleSubmit = async () => {
    if (!uploadToken) return;
    setHighlightedSessionId(null);
    const sessionById = new Map(flaggedSessions.map(s => [s.sessionId, s]));
    try {
      const resolutions: TasResolution[] = [
        // Only this period's times: the others go with their own period's choices, when it is sent.
        ...Object.entries(resolvedSessions).filter(([id]) => {
          const session = sessionById.get(Number(id));
          return !!session && periodsEqual(getSessionPeriod(session.date), selectedPeriod)
            && !discardedSessionIds.has(session.sessionId);
        }).map(([id, resolved]) => {
          const session = sessionById.get(Number(id));
          const date = session?.date ?? '';
          const matchedShift = availableShifts.find(s => s.id === session?.matchedShiftId);
          const isCrossMidnight = matchedShift?.crossMidnight ?? session?.crossMidnight ?? false;
          let startDate = date;
          let endDate = date;
          if (resolved.startDayOffset !== undefined || resolved.endDayOffset !== undefined) {
            startDate = shiftIsoDate(date, resolved.startDayOffset ?? 0);
            endDate   = shiftIsoDate(date, resolved.endDayOffset ?? 0);
          } else if (date) {
            const overnight = isCrossMidnight && toMinutes(resolved.resolvedEnd) <= toMinutes(resolved.resolvedStart);
            // Anchor on the recorded scan: a recorded night exit sits on the day after the shift started.
            const exitWasRecorded = !!session?.flags.includes('MISSING_ENTRY') && !session.flags.includes('MISSING_EXIT');
            const recordedExitDate = exitWasRecorded ? isoDateOf(session?.lastScan) : null;
            if (recordedExitDate) {
              endDate = recordedExitDate;
              startDate = overnight ? shiftIsoDate(recordedExitDate, -1) : recordedExitDate;
            } else {
              startDate = isoDateOf(session?.effectiveStart) ?? date;
              endDate = overnight ? shiftIsoDate(startDate, 1) : startDate;
            }
          }
          return {
            sessionId: Number(id),
            resolvedStart: `${startDate} ${resolved.resolvedStart}`,
            resolvedEnd:   `${endDate} ${resolved.resolvedEnd}`,
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
        setStateRevision(result.stateRevision);
        setAvailablePeriods(result.availablePeriods ?? []);
        setAvailableShifts(result.availableShifts ?? []);
        return;
      }
      setFlaggedSessions(result.flaggedSessions);
      setUploadToken(result.uploadToken);
      setStateRevision(result.stateRevision);
      setResolvedRowCount(result.resolvedRows?.length ?? 0);
      setResolvedRows(result.resolvedRows ?? []);
      setSessionSummaries(result.sessionSummaries ?? {});
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      setAvailablePeriods(result.availablePeriods ?? []);
      setAvailableShifts(result.availableShifts ?? []);
      setTasView('review');
    } catch (err) {
      setTasView('verification');
      const data = axios.isAxiosError(err) ? err.response?.data : undefined;
      const message = typeof data?.message === 'string' ? data.message : 'Ocurrió un error al enviar. Intente nuevamente.';
      const failed = typeof data?.sessionId === 'number' ? sessionById.get(data.sessionId) : undefined;
      if (failed) {
        const failedPeriod = getSessionPeriod(failed.date);
        if (!periodsEqual(failedPeriod, selectedPeriod)) setSelectedPeriod(failedPeriod);
        setExpansionOverrides(prev => {
          const next = new Set(prev);
          next.delete(failed.employeeId);
          return next;
        });
        setHighlightedSessionId(failed.sessionId);
        useToastStore.getState().showToast(
          `${message} Revise ${failed.employeeName}, ${formatDate(failed.date)}.`, 'error');
        return;
      }
      useToastStore.getState().showToast(message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-6">
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
              className="h-9 px-3 rounded-shape-sm border border-outline bg-surface-container-lowest text-body-md focus:outline-none focus:border-primary"
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
          <AlertMessage
            variant="success"
            message="Todos los grupos están resueltos — puede continuar y enviar."
            className="mb-4"
          />
        )}

        {totalToResolve === 0 ? (
          <div className="rounded-shape-md border border-outline-variant bg-surface-container-lowest px-4 py-6 text-center">
            <p className="text-body-md text-on-surface">
              ✓ Este periodo no presenta inconsistencias — los datos están completos y no requieren revisión manual. Puede continuar y enviar.
            </p>
          </div>
        ) : (
          employeeGroups.map(group => {
            const defaultExpanded = group.pendingCount > 0 || group.items.some(
              i => (i.type === 'same_day_double' && sameDayDoubleResolutions[i.groupKey] === undefined)
                || (i.type === 'session' && i.session.sessionId === highlightedSessionId),
            );
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
                      return renderSessionCard(item.session);
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
                          decided={sameDayDoubleResolutions[item.groupKey] !== undefined}
                          resolvedSessions={resolvedSessions}
                          renderSessionCard={renderSessionCard}
                          onChange={(keepSessionId) => {
                            const merged = mergedDay(item.sessions, sameDayDoubleResolutions[item.groupKey], resolvedSessions);
                            if (merged) clearResolvedSession(merged.sessionId);
                            setSameDayDoubleResolution(item.groupKey, keepSessionId);
                            const leavesTimesMissing = keptSessions(item.sessions, keepSessionId)
                              .some(s => needsTimes(s) && (!resolvedSessions[s.sessionId] || s.sessionId === merged?.sessionId));
                            // That choice reopens the group by default; drop a manual collapse so it doesn't close under the user.
                            if (leavesTimesMissing) {
                              setExpansionOverrides(prev => {
                                const next = new Set(prev);
                                next.delete(group.employeeId);
                                return next;
                              });
                            }
                          }}
                          onMerge={(day) => {
                            setSameDayDoubleResolution(item.groupKey, day.sessionId);
                            setResolvedSession(day.sessionId, { resolvedStart: day.start, resolvedEnd: day.end });
                          }}
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
                  crossMidnight={availableShifts.find(s => s.id === session.matchedShiftId)?.crossMidnight ?? session.crossMidnight}
                  registered={resolvedSessions[session.sessionId]}
                  highlighted={highlightedSessionId === session.sessionId}
                  onSaveOverride={(resolvedStart, resolvedEnd) => {
                    setResolvedSession(session.sessionId, { resolvedStart, resolvedEnd });
                    if (highlightedSessionId === session.sessionId) setHighlightedSessionId(null);
                  }}
                  onUndo={() => clearResolvedSession(session.sessionId)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-surface-container-lowest border-t border-outline-variant px-6 py-4 flex items-center justify-between">
        <div>
          {pendingCount > 0 && (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-error text-on-error text-label-md font-medium">
              {pendingCount} por resolver
            </span>
          )}
        </div>
        <button
          disabled={!allConfirmed}
          onClick={handleSubmit}
          className={
            allConfirmed && totalToResolve > 0
              ? 'm3-btn-filled !bg-success !text-on-success'
              : 'm3-btn-filled disabled:opacity-40 disabled:cursor-not-allowed'
          }
        >
          {allConfirmed && totalToResolve > 0 ? '✓ Revisar' : 'Revisar'}
        </button>
      </div>
    </div>
  );
}
