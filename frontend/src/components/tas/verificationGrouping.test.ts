import { describe, it, expect } from 'vitest';
import { blocksSending, buildEmployeeGroups, keptSessions, needsTimes } from './verificationGrouping';
import type { TasSession } from '../../tasTypes';
import type { ResolvedSessionEntry } from '../../tasStore';

function makeSession(overrides: Partial<TasSession> = {}): TasSession {
  return {
    sessionId: 1,
    employeeId: 'E1',
    employeeName: 'Ana López',
    date: '2026-03-15',
    scans: [],
    matchedShiftId: 'S1',
    matchedShiftName: 'Turno Mañana',
    assignedShiftId: 'S1',
    assignedShiftName: 'Turno Mañana',
    effectiveStart: null,
    lastScan: null,
    workedMinutes: 0,
    workedHours: 0,
    crossMidnight: false,
    needsResolution: true,
    flags: ['MISSING_ENTRY'],
    ...overrides,
  };
}

const noResolved: Record<number, ResolvedSessionEntry> = {};

describe('buildEmployeeGroups', () => {
  it('creates one group per employee from regular sessions', () => {
    const groups = buildEmployeeGroups(
      [
        makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana López' }),
        makeSession({ sessionId: 2, employeeId: 'E2', employeeName: 'Luis Soto' }),
      ],
      [],
      new Map(),
      noResolved,
    );
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.employeeId).sort()).toEqual(['E1', 'E2']);
  });

  it('sorts items within a group chronologically by date', () => {
    const groups = buildEmployeeGroups(
      [
        makeSession({ sessionId: 1, date: '2026-03-20' }),
        makeSession({ sessionId: 2, date: '2026-03-05' }),
      ],
      [],
      new Map(),
      noResolved,
    );
    expect(groups).toHaveLength(1);
    const dates = groups[0].items.map(i => i.date);
    expect(dates).toEqual(['2026-03-05', '2026-03-20']);
  });

  it('counts pendingCount only from unresolved regular sessions', () => {
    const resolved: Record<number, ResolvedSessionEntry> = {
      1: { resolvedStart: '08:00', resolvedEnd: '17:00' },
    };
    const groups = buildEmployeeGroups(
      [
        makeSession({ sessionId: 1, date: '2026-03-05' }),
        makeSession({ sessionId: 2, date: '2026-03-06' }),
      ],
      [],
      new Map(),
      resolved,
    );
    expect(groups[0].pendingCount).toBe(1);
  });

  it('shift-mismatch and same-day-double items never count toward pendingCount: their default applies', () => {
    const mismatchSession = makeSession({
      sessionId: 3, employeeId: 'E3', employeeName: 'Carlos Ruiz',
      flags: ['SHIFT_MISMATCH'], date: '2026-03-07',
    });
    const doubleA = makeSession({
      sessionId: 4, employeeId: 'E4', employeeName: 'Eva Díaz',
      flags: ['SAME_DAY_DOUBLE'], date: '2026-03-08',
    });
    const doubleB = makeSession({
      sessionId: 5, employeeId: 'E4', employeeName: 'Eva Díaz',
      flags: ['SAME_DAY_DOUBLE'], date: '2026-03-08',
    });
    const groups = buildEmployeeGroups(
      [],
      [mismatchSession],
      new Map([['E4|2026-03-08', [doubleA, doubleB]]]),
      noResolved,
    );
    const carlos = groups.find(g => g.employeeId === 'E3')!;
    const eva = groups.find(g => g.employeeId === 'E4')!;
    expect(carlos.pendingCount).toBe(0);
    expect(eva.pendingCount).toBe(0);
    expect(carlos.items).toEqual([{ type: 'shift_mismatch', session: mismatchSession, date: '2026-03-07' }]);
    expect(eva.items).toEqual([{ type: 'same_day_double', groupKey: 'E4|2026-03-08', sessions: [doubleA, doubleB], date: '2026-03-08' }]);
  });

  it('orders pending groups before resolved groups, alphabetical within each bucket', () => {
    const resolved: Record<number, ResolvedSessionEntry> = {
      1: { resolvedStart: '08:00', resolvedEnd: '17:00' }, // Ana resolved
    };
    const groups = buildEmployeeGroups(
      [
        makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana López', date: '2026-03-01' }),
        makeSession({ sessionId: 2, employeeId: 'E2', employeeName: 'Zoe Vargas', date: '2026-03-01' }),
        makeSession({ sessionId: 3, employeeId: 'E3', employeeName: 'Beto Cruz', date: '2026-03-01' }),
        makeSession({ sessionId: 4, employeeId: 'E4', employeeName: 'Mateo Gil', date: '2026-03-01' }),
      ],
      [],
      new Map(),
      resolved,
    );
    // Pending (pendingCount > 0): Beto Cruz, Mateo Gil, Zoe Vargas — alphabetical
    // Resolved (pendingCount === 0): Ana López
    expect(groups.map(g => g.employeeName)).toEqual([
      'Beto Cruz', 'Mateo Gil', 'Zoe Vargas', 'Ana López',
    ]);
  });

  it('keeps resolved session items in their chronological position instead of sinking them to the bottom', () => {
    const resolved: Record<number, ResolvedSessionEntry> = {
      1: { resolvedStart: '08:00', resolvedEnd: '17:00' },
    };
    const groups = buildEmployeeGroups(
      [
        makeSession({ sessionId: 1, date: '2026-03-05' }), // resolved (early) — must stay first
        makeSession({ sessionId: 2, date: '2026-03-10' }), // pending
        makeSession({ sessionId: 3, date: '2026-03-20' }), // pending (late)
      ],
      [],
      new Map(),
      resolved,
    );
    expect(groups[0].items.map(i => (i as { session: { sessionId: number } }).session.sessionId)).toEqual([1, 2, 3]);
  });

  it('keeps same_day_double items in chronological position', () => {
    const doubleA1 = makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana', flags: ['SAME_DAY_DOUBLE'], date: '2026-03-05' });
    const doubleA2 = makeSession({ sessionId: 2, employeeId: 'E1', employeeName: 'Ana', flags: ['SAME_DAY_DOUBLE'], date: '2026-03-05' });
    const doubleB1 = makeSession({ sessionId: 3, employeeId: 'E1', employeeName: 'Ana', flags: ['SAME_DAY_DOUBLE'], date: '2026-03-20' });
    const doubleB2 = makeSession({ sessionId: 4, employeeId: 'E1', employeeName: 'Ana', flags: ['SAME_DAY_DOUBLE'], date: '2026-03-20' });
    const groups = buildEmployeeGroups(
      [],
      [],
      new Map([
        ['E1|2026-03-05', [doubleA1, doubleA2]],
        ['E1|2026-03-20', [doubleB1, doubleB2]],
      ]),
      {},
    );
    expect(groups[0].items[0]).toMatchObject({ type: 'same_day_double', date: '2026-03-05' });
    expect(groups[0].items[1]).toMatchObject({ type: 'same_day_double', date: '2026-03-20' });
  });

  it('sorts all item types purely by date regardless of resolution state', () => {
    const resolved: Record<number, ResolvedSessionEntry> = {};
    const regularSession = makeSession({ sessionId: 1, date: '2026-03-20' });
    const mismatchSession = makeSession({ sessionId: 2, date: '2026-03-05', flags: ['SHIFT_MISMATCH'] });
    const groups = buildEmployeeGroups(
      [regularSession],
      [mismatchSession],
      new Map(),
      resolved,
    );
    // pure date order: shift_mismatch (Mar 05) before session (Mar 20)
    expect(groups[0].items[0]).toMatchObject({ type: 'shift_mismatch', date: '2026-03-05' });
    expect(groups[0].items[1]).toMatchObject({ type: 'session', date: '2026-03-20' });
  });

  it('combines regular, shift-mismatch, and same-day-double items for the same employee into one group, sorted by date', () => {
    const regularSession = makeSession({ sessionId: 1, date: '2026-03-10' });
    const mismatchSession = makeSession({ sessionId: 2, date: '2026-03-20', flags: ['SHIFT_MISMATCH'] });
    const doubleA = makeSession({ sessionId: 3, date: '2026-03-15', flags: ['SAME_DAY_DOUBLE'] });
    const doubleB = makeSession({ sessionId: 4, date: '2026-03-15', flags: ['SAME_DAY_DOUBLE'] });
    const groups = buildEmployeeGroups(
      [regularSession],
      [mismatchSession],
      new Map([['E1|2026-03-15', [doubleA, doubleB]]]),
      noResolved,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(i => i.type)).toEqual(['session', 'same_day_double', 'shift_mismatch']);
    expect(groups[0].items.map(i => i.date)).toEqual(['2026-03-10', '2026-03-15', '2026-03-20']);
  });
});

