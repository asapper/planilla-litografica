import type { DoubleChoice, TasSession } from '../../tasTypes';
import type { CardInput, ResolvedSessionEntry } from '../../tasStore';

export type GroupItem =
  | { type: 'session'; session: TasSession; date: string }
  | { type: 'shift_mismatch'; session: TasSession; date: string }
  | { type: 'same_day_double'; groupKey: string; sessions: TasSession[]; date: string };

export interface EmployeeGroupData {
  employeeId: string;
  employeeName: string;
  items: GroupItem[];
  pendingCount: number;
  // Lone scans left empty: they don't hold up Revisar, but the clerk confirms them before going on.
  incomplete: TasSession[];
}

// What the backend still refuses to send: an unresolved session that isn't a lone scan it may skip.
export function blocksSending(session: TasSession): boolean {
  return session.needsResolution && !session.incomplete;
}

export function needsTimes(session: TasSession): boolean {
  return session.flags.includes('MISSING_ENTRY') || session.flags.includes('MISSING_EXIT');
}

function hhmm(timestamp: string): string {
  return (timestamp.includes('T') ? timestamp.split('T')[1] : timestamp).slice(0, 5);
}

function isoDay(timestamp: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T/.test(timestamp) ? timestamp.slice(0, 10) : null;
}

function dayOffset(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// A card that opens with both times from real scans, in order, counts as checked as it is (a night at
// the file's edge, a late first scan): it stays on screen to correct, but asks for nothing. The times
// keep the scans' own calendar days, whatever shift was matched. A lone scan, or times out of order,
// still needs a person.
export function prefilledResolution(session: TasSession): ResolvedSessionEntry | null {
  const { effectiveStart: start, lastScan: end } = session;
  if (session.scans.length < 2 || !start || !end) return null;
  const startDay = isoDay(start);
  const endDay = isoDay(end);
  if (!startDay || !endDay || Date.parse(end) <= Date.parse(start)) return null;
  const startDayOffset = dayOffset(session.date, startDay);
  const endDayOffset = dayOffset(session.date, endDay);
  if ((startDayOffset !== 0 && startDayOffset !== -1) || (endDayOffset !== 0 && endDayOffset !== 1)) return null;
  return {
    resolvedStart: hhmm(start), resolvedEnd: hhmm(end),
    startDayOffset: startDayOffset as -1 | 0, endDayOffset: endDayOffset as 0 | 1,
  };
}

// What will be sent for a card: what was entered, else the prefilled times of a card nobody touched.
export function effectiveResolution(
  session: TasSession,
  resolvedSessions: Record<number, ResolvedSessionEntry>,
  cardInputs: Record<number, CardInput>,
): ResolvedSessionEntry | undefined {
  const entered = resolvedSessions[session.sessionId];
  if (entered || cardInputs[session.sessionId]) return entered;
  return prefilledResolution(session) ?? undefined;
}

// A choice that names no session of the group keeps them all, as the backend does.
export function keptSessions(sessions: TasSession[], choice: DoubleChoice | undefined): TasSession[] {
  const kept = sessions.filter(s => s.sessionId === choice);
  return kept.length > 0 ? kept : sessions;
}

// A half-typed time is something to finish, not a card left empty: going on would drop what was typed.
function countMissing(group: EmployeeGroupData, session: TasSession, cardInputs: Record<number, CardInput>) {
  if (session.incomplete && !cardInputs[session.sessionId]) group.incomplete.push(session);
  else group.pendingCount += 1;
}

export function buildEmployeeGroups(
  regular: TasSession[],
  shiftMismatchOnly: TasSession[],
  sameDayDoubleGroups: Map<string, TasSession[]>,
  resolvedSessions: Record<number, ResolvedSessionEntry>,
  sameDayDoubleResolutions: Record<string, DoubleChoice> = {},
  cardInputs: Record<number, CardInput> = {},
): EmployeeGroupData[] {
  const groups = new Map<string, EmployeeGroupData>();

  function getGroup(employeeId: string, employeeName: string): EmployeeGroupData {
    let group = groups.get(employeeId);
    if (!group) {
      group = { employeeId, employeeName, items: [], pendingCount: 0, incomplete: [] };
      groups.set(employeeId, group);
    }
    return group;
  }

  for (const session of regular) {
    const group = getGroup(session.employeeId, session.employeeName);
    group.items.push({ type: 'session', session, date: session.date });
    if (!effectiveResolution(session, resolvedSessions, cardInputs)) countMissing(group, session, cardInputs);
  }

  for (const session of shiftMismatchOnly) {
    const group = getGroup(session.employeeId, session.employeeName);
    group.items.push({ type: 'shift_mismatch', session, date: session.date });
  }

  for (const [groupKey, sessions] of sameDayDoubleGroups) {
    const first = sessions[0];
    const group = getGroup(first.employeeId, first.employeeName);
    group.items.push({ type: 'same_day_double', groupKey, sessions, date: first.date });
    // The pre-selected choice counts as decided, but a kept half that lacks a scan still needs its time.
    keptSessions(sessions, sameDayDoubleResolutions[groupKey])
      .filter(s => needsTimes(s) && !effectiveResolution(s, resolvedSessions, cardInputs))
      .forEach(s => countMissing(group, s, cardInputs));
  }

  // Keep items in stable chronological order regardless of resolved state, so a card
  // being filled in never moves under the user.
  for (const group of groups.values()) {
    group.items.sort((a, b) => a.date.localeCompare(b.date));
  }

  const rank = (g: EmployeeGroupData) => g.pendingCount > 0 ? 0 : g.incomplete.length > 0 ? 1 : 2;
  return Array.from(groups.values()).sort((a, b) => rank(a) - rank(b) || a.employeeName.localeCompare(b.employeeName));
}
