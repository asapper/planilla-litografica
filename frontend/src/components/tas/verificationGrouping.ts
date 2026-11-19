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
}

export function needsTimes(session: TasSession): boolean {
  return session.flags.includes('MISSING_ENTRY') || session.flags.includes('MISSING_EXIT');
}

function hhmm(timestamp: string): string {
  return (timestamp.includes('T') ? timestamp.split('T')[1] : timestamp).slice(0, 5);
}

// A card that opens with both times from real scans, in order, counts as checked as it is (a night at
// the file's edge, a late first scan): it stays on screen to correct, but asks for nothing. A lone
// scan, or times out of order, still needs a person.
export function prefilledResolution(session: TasSession): ResolvedSessionEntry | null {
  if (session.scans.length < 2 || !session.effectiveStart || !session.lastScan) return null;
  const resolvedStart = hhmm(session.effectiveStart);
  const resolvedEnd = hhmm(session.lastScan);
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  if (minutes(resolvedEnd) <= minutes(resolvedStart) && !session.crossMidnight) return null;
  return { resolvedStart, resolvedEnd };
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
      group = { employeeId, employeeName, items: [], pendingCount: 0 };
      groups.set(employeeId, group);
    }
    return group;
  }

  for (const session of regular) {
    const group = getGroup(session.employeeId, session.employeeName);
    group.items.push({ type: 'session', session, date: session.date });
    if (!effectiveResolution(session, resolvedSessions, cardInputs)) group.pendingCount += 1;
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
    group.pendingCount += keptSessions(sessions, sameDayDoubleResolutions[groupKey])
      .filter(s => needsTimes(s) && !resolvedSessions[s.sessionId]).length;
  }

  // Keep items in stable chronological order regardless of resolved state, so a card
  // being filled in never moves under the user.
  for (const group of groups.values()) {
    group.items.sort((a, b) => a.date.localeCompare(b.date));
  }

  return Array.from(groups.values()).sort((a, b) => {
    const aPending = a.pendingCount > 0;
    const bPending = b.pendingCount > 0;
    if (aPending !== bPending) return aPending ? -1 : 1;
    return a.employeeName.localeCompare(b.employeeName);
  });
}
