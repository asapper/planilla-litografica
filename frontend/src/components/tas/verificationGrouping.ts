import type { DoubleChoice, TasSession } from '../../tasTypes';
import type { ResolvedSessionEntry } from '../../tasStore';

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
    if (!resolvedSessions[session.sessionId]) group.pendingCount += 1;
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

  // Keep items in stable chronological order regardless of resolved state:
  // resolving a row collapses it in place (a "Confirmado" chip) instead of
  // sinking it to the bottom, which read as the row vanishing.
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
