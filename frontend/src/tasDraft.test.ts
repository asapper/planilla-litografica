import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { useTasStore } from './tasStore';
import type { TasSession } from './tasTypes';

const mockSaveDraft = vi.hoisted(() => vi.fn());
const mockDeleteDraft = vi.hoisted(() => vi.fn());

vi.mock('./tasApi', () => ({
  saveDraft: mockSaveDraft,
  deleteDraft: mockDeleteDraft,
}));

const {
  toSnapshot,
  applySnapshot,
  startDraftAutosave,
  discardDraftSession,
  formatPeriodLabel,
  isDraftView,
  PERSISTED_KEYS,
  DRAFT_SAVE_DEBOUNCE_MS,
} = await import('./tasDraft');

const session: TasSession = {
  sessionId: 7, employeeId: '1', employeeName: 'Ana', date: '2026-10-03', scans: ['2026-10-03T07:02'],
  matchedShiftId: 'manana', matchedShiftName: 'Mañana', assignedShiftId: null, assignedShiftName: null,
  effectiveStart: '2026-10-03T07:02', lastScan: null, workedMinutes: 0, workedHours: 0, crossMidnight: false,
  needsResolution: true, flags: ['MISSING_EXIT'],
};

const periodA = { anio: 2026, mes: 10, numeroDequincena: 1 };
const periodB = { anio: 2026, mes: 10, numeroDequincena: 2 };

function populate() {
  useTasStore.setState({
    tasView: 'verification',
    uploadToken: 'tok',
    stateRevision: 4,
    flaggedSessions: [session],
    resolvedSessions: { 7: { resolvedStart: '07:02', resolvedEnd: '15:00' } },
    shiftAcceptances: { 8: 'tarde' },
    sameDayDoubleResolutions: { '1|2026-10-04': 'all' },
    availablePeriods: [periodA, periodB],
    selectedPeriod: periodB,
    inactiveDecisions: { '9': 'reactivate' },
    overtimeOverrides: { '1': { horasExtrasSimples: 2 } },
    stashedOvertimeOverrides: { '2': { horasExtrasDobles: 1 } },
    nonWorkedDaysOverrides: { '1': 1 },
    stashedNonWorkedDaysOverrides: { '3': 2 },
    fallbackBannerDismissed: true,
    warnings: ['w'],
    usedFallbackHolidays: true,
    jobId: 'job-1',
    jobResult: { submitted: 1, skipped: 0, failed: 0, attemptNumber: 1, maxRetries: 3 },
    processingMessage: 'Leyendo...',
    error: 'boom',
    duplicateCodes: ['1'],
    duplicatesLoading: true,
    reviewSelectedEmployee: '1',
    reviewSortColumn: 'code',
    reviewSortDirection: 'desc',
    reviewActiveFilter: 'adjusted',
    reviewExpandedScans: new Set(['x']),
  });
}

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  mockSaveDraft.mockReset().mockResolvedValue(undefined);
  mockDeleteDraft.mockReset().mockResolvedValue(undefined);
  useTasStore.getState().resetTas();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('toSnapshot / applySnapshot', () => {
  it('round-trips every persisted field through JSON', () => {
    populate();
    const json = JSON.parse(JSON.stringify(toSnapshot(useTasStore.getState())));
    useTasStore.getState().resetTas();

    applySnapshot(json);

    const s = useTasStore.getState();
    expect(s.tasView).toBe('verification');
    expect(s.uploadToken).toBe('tok');
    expect(s.stateRevision).toBe(4);
    expect(s.flaggedSessions).toEqual([session]);
    expect(s.resolvedSessions[7]).toEqual({ resolvedStart: '07:02', resolvedEnd: '15:00' });
    expect(s.shiftAcceptances[8]).toBe('tarde');
    expect(s.sameDayDoubleResolutions).toEqual({ '1|2026-10-04': 'all' });
    expect(s.inactiveDecisions).toEqual({ '9': 'reactivate' });
    expect(s.overtimeOverrides).toEqual({ '1': { horasExtrasSimples: 2 } });
    expect(s.stashedOvertimeOverrides).toEqual({ '2': { horasExtrasDobles: 1 } });
    expect(s.nonWorkedDaysOverrides).toEqual({ '1': 1 });
    expect(s.stashedNonWorkedDaysOverrides).toEqual({ '3': 2 });
    expect(s.fallbackBannerDismissed).toBe(true);
    expect(s.warnings).toEqual(['w']);
    expect(s.usedFallbackHolidays).toBe(true);
  });

  it('excludes job state and pure UI state from the snapshot', () => {
    populate();
    const snapshot = toSnapshot(useTasStore.getState()) as unknown as Record<string, unknown>;
    for (const key of ['jobId', 'jobResult', 'processingMessage', 'error', 'duplicateCodes', 'duplicatesLoading',
      'reviewSelectedEmployee', 'reviewSortColumn', 'reviewSortDirection', 'reviewActiveFilter', 'reviewExpandedScans']) {
      expect(snapshot).not.toHaveProperty(key);
    }
    expect(Object.keys(snapshot).sort()).toEqual([...PERSISTED_KEYS].sort());
  });

  it('applies in a single setState from the initial state: keeps selectedPeriod, clears jobId', () => {
    populate();
    const snapshot = JSON.parse(JSON.stringify(toSnapshot(useTasStore.getState())));
    useTasStore.setState({ jobId: 'stale-job', duplicateCodes: ['9'], reviewSelectedEmployee: '9' });
    const listener = vi.fn();
    const unsub = useTasStore.subscribe(listener);

    applySnapshot(snapshot);
    unsub();

    expect(listener).toHaveBeenCalledTimes(1);
    const s = useTasStore.getState();
    expect(s.selectedPeriod).toEqual(periodB);
    expect(s.availablePeriods).toEqual([periodA, periodB]);
    expect(s.jobId).toBeNull();
    expect(s.duplicateCodes).toEqual([]);
    expect(s.reviewSelectedEmployee).toBeNull();
  });

  it('ignores unknown keys in a snapshot', () => {
    applySnapshot({ tasView: 'review', uploadToken: 't', jobId: 'injected', bogus: 1 });
    const s = useTasStore.getState() as unknown as Record<string, unknown>;
    expect(s.jobId).toBeNull();
    expect(s).not.toHaveProperty('bogus');
    expect(s.tasView).toBe('review');
  });

  it('carries stateRevision in the snapshot', () => {
    useTasStore.setState({ stateRevision: 12 });
    expect(toSnapshot(useTasStore.getState()).stateRevision).toBe(12);
  });
});

