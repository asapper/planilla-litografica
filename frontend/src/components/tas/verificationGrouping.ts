import type { TasSession } from '../../tasTypes';
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

export function buildEmployeeGroups(
  regular: TasSession[],
  shiftMismatchOnly: TasSession[],
  sameDayDoubleGroups: Map<string, TasSession[]>,
  resolvedSessions: Record<number, ResolvedSessionEntry>,
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
  }

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
