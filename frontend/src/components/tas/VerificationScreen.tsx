import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { useTasStore, type CardInput, type ResolvedSessionEntry } from '../../tasStore';
import { resolveVerification } from '../../tasApi';
import type { TasResolution } from '../../tasApi';
import { MONTH_NAMES_ES } from '../../dateNames';
import type { TasSession, TasFlag, TasPeriod, ShiftOption, DoubleChoice } from '../../tasTypes';
import { useToastStore } from '../../toastStore';
import { getGeneralConfig } from '../../configApi';
import { rememberSentDecisions } from '../../localCopy';
import AlertMessage from '../ui/AlertMessage';
import EmployeeGroup from './EmployeeGroup';
import IncompletePunchesDialog from './IncompletePunchesDialog';
import { blocksSending, buildEmployeeGroups, effectiveResolution, keptSessions, needsTimes, prefilledResolution } from './verificationGrouping';

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

// A typed day may last 16 hours, or the configured session span if that is longer; the backend
// applies the same rule.
const MIN_DAY_SPAN_LIMIT_MINUTES = 16 * 60;
const DaySpanLimit = createContext(MIN_DAY_SPAN_LIMIT_MINUTES);

function formatSpanHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} horas` : `${h}:${String(m).padStart(2, '0')} horas`;
}

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

function resolutionDates(
  session: TasSession, resolved: ResolvedSessionEntry, isCrossMidnight: boolean,
): { startDate: string; endDate: string } {
  const date = session.date;
  if (resolved.startDayOffset !== undefined || resolved.endDayOffset !== undefined) {
    return {
      startDate: shiftIsoDate(date, resolved.startDayOffset ?? 0),
      endDate: shiftIsoDate(date, resolved.endDayOffset ?? 0),
    };
  }
  const overnight = isCrossMidnight && toMinutes(resolved.resolvedEnd) <= toMinutes(resolved.resolvedStart);
  // Anchor on the recorded scan: a recorded night exit sits on the day after the shift started.
  const exitWasRecorded = session.flags.includes('MISSING_ENTRY') && !session.flags.includes('MISSING_EXIT');
  const recordedExitDate = exitWasRecorded ? isoDateOf(session.lastScan) : null;
  if (recordedExitDate) {
    return { startDate: overnight ? shiftIsoDate(recordedExitDate, -1) : recordedExitDate, endDate: recordedExitDate };
  }
  const startDate = isoDateOf(session.effectiveStart) ?? date;
  return { startDate, endDate: overnight ? shiftIsoDate(startDate, 1) : startDate };
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
            onClick={() => setChoosingShift(true)}
            className="ml-2 text-primary underline cursor-pointer"
          >
            Elegir otro turno
          </button>
        )}
      </div>

      {choosingShift && (
        <div className="mb-3 flex items-center gap-2">
          <select
            aria-label="Turno"
            value={acceptedShiftId}
            onChange={e => onChange(e.target.value)}
            className="h-9 px-3 rounded-shape-sm border border-outline bg-surface-container-lowest text-body-md focus:outline-none focus:border-primary"
          >
            {availableShifts.map(shift => (
              <option key={shift.id} value={shift.id}>
                {shift.name} ({shift.startTime}–{shift.endTime})
              </option>
            ))}
          </select>
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
function mergeableDay(sessions: TasSession[], spanLimit: number): MergedDay | null {
  if (sessions.length !== 2 || !sessions.every(s => s.scans.length === 1 && needsTimes(s))) return null;
  const [first, last] = [...sessions].sort((x, y) => x.scans[0].localeCompare(y.scans[0]));
  const spanMinutes = (new Date(last.scans[0]).getTime() - new Date(first.scans[0]).getTime()) / 60_000;
  if (spanMinutes <= 0 || spanMinutes > spanLimit) return null;
  return { sessionId: first.sessionId, start: toHHMM(first.scans[0]), end: toHHMM(last.scans[0]) };
}

function mergedDay(
  sessions: TasSession[], choice: DoubleChoice | undefined, resolvedSessions: Record<number, ResolvedSessionEntry>,
  spanLimit: number,
): MergedDay | null {
  const day = mergeableDay(sessions, spanLimit);
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
  cardInputs: Record<number, CardInput>;
  renderSessionCard: (session: TasSession) => ReactNode;
  onChange: (keepSessionId: DoubleChoice) => void;
  onMerge: (day: MergedDay) => void;
}

function SameDayDoubleGroupCard({
  sessions, choice, decided, resolvedSessions, cardInputs, renderSessionCard, onChange, onMerge,
}: SameDayDoubleGroupCardProps) {
  const first = sessions[0];
  const spanLimit = useContext(DaySpanLimit);
  const mergeable = mergeableDay(sessions, spanLimit);
  const merged = !!mergedDay(sessions, choice, resolvedSessions, spanLimit);
  const needingTimes = merged ? [] : keptSessions(sessions, choice).filter(needsTimes);
  const timesMissing = needingTimes.some(s => !effectiveResolution(s, resolvedSessions, cardInputs));
  // Folded when it opens already settled; once opened here it stays open while it is edited.
  const [open, setOpen] = useState(!(decided && !timesMissing));

  if (decided && !timesMissing && !open) {
    const kept = choice === 'all' ? null : sessions.find(s => s.sessionId === choice);
    const summary = merged
      ? `Una sola jornada (${mergeable?.start}–${mergeable?.end})`
      : kept
        ? `${kept.matchedShiftName ?? '—'} (${toHHMM(kept.effectiveStart)}–${toHHMM(kept.lastScan)})`
        : 'Mantener todas';
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
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
        <span className="text-success text-body-sm font-medium">Completo</span>
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

      {needingTimes.length === 0 && (
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
  input?: CardInput;
  registered?: ResolvedSessionEntry;
  highlighted: boolean;
  onInput: (input: CardInput, resolution: ResolvedSessionEntry | null) => void;
  onUndo: () => void;
}

// A corrected exit is stored as it is typed; a valid one replaces the recorded exit.
function ShortDayCard({ session, crossMidnight, input, registered, highlighted, onInput, onUndo }: ShortDayCardProps) {
  const originalExit = toHHMM(session.lastScan);
  const entry = toHHMM(session.effectiveStart);
  const exit = input?.exit ?? registered?.resolvedEnd ?? originalExit;
  const ref = useHighlightScroll(highlighted);
  const inverted = !!entry && !!exit && calcHours(entry, exit, crossMidnight) === '—';
  const unfinished = !!input && !registered;

  const setExit = (value: string) => {
    const valid = !!value && value !== originalExit && calcHours(entry, value, crossMidnight) !== '—';
    onInput({ entry, exit: value, swapped: false }, valid ? { resolvedStart: entry, resolvedEnd: value } : null);
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

      {unfinished && (
        <div className="flex items-center gap-3">
          <span className="text-error text-body-sm">
            Corrija la salida, o use Deshacer para dejar la marcada ({originalExit}).
          </span>
          <button type="button" onClick={onUndo} className="m3-btn-text">
            Deshacer
          </button>
        </div>
      )}

      {registered && (
        <div className="flex items-center gap-3">
          <span className="text-success text-body-sm font-medium">Corrección guardada · Salida {registered.resolvedEnd}</span>
          <button type="button" onClick={onUndo} className="m3-btn-text">
            Deshacer
          </button>
        </div>
      )}
    </div>
  );
}

interface CardView {
  needsEntry: boolean;
  needsExit: boolean;
  entryReadOnly: boolean;
  exitReadOnly: boolean;
  swappedSpanTooLong: boolean;
  hoursPreview: string;
  timesInverted: boolean;
  // The resolution these values amount to, or null while the card is incomplete or invalid.
  resolution: ResolvedSessionEntry | null;
}

// A single scan is classified as entry or exit by its distance to the shift's start/end; when that
// guess is wrong the user can swap which side it fills.
function swapInfo(session: TasSession) {
  const originallyNeedsEntry = session.flags.includes('MISSING_ENTRY');
  const originallyNeedsExit  = session.flags.includes('MISSING_EXIT');
  const recordedTime = originallyNeedsEntry !== originallyNeedsExit
    ? toHHMM(originallyNeedsEntry ? session.lastScan : session.effectiveStart)
    : '';
  const canSwap = !!recordedTime && session.scans.length === 1;
  return { originallyNeedsEntry, originallyNeedsExit, recordedTime, canSwap };
}

function evaluateCard(session: TasSession, crossMidnight: boolean, input: CardInput, spanLimit: number): CardView {
  const { entry, exit, swapped } = input;
  const { originallyNeedsEntry, originallyNeedsExit, canSwap } = swapInfo(session);
  const needsEntry = swapped ? originallyNeedsExit : originallyNeedsEntry;
  const needsExit  = swapped ? originallyNeedsEntry : originallyNeedsExit;
  const entryReadOnly = canSwap ? !needsEntry : !needsEntry && !!session.effectiveStart;
  const exitReadOnly  = canSwap ? !needsExit  : !needsExit  && !!session.lastScan;
  // A swapped day is anchored on the recorded scan's real date, so it may cross
  // midnight whatever the (possibly misread) matched shift says, up to a sane span.
  const overnight = swapped && !!entry && !!exit && toMinutes(exit) <= toMinutes(entry);
  const swappedSpanTooLong = overnight && toMinutes(exit) + 1440 - toMinutes(entry) > spanLimit;
  const hoursPreview = swappedSpanTooLong ? '—' : calcHours(entry, exit, swapped || crossMidnight);
  const timesInverted = !!entry && !!exit && hoursPreview === '—';
  const offsets: Pick<ResolvedSessionEntry, 'startDayOffset' | 'endDayOffset'> | undefined = swapped
    ? (originallyNeedsEntry
      ? { startDayOffset: 0, endDayOffset: overnight ? 1 : 0 }
      : { startDayOffset: overnight ? -1 : 0, endDayOffset: 0 })
    : undefined;
  const complete = (!needsEntry || !!entry) && (!needsExit || !!exit) && !!entry && !!exit && !timesInverted;
  return {
    needsEntry, needsExit, entryReadOnly, exitReadOnly, swappedSpanTooLong, hoursPreview, timesInverted,
    resolution: complete ? { resolvedStart: entry, resolvedEnd: exit, ...offsets } : null,
  };
}

interface SessionCardProps {
  session: TasSession;
  input?: CardInput;
  // What will be sent for this card: what was entered, or the prefilled times nobody changed.
  resolved?: ResolvedSessionEntry;
  crossMidnight: boolean;
  highlighted: boolean;
  onInput: (input: CardInput, resolution: ResolvedSessionEntry | null) => void;
}

// Every change is stored as it is made: there is no button to save or confirm.
function SessionCard({ session, input, resolved, crossMidnight, highlighted, onInput }: SessionCardProps) {
  const ref = useHighlightScroll(highlighted);
  const { originallyNeedsEntry, originallyNeedsExit, recordedTime, canSwap } = swapInfo(session);
  const current: CardInput = input ?? {
    entry: resolved?.resolvedStart ?? toHHMM(session.effectiveStart),
    exit: resolved?.resolvedEnd ?? (originallyNeedsExit ? '' : toHHMM(session.lastScan)),
    swapped: canSwap && !!resolved
      && (originallyNeedsEntry ? resolved.resolvedStart === recordedTime : resolved.resolvedEnd === recordedTime),
  };
  // A card that is already complete opens folded; once opened here it stays open while it is edited.
  const [open, setOpen] = useState(!resolved);
  const spanLimit = useContext(DaySpanLimit);
  const view = evaluateCard(session, crossMidnight, current, spanLimit);
  const { entry, exit, swapped } = current;

  const update = (next: CardInput) => onInput(next, evaluateCard(session, crossMidnight, next, spanLimit).resolution);

  const swap = () => {
    const next = !swapped;
    const recordedOnEntry = next ? originallyNeedsEntry : originallyNeedsExit;
    update({ entry: recordedOnEntry ? recordedTime : '', exit: recordedOnEntry ? '' : recordedTime, swapped: next });
  };

  const displayFlagLabel = (flag: TasFlag): string => {
    if (!swapped || (flag !== 'MISSING_ENTRY' && flag !== 'MISSING_EXIT')) return flagLabel(flag, session);
    return flag === 'MISSING_ENTRY'
      ? `${FLAG_LABELS.MISSING_EXIT} · Entrada ${recordedTime}`
      : `${FLAG_LABELS.MISSING_ENTRY} · Salida ${recordedTime}`;
  };

  // A night is paid in the fortnight it starts in: one typed into the previous fortnight leaves this submission.
  const shown = view.resolution ?? (input ? null : resolved ?? null);
  const startDate = shown ? resolutionDates(session, shown, crossMidnight).startDate : null;
  const startPeriod = startDate ? getSessionPeriod(startDate) : null;
  const paidElsewhere = !!startPeriod && !periodsEqual(startPeriod, getSessionPeriod(session.date));
  const paidElsewhereNote = paidElsewhere && startDate && startPeriod
    ? `Esta jornada empezó el ${formatDate(startDate)} y le corresponde a ${periodLabel(startPeriod)}, por eso no se incluye en este envío. Verifique que se haya pagado en esa quincena.`
    : null;

  if (resolved && !open && !highlighted) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Editar ${session.employeeName} ${formatDate(session.date)}`}
        className="w-full text-left border-l-4 border-success bg-surface-container-lowest rounded-shape-md px-4 py-3 flex items-center gap-4 shadow-sm hover:bg-surface-container transition-colors"
      >
        <div className="flex-1">
          <span className="font-medium text-on-surface">{session.employeeName}</span>
          <span className="mx-2 text-on-surface-variant">·</span>
          <span className="text-on-surface-variant text-body-sm">{formatDate(session.date)}</span>
          <span className="mx-2 text-on-surface-variant">·</span>
          <span className="text-on-surface-variant text-body-sm">{resolved.resolvedStart}–{resolved.resolvedEnd}</span>
          {paidElsewhereNote && (
            <p className="text-body-sm text-on-surface-variant mt-1">{paidElsewhereNote}</p>
          )}
        </div>
        <span className="text-success text-body-sm font-medium">Completo</span>
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
            onChange={e => update({ ...current, entry: e.target.value })}
            onInput={e => update({ ...current, entry: (e.target as HTMLInputElement).value })}
            readOnly={view.entryReadOnly}
            aria-label="Entrada"
            className={`h-9 px-3 rounded-shape-sm border text-body-md focus:outline-none focus:border-primary transition-colors ${
              view.entryReadOnly
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
            onChange={e => update({ ...current, exit: e.target.value })}
            onInput={e => update({ ...current, exit: (e.target as HTMLInputElement).value })}
            readOnly={view.exitReadOnly}
            aria-label="Salida"
            className={`h-9 px-3 rounded-shape-sm border text-body-md focus:outline-none focus:border-primary transition-colors ${
              view.exitReadOnly
                ? 'bg-surface-container border-outline-variant text-on-surface-variant cursor-default'
                : 'bg-surface-container-lowest border-outline focus:ring-1 focus:ring-primary'
            }`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-label-sm text-on-surface-variant">Horas calculadas</span>
          <span className="h-9 flex items-center text-body-md text-on-surface">
            {view.hoursPreview === '—' ? '—' : `Horas calculadas: ${view.hoursPreview}`}
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

      {view.timesInverted && (
        <p className="text-body-sm text-error mb-2">
          {view.swappedSpanTooLong
            ? `La jornada no puede durar más de ${formatSpanHours(spanLimit)}`
            : `La entrada debe ser antes de la salida${crossMidnight || swapped ? '' : ' (mismo día)'}`}
        </p>
      )}

      {paidElsewhereNote && (
        <p className="text-body-sm text-on-surface-variant mb-2" role="note">{paidElsewhereNote}</p>
      )}

      <p role="status" className={`text-body-sm ${view.resolution ? 'text-success font-medium' : 'text-on-surface-variant'}`}>
        {view.resolution
          ? '✓ Completo'
          : session.incomplete
            ? 'Falta completar la hora. Si la deja vacía, el día cuenta como trabajado, sin horas extra.'
            : 'Falta completar la hora. Lo que escriba se guarda automáticamente.'}
      </p>
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
  const cardInputs                  = useTasStore(s => s.cardInputs);
  const setCardInput                = useTasStore(s => s.setCardInput);
  const clearCardInput              = useTasStore(s => s.clearCardInput);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, []);

  const [spanLimit, setSpanLimit] = useState(MIN_DAY_SPAN_LIMIT_MINUTES);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(getGeneralConfig())
      .then(config => {
        const configured = config?.maxSessionSpanMinutes;
        if (!cancelled && typeof configured === 'number') setSpanLimit(Math.max(MIN_DAY_SPAN_LIMIT_MINUTES, configured));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // A group the user opened or closed stays that way. Otherwise it opens while it has something
  // to do, and stays open after that: it never folds shut under someone who is typing in it.
  const [userExpansion, setUserExpansion] = useState<Record<string, boolean>>({});
  const [openedGroups, setOpenedGroups] = useState<Set<string>>(new Set());
  const forgetUserExpansion = (employeeId: string) => setUserExpansion(prev => {
    const { [employeeId]: _, ...rest } = prev;
    return rest;
  });
  const [highlightedSessionId, setHighlightedSessionId] = useState<number | null>(null);
  const [confirmingIncomplete, setConfirmingIncomplete] = useState(false);

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
    regular, allShiftMismatchOnly, sameDayDoubleGroups, resolvedSessions, sameDayDoubleResolutions, cardInputs);

  // Freeze the initial sort order so that resolving an employee's items doesn't
  // move their group to the bottom of the list mid-session. Reset when the
  // selected period changes so each period gets its own clean initial order.
  // Kept in state and adjusted during render (no ref read while rendering): new employees are
  // appended, existing ones never move.
  const currentPeriodKey = selectedPeriod ? periodKey(selectedPeriod) : null;
  const [groupOrder, setGroupOrder] = useState<{ period: string | null; ids: string[] }>({ period: currentPeriodKey, ids: [] });
  let orderIds = groupOrder.period === currentPeriodKey ? groupOrder.ids : [];
  const knownIds = new Set(orderIds);
  const addedIds = rawGroups.map(g => g.employeeId).filter(id => !knownIds.has(id));
  if (groupOrder.period !== currentPeriodKey || addedIds.length > 0) {
    orderIds = [...orderIds, ...addedIds];
    setGroupOrder({ period: currentPeriodKey, ids: orderIds });
  }
  const employeeGroups = orderIds
    .map(id => rawGroups.find(g => g.employeeId === id))
    .filter((g): g is (typeof rawGroups)[number] => g !== undefined);

  const totalToResolve = needsResolutionSessions.length;
  // A short-day exit changed to something invalid is neither the recorded one nor a correction yet.
  const shortDaysUnfinished = shortDaySessions.filter(
    s => cardInputs[s.sessionId] && !resolvedSessions[s.sessionId]).length;
  const pendingCount   = employeeGroups.reduce((sum, g) => sum + g.pendingCount, 0) + shortDaysUnfinished;
  const allConfirmed   = pendingCount === 0;
  const incompleteSessions = employeeGroups.flatMap(g => g.incomplete);
  const allComplete = allConfirmed && incompleteSessions.length === 0;

  const openedKey = (employeeId: string) => `${currentPeriodKey}|${employeeId}`;
  const wantsOpen = (group: (typeof employeeGroups)[number]) => group.pendingCount > 0 || group.incomplete.length > 0 || group.items.some(
    i => (i.type === 'same_day_double' && sameDayDoubleResolutions[i.groupKey] === undefined)
      || (i.type === 'session' && i.session.sessionId === highlightedSessionId),
  );
  const newlyOpened = employeeGroups.filter(g => wantsOpen(g) && !openedGroups.has(openedKey(g.employeeId)));
  if (newlyOpened.length > 0) {
    setOpenedGroups(prev => new Set([...prev, ...newlyOpened.map(g => openedKey(g.employeeId))]));
  }
  const isExpanded = (group: (typeof employeeGroups)[number]) =>
    userExpansion[group.employeeId] ?? (openedGroups.has(openedKey(group.employeeId)) || wantsOpen(group));

  const toggleGroup = (group: (typeof employeeGroups)[number]) => {
    const expanded = isExpanded(group);
    setUserExpansion(prev => ({ ...prev, [group.employeeId]: !expanded }));
  };

  // A day may end after midnight when its shift does, or when its own scans already do: the card and
  // the submission must agree, or a complete card would be sent with its exit on the wrong day.
  const crossesMidnight = (session: TasSession): boolean =>
    (availableShifts.find(s => s.id === session.matchedShiftId)?.crossMidnight ?? session.crossMidnight)
    || prefilledResolution(session)?.endDayOffset === 1;

  const renderSessionCard = (session: TasSession) => {
    return (
      <SessionCard
        key={session.sessionId}
        session={session}
        input={cardInputs[session.sessionId]}
        resolved={effectiveResolution(session, resolvedSessions, cardInputs)}
        crossMidnight={crossesMidnight(session)}
        highlighted={highlightedSessionId === session.sessionId}
        onInput={(input, resolution) => {
          setCardInput(session.sessionId, input);
          if (resolution) {
            setResolvedSession(session.sessionId, resolution);
            if (highlightedSessionId === session.sessionId) setHighlightedSessionId(null);
          } else {
            clearResolvedSession(session.sessionId);
          }
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
      // Cards nobody touched that open complete (a night at the file's edge with both scans) go as they are.
      const toSend: Record<number, ResolvedSessionEntry> = { ...resolvedSessions };
      const keptHalves = [...sameDayDoubleGroups.entries()].flatMap(([groupKey, sessions]) =>
        keptSessions(sessions, sameDayDoubleResolutions[groupKey]).filter(needsTimes));
      for (const session of [...regular, ...keptHalves]) {
        const resolution = effectiveResolution(session, resolvedSessions, cardInputs);
        if (resolution && !toSend[session.sessionId]) toSend[session.sessionId] = resolution;
      }
      const resolutions: TasResolution[] = [
        // Only this period's times: the others go with their own period's choices, when it is sent.
        ...Object.entries(toSend).filter(([id]) => {
          const session = sessionById.get(Number(id));
          return !!session && periodsEqual(getSessionPeriod(session.date), selectedPeriod)
            && !discardedSessionIds.has(session.sessionId);
        }).map(([id, resolved]) => {
          const session = sessionById.get(Number(id));
          const isCrossMidnight = session ? crossesMidnight(session) : false;
          const { startDate, endDate } = session
            ? resolutionDates(session, resolved, isCrossMidnight)
            : { startDate: '', endDate: '' };
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
        s => blocksSending(s) && periodsEqual(getSessionPeriod(s.date), selectedPeriod),
      );
      if (stillNeedsResolution) {
        // The backend applied what was sent; the screen starts the new round empty, but the copy on
        // this PC keeps it so a rebuild can apply it again.
        rememberSentDecisions({ resolvedSessions: toSend, cardInputs, shiftAcceptances, sameDayDoubleResolutions });
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
        forgetUserExpansion(failed.employeeId);
        setHighlightedSessionId(failed.sessionId);
        useToastStore.getState().showToast(
          `${message} Revise ${failed.employeeName}, ${formatDate(failed.date)}.`, 'error');
        return;
      }
      useToastStore.getState().showToast(message, 'error');
    }
  };

  return (
    <DaySpanLimit.Provider value={spanLimit}>
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

        {allComplete && totalToResolve > 0 && (
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
            return (
              <EmployeeGroup
                key={group.employeeId}
                employeeName={group.employeeName}
                pendingCount={group.pendingCount}
                incompleteCount={group.incomplete.length}
                expanded={isExpanded(group)}
                onToggle={() => toggleGroup(group)}
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
                          cardInputs={cardInputs}
                          renderSessionCard={renderSessionCard}
                          onChange={(keepSessionId) => {
                            const merged = mergedDay(item.sessions, sameDayDoubleResolutions[item.groupKey], resolvedSessions, spanLimit);
                            if (merged) {
                              clearResolvedSession(merged.sessionId);
                              clearCardInput(merged.sessionId);
                            }
                            setSameDayDoubleResolution(item.groupKey, keepSessionId);
                            const leavesTimesMissing = keptSessions(item.sessions, keepSessionId)
                              .some(s => needsTimes(s)
                                && (!effectiveResolution(s, resolvedSessions, cardInputs) || s.sessionId === merged?.sessionId));
                            // That choice reopens the group by default; drop a manual collapse so it doesn't close under the user.
                            if (leavesTimesMissing) forgetUserExpansion(group.employeeId);
                          }}
                          onMerge={(day) => {
                            setSameDayDoubleResolution(item.groupKey, day.sessionId);
                            clearCardInput(day.sessionId);
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
                  crossMidnight={crossesMidnight(session)}
                  input={cardInputs[session.sessionId]}
                  registered={resolvedSessions[session.sessionId]}
                  highlighted={highlightedSessionId === session.sessionId}
                  onInput={(input, resolution) => {
                    if (input.exit === toHHMM(session.lastScan)) clearCardInput(session.sessionId);
                    else setCardInput(session.sessionId, input);
                    if (resolution) {
                      setResolvedSession(session.sessionId, resolution);
                      if (highlightedSessionId === session.sessionId) setHighlightedSessionId(null);
                    } else {
                      clearResolvedSession(session.sessionId);
                    }
                  }}
                  onUndo={() => {
                    clearCardInput(session.sessionId);
                    clearResolvedSession(session.sessionId);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-surface-container-lowest border-t border-outline-variant px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          {pendingCount > 0 && (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-error text-on-error text-label-md font-medium">
              {pendingCount} por resolver
            </span>
          )}
          {incompleteSessions.length > 0 && (
            <span className="text-body-sm text-on-surface-variant">
              {incompleteSessions.length} {incompleteSessions.length === 1 ? 'marcación incompleta' : 'marcaciones incompletas'}: el día cuenta como trabajado, sin horas extra.
            </span>
          )}
        </div>
        <button
          disabled={!allConfirmed}
          onClick={() => {
            if (incompleteSessions.length > 0) setConfirmingIncomplete(true);
            else void handleSubmit();
          }}
          className={
            allComplete && totalToResolve > 0
              ? 'm3-btn-filled !bg-success !text-on-success'
              : 'm3-btn-filled disabled:opacity-40 disabled:cursor-not-allowed'
          }
        >
          {allComplete && totalToResolve > 0 ? '✓ Revisar' : 'Revisar'}
        </button>
      </div>
      {confirmingIncomplete && (
        <IncompletePunchesDialog
          items={incompleteSessions.map(s => ({
            sessionId: s.sessionId,
            employeeName: s.employeeName,
            date: formatDate(s.date),
            detail: s.flags.filter(f => f === 'MISSING_ENTRY' || f === 'MISSING_EXIT').map(f => flagLabel(f, s)).join(' · '),
          }))}
          onCancel={() => setConfirmingIncomplete(false)}
          onContinue={() => {
            setConfirmingIncomplete(false);
            void handleSubmit();
          }}
        />
      )}
    </div>
    </DaySpanLimit.Provider>
  );
}