describe('doubles whose kept halves lack a scan', () => {
  const a = makeSession({ sessionId: 1, flags: ['SAME_DAY_DOUBLE', 'MISSING_EXIT'] });
  const b = makeSession({ sessionId: 2, flags: ['SAME_DAY_DOUBLE', 'MISSING_ENTRY'] });
  const full = makeSession({ sessionId: 3, flags: ['SAME_DAY_DOUBLE'] });
  const doubles = (sessions: TasSession[]) => new Map([['E1|2026-03-15', sessions]]);

  it('needsTimes is true only for a missing entry or exit', () => {
    expect([a, b, full].map(needsTimes)).toEqual([true, true, false]);
  });

  it('keptSessions keeps the chosen one, and all when the choice is all, missing or foreign', () => {
    expect(keptSessions([a, b], 2)).toEqual([b]);
    expect(keptSessions([a, b], 'all')).toEqual([a, b]);
    expect(keptSessions([a, b], undefined)).toEqual([a, b]);
    expect(keptSessions([a, b], 99)).toEqual([a, b]);
  });

  it('counts each kept half without its time as pending', () => {
    expect(buildEmployeeGroups([], [], doubles([a, b]), noResolved)[0].pendingCount).toBe(2);
    expect(buildEmployeeGroups([], [], doubles([a, b]), noResolved, { 'E1|2026-03-15': 1 })[0].pendingCount).toBe(1);
    const typed = { 1: { resolvedStart: '07:08', resolvedEnd: '15:00' } };
    expect(buildEmployeeGroups([], [], doubles([a, b]), typed, { 'E1|2026-03-15': 1 })[0].pendingCount).toBe(0);
    expect(buildEmployeeGroups([], [], doubles([full, a]), noResolved, { 'E1|2026-03-15': 3 })[0].pendingCount).toBe(0);
  });
});