describe('helpers', () => {
  it('formats the period label', () => {
    expect(formatPeriodLabel(periodA)).toBe('Octubre 2026 - Quincena 1');
    expect(formatPeriodLabel(null)).toBeNull();
    expect(formatPeriodLabel({ anio: 2026, mes: 13, numeroDequincena: 1 })).toBe(' 2026 - Quincena 1');
  });

  it('recognises draft views', () => {
    expect(isDraftView('review')).toBe(true);
    expect(isDraftView('inactiveReview')).toBe(true);
    expect(isDraftView('verification')).toBe(true);
    expect(isDraftView('polling')).toBe(false);
    expect(isDraftView(3)).toBe(false);
  });
});

describe('autosave', () => {
  it('debounces a burst of changes into one save with the latest state', async () => {
    stop = startDraftAutosave(() => 'oct.csv');
    populate();
    useTasStore.getState().setOvertimeOverride('1', 'horasExtrasDobles', 3);
    vi.advanceTimersByTime(DRAFT_SAVE_DEBOUNCE_MS - 1);
    expect(mockSaveDraft).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    const body = mockSaveDraft.mock.calls[0][0];
    expect(body).toMatchObject({
      uploadToken: 'tok',
      stateRevision: 4,
      fileName: 'oct.csv',
      view: 'verification',
      periodLabel: 'Octubre 2026 - Quincena 2',
    });
    expect(body.ui.overtimeOverrides).toEqual({ '1': { horasExtrasSimples: 2, horasExtrasDobles: 3 } });
    expect(body.ui.stateRevision).toBe(4);
    expect(body.ui).not.toHaveProperty('jobId');
  });

  it('sends a null file name when none is known', async () => {
    stop = startDraftAutosave(() => '');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.runAllTimersAsync();
    expect(mockSaveDraft.mock.calls[0][0].fileName).toBeNull();
  });

  it.each(['idle', 'processing', 'submitting', 'polling', 'result', 'absentReview'] as const)(
    'never saves while the view is %s', async (view) => {
      stop = startDraftAutosave(() => 'f.csv');
      useTasStore.setState({ tasView: view, uploadToken: 'tok', warnings: ['changed'] });
      await vi.runAllTimersAsync();
      expect(mockSaveDraft).not.toHaveBeenCalled();
    });

  it('never saves without an upload token', async () => {
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: null, warnings: ['x'] });
    await vi.runAllTimersAsync();
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it('ignores changes to pure UI state', async () => {
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.getState().setReviewSelectedEmployee('1');
    useTasStore.getState().setDuplicatesLoading(true);
    await vi.runAllTimersAsync();
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it('flushes the pending edit with the review state when leaving for submitting', async () => {
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok', stateRevision: 2 });
    useTasStore.getState().setNonWorkedDaysOverride('1', 3);
    useTasStore.getState().setTasView('submitting');

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    const body = mockSaveDraft.mock.calls[0][0];
    expect(body.view).toBe('review');
    expect(body.ui.tasView).toBe('review');
    expect(body.ui.nonWorkedDaysOverrides).toEqual({ '1': 3 });
    await vi.runAllTimersAsync();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('drops the pending edit when the session goes back to idle', async () => {
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    useTasStore.getState().resetTas();
    await vi.runAllTimersAsync();
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  const stale = (data: unknown) => new AxiosError('stale', '409', undefined, undefined,
    { status: 409, statusText: 'Conflict', headers: {}, config: { headers: new AxiosHeaders() }, data });

  it('warns on a 409 DRAFT_STALE with both revisions when they drifted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValue(stale({ code: 'DRAFT_STALE', currentRevision: 9 }));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok', stateRevision: 4 });
    await vi.runAllTimersAsync();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('revisión local 4');
    expect(warn.mock.calls[0][0]).toContain('servidor 9');
    expect(useTasStore.getState().stateRevision).toBe(4);
    warn.mockRestore();
  });

  it('warns on a 409 DRAFT_STALE when the server no longer has the session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValue(stale({ code: 'DRAFT_STALE', currentRevision: null }));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.runAllTimersAsync();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('ya no tiene esta sesión');
    warn.mockRestore();
  });

  it('warns on other failures and retries on the next change', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValueOnce(new Error('network'));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.runAllTimersAsync();
    expect(warn).toHaveBeenCalledTimes(1);

    useTasStore.getState().setNonWorkedDaysOverride('1', 2);
    await vi.runAllTimersAsync();
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('serializes saves: a change during an in-flight save is sent after it, once', async () => {
    let resolveFirst!: () => void;
    mockSaveDraft.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    useTasStore.getState().setNonWorkedDaysOverride('1', 2);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    useTasStore.getState().setNonWorkedDaysOverride('1', 4);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    resolveFirst();
    await vi.runAllTimersAsync();
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft.mock.calls[1][0].ui.nonWorkedDaysOverrides).toEqual({ '1': 4 });
  });

  it('a flush to submitting while a save is in flight is sent after it with the review state', async () => {
    let resolveFirst!: () => void;
    mockSaveDraft.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);

    useTasStore.getState().setNonWorkedDaysOverride('1', 5);
    useTasStore.getState().setTasView('submitting');
    resolveFirst();
    await vi.runAllTimersAsync();

    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft.mock.calls[1][0].view).toBe('review');
    expect(mockSaveDraft.mock.calls[1][0].ui.nonWorkedDaysOverrides).toEqual({ '1': 5 });
  });

  it('stops saving after the returned unsubscribe runs', async () => {
    const unsubscribe = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    unsubscribe();
    useTasStore.getState().setNonWorkedDaysOverride('1', 2);
    await vi.runAllTimersAsync();
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });
});

describe('discardDraftSession', () => {
  it('cancels the pending save, waits for an in-flight one, deletes, then resets', async () => {
    const order: string[] = [];
    let resolveSave!: () => void;
    mockSaveDraft.mockImplementationOnce(() => new Promise<void>(r => { resolveSave = () => { order.push('save-done'); r(); }; }));
    mockDeleteDraft.mockImplementation(async () => { order.push('delete'); });
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    useTasStore.getState().setNonWorkedDaysOverride('1', 2);

    const done = discardDraftSession();
    useTasStore.getState().setNonWorkedDaysOverride('1', 3);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(order).toEqual([]);
    resolveSave();
    await done;
    await vi.runAllTimersAsync();

    expect(order).toEqual(['save-done', 'delete']);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(useTasStore.getState().tasView).toBe('idle');
    expect(useTasStore.getState().uploadToken).toBeNull();
  });

  it('still resets when the delete fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDeleteDraft.mockRejectedValue(new Error('down'));
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });

    await discardDraftSession();

    expect(useTasStore.getState().tasView).toBe('idle');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
