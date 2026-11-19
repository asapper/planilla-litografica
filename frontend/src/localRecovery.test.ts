import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTasStore } from './tasStore';
import type { TasSession, TasUploadResult } from './tasTypes';
import type { LocalCopy } from './localCopy';

const mockUpload = vi.hoisted(() => vi.fn());
const mockInactiveReview = vi.hoisted(() => vi.fn());
vi.mock('./tasApi', () => ({ uploadTasFile: mockUpload, submitInactiveReview: mockInactiveReview }));

const { rebuildFromLocalCopy } = await import('./localRecovery');

const Q1 = { anio: 2026, mes: 10, numeroDequincena: 1 };
const Q2 = { anio: 2026, mes: 10, numeroDequincena: 2 };

function day(sessionId: number, employeeId: string, date: string, scans: string[]): TasSession {
  return {
    sessionId, employeeId, employeeName: employeeId, date, scans, matchedShiftId: 'm', matchedShiftName: 'Mañana',
    assignedShiftId: 'm', assignedShiftName: 'Mañana', effectiveStart: scans[0] ?? null, lastScan: scans.at(-1) ?? null,
    workedMinutes: 0, workedHours: 0, crossMidnight: false, needsResolution: true, flags: ['MISSING_EXIT'],
  };
}

function upload(flaggedSessions: TasSession[], extra: Partial<TasUploadResult> = {}): TasUploadResult {
  return {
    uploadToken: 'tok-new', stateRevision: 1, flaggedSessions, resolvedRows: [], inactiveEmployeesFound: [],
    absentActiveEmployees: [], warnings: [], usedFallbackHolidays: false, availablePeriods: [Q1, Q2],
    availableShifts: [], sessionSummaries: {}, ...extra,
  } as TasUploadResult;
}

function copy(snapshot: Record<string, unknown>): LocalCopy {
  return { fileName: 'oct.csv', fileBase64: btoa('x'), savedAt: '2026-11-19T10:00:00Z', snapshot, submitted: false };
}

const A = ['2026-10-03T07:02:00'];
const B = ['2026-10-04T07:10:00'];
const C = ['2026-10-05T19:00:00', '2026-10-05T22:00:00'];

beforeEach(() => {
  vi.clearAllMocks();
  useTasStore.getState().resetTas();
});