describe('incomplete punches', () => {
  it('a lone scan the backend lets go empty is listed apart and does not count as pending', () => {
    const lone = makeSession({ sessionId: 1, incomplete: true });
    const other = makeSession({ sessionId: 2 });
    const [group] = buildEmployeeGroups([lone, other], [], new Map(), noResolved);
    expect(group.pendingCount).toBe(1);
    expect(group.incomplete).toEqual([lone]);
  });

  it('a half-typed lone scan must be finished, not skipped', () => {
    const lone = makeSession({ sessionId: 1, incomplete: true });
    const [group] = buildEmployeeGroups([lone], [], new Map(), noResolved, {}, { 1: { entry: '07', exit: '', swapped: false } });
    expect(group.pendingCount).toBe(1);
    expect(group.incomplete).toEqual([]);
  });

  it('so must a half-typed kept half of a double', () => {
    const a = makeSession({ sessionId: 1, flags: ['SAME_DAY_DOUBLE', 'MISSING_EXIT'], incomplete: true });
    const b = makeSession({ sessionId: 2, flags: ['SAME_DAY_DOUBLE', 'MISSING_EXIT'], incomplete: true });
    const [group] = buildEmployeeGroups([], [], new Map([['E1|2026-03-15', [a, b]]]), noResolved, {}, { 1: { entry: '', exit: '1', swapped: false } });
    expect(group.pendingCount).toBe(1);
    expect(group.incomplete).toEqual([b]);
  });

  it('a filled-in lone scan is neither', () => {
    const lone = makeSession({ sessionId: 1, incomplete: true });
    const [group] = buildEmployeeGroups([lone], [], new Map(), { 1: { resolvedStart: '07:00', resolvedEnd: '15:00' } });
    expect(group.pendingCount).toBe(0);
    expect(group.incomplete).toEqual([]);
  });

  it('a kept half of a double that lacks a scan may stay empty too', () => {
    const a = makeSession({ sessionId: 1, flags: ['SAME_DAY_DOUBLE', 'MISSING_EXIT'], incomplete: true });
    const b = makeSession({ sessionId: 2, flags: ['SAME_DAY_DOUBLE', 'MISSING_EXIT'] });
    const [group] = buildEmployeeGroups([], [], new Map([['E1|2026-03-15', [a, b]]]), noResolved);
    expect(group.incomplete).toEqual([a]);
    expect(group.pendingCount).toBe(1);
  });

  it('orders employees with something to resolve first, then those with lone scans, then the rest', () => {
    const groups = buildEmployeeGroups(
      [
        makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana', incomplete: true }),
        makeSession({ sessionId: 2, employeeId: 'E2', employeeName: 'Bea' }),
      ],
      [makeSession({ sessionId: 3, employeeId: 'E3', employeeName: 'Aaron', flags: ['SHIFT_MISMATCH'] })],
      new Map(),
      noResolved,
    );
    expect(groups.map(g => g.employeeName)).toEqual(['Bea', 'Ana', 'Aaron']);
  });

  it('only an unresolved session that may not go empty blocks sending', () => {
    expect(blocksSending(makeSession())).toBe(true);
    expect(blocksSending(makeSession({ incomplete: true }))).toBe(false);
    expect(blocksSending(makeSession({ needsResolution: false }))).toBe(false);
  });
});
