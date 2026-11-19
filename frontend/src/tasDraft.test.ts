import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { useTasStore } from './tasStore';
import { useToastStore } from './toastStore';
import { loadLocalCopy, recoverableLocalCopy, startLocalCopy } from './localCopy';
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
  DRAFT_SAVE_MAX_WAIT_MS,
  saveDraftNow,
  DRAFT_UI_VERSION,
  DRAFT_SAVE_RETRY_MS,
  DRAFT_SAVE_FAILED_MESSAGE,
  DRAFT_SAVE_RECOVERED_MESSAGE,
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
  useToastStore.setState({ toasts: [] });
  localStorage.clear();
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
    expect(body.ui.uiVersion).toBe(DRAFT_UI_VERSION);
  });

  it('saves at least every max-wait interval during a steady stream of edits', async () => {
    stop = startDraftAutosave(() => 'oct.csv');
    populate();
    for (let i = 0; i * (DRAFT_SAVE_DEBOUNCE_MS - 100) < DRAFT_SAVE_MAX_WAIT_MS; i++) {
      useTasStore.getState().setOvertimeOverride('1', 'horasExtrasDobles', i);
      await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS - 100);
    }
    expect(mockSaveDraft).toHaveBeenCalled();
  });

  it('saves a pending change right away when the page is hidden', async () => {
    stop = startDraftAutosave(() => 'oct.csv');
    populate();
    useTasStore.getState().setOvertimeOverride('1', 'horasExtrasDobles', 7);
    window.dispatchEvent(new Event('pagehide'));
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft.mock.calls[0][0].ui.overtimeOverrides['1'].horasExtrasDobles).toBe(7);
  });

  it('on pagehide sends the latest state even while an earlier save is in flight', async () => {
    let release!: () => void;
    mockSaveDraft.mockReturnValueOnce(new Promise<void>(r => { release = r; }));
    stop = startDraftAutosave(() => 'oct.csv');
    populate();
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    useTasStore.getState().setOvertimeOverride('1', 'horasExtrasDobles', 9);
    window.dispatchEvent(new Event('pagehide'));

    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft.mock.calls[1][0].ui.overtimeOverrides['1'].horasExtrasDobles).toBe(9);
    release();
    await vi.runAllTimersAsync();
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
  });

  it('does not save on pagehide while a discard is in progress', async () => {
    let release!: () => void;
    mockDeleteDraft.mockReturnValueOnce(new Promise<void>(r => { release = r; }));
    stop = startDraftAutosave(() => 'oct.csv');
    populate();
    const discarding = discardDraftSession();
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok', overtimeOverrides: { '2': { horasExtrasSimples: 1 } } });
    window.dispatchEvent(new Event('pagehide'));
    expect(mockSaveDraft).not.toHaveBeenCalled();
    release();
    await discarding;
  });

  it('does not save on pagehide when nothing is pending', async () => {
    stop = startDraftAutosave(() => 'oct.csv');
    window.dispatchEvent(new Event('pagehide'));
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it('stops listening for pagehide once autosave is stopped', async () => {
    stop = startDraftAutosave(() => 'oct.csv');
    populate();
    stop();
    stop = null;
    window.dispatchEvent(new Event('pagehide'));
    expect(mockSaveDraft).not.toHaveBeenCalled();
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

  const toasts = () => useToastStore.getState().toasts.map(t => [t.variant, t.message]);

  it('on another failure warns the user once and retries by itself, with no further edit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValue(new Error('network'));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_RETRY_MS - 1);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual([['warning', DRAFT_SAVE_FAILED_MESSAGE]]);

    await vi.advanceTimersByTimeAsync(2 * DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(3);
    expect(toasts()).toHaveLength(1);

    mockSaveDraft.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(4);
    expect(toasts()).toEqual([['warning', DRAFT_SAVE_FAILED_MESSAGE], ['success', DRAFT_SAVE_RECOVERED_MESSAGE]]);

    await vi.advanceTimersByTimeAsync(10 * DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it('an edit during a failure run saves at once instead of waiting for the retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValueOnce(new Error('network'));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    useTasStore.getState().setNonWorkedDaysOverride('1', 2);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft.mock.calls[1][0].ui.nonWorkedDaysOverrides).toEqual({ '1': 2 });
    expect(toasts().map(([v]) => v)).toEqual(['warning', 'success']);

    await vi.advanceTimersByTimeAsync(10 * DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('a save in flight when autosave stops does not start a retry loop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let rejectFirst!: (e: Error) => void;
    mockSaveDraft.mockImplementationOnce(() => new Promise<void>((_, r) => { rejectFirst = r; }));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    stop();
    stop = null;
    rejectFirst(new Error('network'));
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('leaving review for submitting mid-failure keeps retrying the review state until it is saved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network'));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    useTasStore.getState().setNonWorkedDaysOverride('1', 3);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    useTasStore.setState({ tasView: 'submitting' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(3);
    for (const [body] of mockSaveDraft.mock.calls) {
      expect(body.view).toBe('review');
      expect(body.ui.nonWorkedDaysOverrides).toEqual({ '1': 3 });
    }
    expect(toasts().map(([v]) => v)).toEqual(['warning', 'success']);
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('going back to idle mid-failure drops the retry and ends the failure run quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValueOnce(new Error('network'));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    useTasStore.getState().resetTas();
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    useTasStore.setState({ tasView: 'review', uploadToken: 'tok2' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(toasts().map(([v]) => v)).toEqual(['warning']);
    warn.mockRestore();
  });

  it('a stale revision after a failure ends the run: no retry and no false recovery notice later', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(stale({ code: 'DRAFT_STALE', currentRevision: 9 }));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok', stateRevision: 4 });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS + DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);

    useTasStore.setState({ stateRevision: 9 });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(3);
    expect(toasts().map(([v]) => v)).toEqual(['warning']);
    warn.mockRestore();
  });

  it('a stale revision is not shown to the user and not retried', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValue(stale({ code: 'DRAFT_STALE', currentRevision: 9 }));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok', stateRevision: 4 });
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual([]);
    warn.mockRestore();
  });

  it('stopping autosave cancels a pending retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValue(new Error('network'));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    stop();
    stop = null;
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SAVE_RETRY_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a discard ends the failure run: the next session warns again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValueOnce(new Error('network'));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    await discardDraftSession();

    mockSaveDraft.mockRejectedValueOnce(new Error('network'));
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok2' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(toasts().filter(([v]) => v === 'warning')).toHaveLength(2);
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

describe('saveDraftNow', () => {
  it('sends a pending edit at once and resolves when the backend has it', async () => {
    let resolveSave!: () => void;
    mockSaveDraft.mockImplementationOnce(() => new Promise<void>(r => { resolveSave = r; }));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });

    let done = false;
    const saving = saveDraftNow().then(() => { done = true; });
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(done).toBe(false);
    resolveSave();
    await saving;
    expect(done).toBe(true);
  });

  it('waits for an in-flight save and the change queued behind it', async () => {
    let resolveFirst!: () => void;
    mockSaveDraft.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    stop = startDraftAutosave(() => 'f.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    useTasStore.getState().setNonWorkedDaysOverride('1', 7);

    const saving = saveDraftNow();
    resolveFirst();
    await saving;
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft.mock.calls[1][0].ui.nonWorkedDaysOverrides).toEqual({ '1': 7 });
  });

  it('resolves without saving when nothing is pending', async () => {
    stop = startDraftAutosave(() => 'f.csv');
    await saveDraftNow();
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

describe('the copy on this PC', () => {
  const FILE = new Uint8Array([0x61, 0x62]);

  it('is written on every save, even when the backend save fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveDraft.mockRejectedValue(new Error('network'));
    startLocalCopy('oct.csv', FILE);
    stop = startDraftAutosave(() => 'oct.csv');
    useTasStore.setState({ tasView: 'verification', uploadToken: 'tok' });
    useTasStore.getState().setCardInput(7, { entry: '07:02', exit: '', swapped: false });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    const snapshot = recoverableLocalCopy()?.snapshot;
    expect(snapshot?.cardInputs).toEqual({ 7: { entry: '07:02', exit: '', swapped: false } });
    expect(snapshot?.uiVersion).toBe(DRAFT_UI_VERSION);
    warn.mockRestore();
  });

  it('starting a submission sends pending edits, then hands the session to the backend', async () => {
    startLocalCopy('oct.csv', FILE);
    stop = startDraftAutosave(() => 'oct.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    useTasStore.getState().setNonWorkedDaysOverride('1', 2);
    useTasStore.setState({ tasView: 'submitting' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft.mock.calls[0][0].view).toBe('review');
    expect(loadLocalCopy()?.submitted).toBe(true);
    expect(recoverableLocalCopy()).toBeNull();
  });

  it('is dropped when the session ends, kept when an upload or recovery fails', async () => {
    startLocalCopy('oct.csv', FILE, { tasView: 'verification' });
    stop = startDraftAutosave(() => 'oct.csv');
    useTasStore.setState({ fallbackBannerDismissed: true });
    useTasStore.setState({ tasView: 'processing' });
    useTasStore.setState({ tasView: 'idle' });
    expect(loadLocalCopy()).not.toBeNull();

    useTasStore.setState({ tasView: 'verification', uploadToken: 'tok' });
    useTasStore.getState().resetTas();
    expect(loadLocalCopy()).toBeNull();
  });

  it('is written at once even while a slow backend save is still in flight', async () => {
    let finishFirst!: () => void;
    mockSaveDraft.mockImplementationOnce(() => new Promise<void>(r => { finishFirst = r; }));
    startLocalCopy('oct.csv', FILE);
    stop = startDraftAutosave(() => 'oct.csv');
    useTasStore.setState({ tasView: 'verification', uploadToken: 'tok' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    useTasStore.getState().setCardInput(7, { entry: '07:02', exit: '15:30', swapped: false });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(recoverableLocalCopy()?.snapshot?.cardInputs).toEqual({ 7: { entry: '07:02', exit: '15:30', swapped: false } });
    finishFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
  });

  it('a submit that fails before any job starts puts the copy back in play', () => {
    startLocalCopy('oct.csv', FILE, { tasView: 'review' });
    stop = startDraftAutosave(() => 'oct.csv');
    useTasStore.setState({ tasView: 'review', uploadToken: 'tok' });
    useTasStore.setState({ tasView: 'submitting' });
    expect(recoverableLocalCopy()).toBeNull();
    useTasStore.setState({ tasView: 'review' });
    expect(recoverableLocalCopy()).not.toBeNull();
  });

  it('is dropped by a discard', async () => {
    startLocalCopy('oct.csv', FILE, { tasView: 'verification' });
    await discardDraftSession();
    expect(loadLocalCopy()).toBeNull();
  });
});

