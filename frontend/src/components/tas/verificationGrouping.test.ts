import { describe, it, expect } from 'vitest';
import { buildEmployeeGroups } from './verificationGrouping';
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

  it('shift-mismatch items never count toward pendingCount, unresolved same-day-double items do', () => {
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
    expect(eva.pendingCount).toBe(1);
    expect(carlos.items).toEqual([{ type: 'shift_mismatch', session: mismatchSession, date: '2026-03-07' }]);
    expect(eva.items).toEqual([{ type: 'same_day_double', groupKey: 'E4|2026-03-08', sessions: [doubleA, doubleB], date: '2026-03-08' }]);
  });

  it('resolved same-day-double items do not count toward pendingCount', () => {
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
      [],
      new Map([['E4|2026-03-08', [doubleA, doubleB]]]),
      noResolved,
      { 'E4|2026-03-08': 4 },
    );
    const eva = groups.find(g => g.employeeId === 'E4')!;
    expect(eva.pendingCount).toBe(0);
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

  it('sorts pending session items before resolved ones, then by date within each tier', () => {
    const resolved: Record<number, ResolvedSessionEntry> = {
      1: { resolvedStart: '08:00', resolvedEnd: '17:00' },
    };
    const groups = buildEmployeeGroups(
      [
        makeSession({ sessionId: 1, date: '2026-03-05' }), // resolved (early)
        makeSession({ sessionId: 2, date: '2026-03-10' }), // pending
        makeSession({ sessionId: 3, date: '2026-03-20' }), // pending (late)
      ],
      [],
      new Map(),
      resolved,
    );
    expect(groups[0].items.map(i => (i as { session: { sessionId: number } }).session.sessionId)).toEqual([2, 3, 1]);
  });

  it('sorts pending same_day_double items before resolved ones', () => {
    const doubleA1 = makeSession({ sessionId: 1, employeeId: 'E1', employeeName: 'Ana', flags: ['SAME_DAY_DOUBLE'], date: '2026-03-05' });
    const doubleA2 = makeSession({ sessionId: 2, employeeId: 'E1', employeeName: 'Ana', flags: ['SAME_DAY_DOUBLE'], date: '2026-03-05' });
    const doubleB1 = makeSession({ sessionId: 3, employeeId: 'E1', employeeName: 'Ana', flags: ['SAME_DAY_DOUBLE'], date: '2026-03-20' });
    const doubleB2 = makeSession({ sessionId: 4, employeeId: 'E1', employeeName: 'Ana', flags: ['SAME_DAY_DOUBLE'], date: '2026-03-20' });
    const sameDayDoubleResolutions: Record<string, number | 'all'> = {
      'E1|2026-03-05': 1, // resolved
    };
    const groups = buildEmployeeGroups(
      [],
      [],
      new Map([
        ['E1|2026-03-05', [doubleA1, doubleA2]],
        ['E1|2026-03-20', [doubleB1, doubleB2]],
      ]),
      {},
      sameDayDoubleResolutions,
    );
    // unresolved 2026-03-20 group should come before resolved 2026-03-05 group
    expect(groups[0].items[0]).toMatchObject({ type: 'same_day_double', date: '2026-03-20' });
    expect(groups[0].items[1]).toMatchObject({ type: 'same_day_double', date: '2026-03-05' });
  });

  it('shift_mismatch items are treated as non-pending and sort after pending session items', () => {
    const resolved: Record<number, ResolvedSessionEntry> = {};
    const regularSession = makeSession({ sessionId: 1, date: '2026-03-20' }); // pending
    const mismatchSession = makeSession({ sessionId: 2, date: '2026-03-05', flags: ['SHIFT_MISMATCH'] }); // auto-resolved (earlier date)
    const groups = buildEmployeeGroups(
      [regularSession],
      [mismatchSession],
      new Map(),
      resolved,
    );
    // pending session (Mar 20) should come before shift_mismatch (Mar 05) despite later date
    expect(groups[0].items[0]).toMatchObject({ type: 'session', date: '2026-03-20' });
    expect(groups[0].items[1]).toMatchObject({ type: 'shift_mismatch', date: '2026-03-05' });
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