describe('rebuildFromLocalCopy', () => {
  it('uploads the saved file again and carries every decision over to the new days', async () => {
    mockUpload.mockResolvedValue(upload([day(10, 'E1', '2026-10-03', A), day(20, 'E1', '2026-10-04', B), day(30, 'E2', '2026-10-05', C)]));
    const recovery = await rebuildFromLocalCopy(copy({
      tasView: 'review',
      selectedPeriod: Q2,
      flaggedSessions: [day(1, 'E1', '2026-10-03', A), day(2, 'E1', '2026-10-04', B), day(3, 'E2', '2026-10-05', C)],
      resolvedSessions: { 1: { resolvedStart: '07:02', resolvedEnd: '15:00' } },
      cardInputs: { 1: { entry: '07:02', exit: '15:00', swapped: false }, 2: { entry: '07:10', exit: '', swapped: false } },
      shiftAcceptances: { 3: 'noche' },
      sameDayDoubleResolutions: { 'E1|2026-10-03': 1, 'E2|2026-10-05': 'all' },
      overtimeOverrides: { E1: { horasExtrasSimples: 2 } },
      nonWorkedDaysOverrides: { E2: 1 },
      inactiveDecisions: { E9: 'ignore' },
      fallbackBannerDismissed: true,
    }));

    expect(mockUpload.mock.calls[0][0]).toBeInstanceOf(File);
    expect(mockUpload.mock.calls[0][0].name).toBe('oct.csv');
    expect(recovery).toEqual({ view: 'verification', dropped: 0, wasInReview: true });
    const s = useTasStore.getState();
    expect(s.tasView).toBe('verification');
    expect(s.uploadToken).toBe('tok-new');
    expect(s.resolvedSessions).toEqual({ 10: { resolvedStart: '07:02', resolvedEnd: '15:00' } });
    expect(s.cardInputs).toEqual({ 10: { entry: '07:02', exit: '15:00', swapped: false }, 20: { entry: '07:10', exit: '', swapped: false } });
    expect(s.shiftAcceptances).toEqual({ 30: 'noche' });
    expect(s.sameDayDoubleResolutions).toEqual({ 'E1|2026-10-03': 10, 'E2|2026-10-05': 'all' });
    expect(s.overtimeOverrides).toEqual({ E1: { horasExtrasSimples: 2 } });
    expect(s.nonWorkedDaysOverrides).toEqual({ E2: 1 });
    expect(s.selectedPeriod).toEqual(Q2);
    expect(s.fallbackBannerDismissed).toBe(true);
    expect(mockInactiveReview).not.toHaveBeenCalled();
  });

  it('counts decisions whose day is gone and drops them', async () => {
    mockUpload.mockResolvedValue(upload([day(10, 'E1', '2026-10-03', A)]));
    const recovery = await rebuildFromLocalCopy(copy({
      tasView: 'verification',
      flaggedSessions: [day(1, 'E1', '2026-10-03', A), day(2, 'E1', '2026-10-04', B)],
      resolvedSessions: { 1: { resolvedStart: '07:02', resolvedEnd: '15:00' }, 2: { resolvedStart: '07:10', resolvedEnd: '15:00' } },
      sameDayDoubleResolutions: { 'E1|2026-10-04': 2 },
    }));
    expect(recovery.dropped).toBe(2);
    expect(useTasStore.getState().resolvedSessions).toEqual({ 10: { resolvedStart: '07:02', resolvedEnd: '15:00' } });
    expect(useTasStore.getState().sameDayDoubleResolutions).toEqual({});
  });

  it('replays the inactive-employee choices when the saved session was past that step', async () => {
    mockUpload.mockResolvedValue(upload([], {
      uploadToken: 'tok-a',
      inactiveEmployeesFound: [{ employeeId: 'E8' }, { employeeId: 'E9' }] as TasUploadResult['inactiveEmployeesFound'],
    }));
    mockInactiveReview.mockResolvedValue(upload([day(10, 'E1', '2026-10-03', A)], { uploadToken: 'tok-b' }));
    const recovery = await rebuildFromLocalCopy(copy({
      tasView: 'verification',
      inactiveDecisions: { E8: 'reactivate' },
      flaggedSessions: [day(1, 'E1', '2026-10-03', A)],
      cardInputs: { 1: { entry: '07:02', exit: '', swapped: false } },
    }));
    expect(mockInactiveReview).toHaveBeenCalledWith('tok-a', ['E8'], ['E9']);
    expect(recovery.view).toBe('verification');
    expect(useTasStore.getState().uploadToken).toBe('tok-b');
    expect(useTasStore.getState().cardInputs).toEqual({ 10: { entry: '07:02', exit: '', swapped: false } });
  });

  it('a session saved during the inactive-employee step reopens on it with its choices', async () => {
    mockUpload.mockResolvedValue(upload([], {
      inactiveEmployeesFound: [{ employeeId: 'E9' }] as TasUploadResult['inactiveEmployeesFound'],
    }));
    const recovery = await rebuildFromLocalCopy(copy({ tasView: 'inactiveReview', inactiveDecisions: { E9: 'reactivate' } }));
    expect(mockInactiveReview).not.toHaveBeenCalled();
    expect(recovery).toEqual({ view: 'inactiveReview', dropped: 0, wasInReview: false });
    expect(useTasStore.getState().inactiveDecisions).toEqual({ E9: 'reactivate' });
  });

  it('tolerates a snapshot from another version or with junk in it', async () => {
    mockUpload.mockResolvedValue(upload([day(10, 'E1', '2026-10-03', A)], { availablePeriods: [] }));
    const recovery = await rebuildFromLocalCopy(copy({
      flaggedSessions: [null, { sessionId: 'x' }, day(1, 'E1', '2026-10-03', A)],
      resolvedSessions: 'nope',
      cardInputs: [1, 2],
      sameDayDoubleResolutions: { k: { odd: true } },
      selectedPeriod: 'Q9',
    }));
    expect(recovery.dropped).toBe(1);
    expect(useTasStore.getState().selectedPeriod).toBeNull();
    expect(useTasStore.getState().resolvedSessions).toEqual({});
  });

  it('works from a copy with no decisions saved yet', async () => {
    mockUpload.mockResolvedValue(upload([]));
    const recovery = await rebuildFromLocalCopy({ ...copy({}), snapshot: null });
    expect(recovery).toEqual({ view: 'verification', dropped: 0, wasInReview: false });
    expect(useTasStore.getState().selectedPeriod).toEqual(Q1);
  });

  it('fails when the upload fails, changing nothing', async () => {
    mockUpload.mockRejectedValue(new Error('down'));
    useTasStore.setState({ tasView: 'processing' });
    await expect(rebuildFromLocalCopy(copy({}))).rejects.toThrow('down');
    expect(useTasStore.getState().tasView).toBe('processing');
  });
});
