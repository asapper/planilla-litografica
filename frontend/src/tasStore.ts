import { create } from 'zustand';
import { adjustedDecision, approvedDecision, periodKey, type ByPeriod, type OvertimeDecision, type OvertimeField } from './overtime';
import type { TasView, TasSession, InactiveEmployee, InactiveDecision, AbsentEmployee, ResolvedRow, TasPeriod, ShiftOption, SessionSummary, DoubleChoice } from './tasTypes';

export interface ResolvedSessionEntry {
  resolvedStart: string;
  resolvedEnd: string;
  // Set for swapped single-scan sessions: day offsets relative to the session date
  // (the recorded scan's date), so an overnight day lands on the right calendar days.
  startDayOffset?: -1 | 0;
  endDayOffset?: 0 | 1;
}

// What a verification card shows, saved as it is typed so a half-filled card survives a restart.
export interface CardInput {
  entry: string;
  exit: string;
  swapped: boolean;
}

export type ReviewFilter = 'review' | 'all' | 'estimated' | 'duplicate' | 'adjusted';

function withEntry<T>(byPeriod: ByPeriod<T>, key: string, code: string, value: T): ByPeriod<T> {
  return { ...byPeriod, [key]: { ...byPeriod[key], [code]: value } };
}

function withoutEntry<T>(byPeriod: ByPeriod<T>, key: string, code: string): ByPeriod<T> {
  const { [code]: _, ...rest } = byPeriod[key] ?? {};
  return { ...byPeriod, [key]: rest };
}

export interface TasStore {
  tasView: TasView;
  uploadToken: string | null;
  stateRevision: number;
  processingMessage: string;
  flaggedSessions: TasSession[];
  resolvedSessions: Record<number, ResolvedSessionEntry>;
  cardInputs: Record<number, CardInput>;
  shiftAcceptances: Record<number, string>;
  sameDayDoubleResolutions: Record<string, DoubleChoice>;
  resolvedRowCount: number;
  resolvedRows: ResolvedRow[];
  availablePeriods: TasPeriod[];
  selectedPeriod: TasPeriod | null;
  inactiveEmployees: InactiveEmployee[];
  inactiveDecisions: Record<string, InactiveDecision>;
  absentEmployees: AbsentEmployee[];
  warnings: string[];
  usedFallbackHolidays: boolean;
  fallbackBannerDismissed: boolean;
  jobId: string | null;
  jobResult: { submitted: number; skipped: number; failed: number; attemptNumber: number; maxRetries: number } | null;
  error: string | null;
  sessionSummaries: Record<string, SessionSummary[]>;
  overtimeDecisions: ByPeriod<OvertimeDecision>;
  stashedOvertimeDecisions: ByPeriod<OvertimeDecision>;
  nonWorkedDaysOverrides: ByPeriod<number>;
  stashedNonWorkedDaysOverrides: ByPeriod<number>;
  duplicateCodes: string[];
  duplicatesLoading: boolean;
  reviewSelectedEmployee: string | null;
  reviewSortColumn: 'name' | 'code';
  reviewSortDirection: 'asc' | 'desc';
  reviewActiveFilter: ReviewFilter;
  reviewExpandedScans: Set<string>;

  setWarnings: (warnings: string[]) => void;
  setTasView: (view: TasView) => void;
  setUploadToken: (token: string | null) => void;
  setStateRevision: (revision: number) => void;
  setProcessingMessage: (msg: string) => void;
  setFlaggedSessions: (sessions: TasSession[]) => void;
  setResolvedSession: (id: number, entry: ResolvedSessionEntry) => void;
  setCardInput: (id: number, input: CardInput) => void;
  clearCardInput: (id: number) => void;
  clearResolvedSession: (id: number) => void;
  clearResolvedSessions: () => void;
  setShiftAcceptance: (sessionId: number, acceptedShiftId: string) => void;
  setSameDayDoubleResolution: (groupKey: string, keepSessionId: DoubleChoice) => void;
  setResolvedRowCount: (count: number) => void;
  setResolvedRows: (rows: ResolvedRow[]) => void;
  availableShifts: ShiftOption[];
  setAvailableShifts: (shifts: ShiftOption[]) => void;
  setAvailablePeriods: (periods: TasPeriod[]) => void;
  setSelectedPeriod: (period: TasPeriod | null) => void;
  setInactiveEmployees: (employees: InactiveEmployee[]) => void;
  setInactiveDecision: (employeeId: string, decision: InactiveDecision) => void;
  setAbsentEmployees: (employees: AbsentEmployee[]) => void;
  setUsedFallbackHolidays: (v: boolean) => void;
  dismissFallbackBanner: () => void;
  setJobId: (id: string | null) => void;
  setJobResult: (result: { submitted: number; skipped: number; failed: number; attemptNumber: number; maxRetries: number } | null) => void;
  setError: (msg: string | null) => void;
  setSessionSummaries: (summaries: Record<string, SessionSummary[]>) => void;
  setOvertimeField: (row: ResolvedRow, field: OvertimeField, value: number) => void;
  approveOvertime: (row: ResolvedRow) => void;
  clearOvertimeDecision: (codigoEmpleado: string) => void;
  setNonWorkedDaysOverride: (codigoEmpleado: string, value: number) => void;
  removeNonWorkedDaysOverride: (codigoEmpleado: string) => void;
  stashNonWorkedDaysOverride: (codigoEmpleado: string) => void;
  restoreNonWorkedDaysOverride: (codigoEmpleado: string) => void;
  stashOvertimeDecision: (codigoEmpleado: string) => void;
  restoreOvertimeDecision: (codigoEmpleado: string) => void;
  setDuplicateCodes: (codes: string[]) => void;
  setDuplicatesLoading: (loading: boolean) => void;
  setReviewSelectedEmployee: (code: string | null) => void;
  setReviewSort: (column: 'name' | 'code', direction: 'asc' | 'desc') => void;
  setReviewActiveFilter: (filter: ReviewFilter) => void;
  toggleReviewScanExpanded: (dateKey: string) => void;
  setAllScansExpanded: (keys: string[]) => void;
  clearAllScansExpanded: () => void;
  resetTas: () => void;
}

export const tasInitialState = {
  tasView: 'idle' as TasView,
  uploadToken: null as string | null,
  stateRevision: 0,
  processingMessage: '',
  flaggedSessions: [],
  resolvedSessions: {},
  cardInputs: {} as Record<number, CardInput>,
  shiftAcceptances: {} as Record<number, string>,
  sameDayDoubleResolutions: {} as Record<string, DoubleChoice>,
  resolvedRowCount: 0,
  resolvedRows: [] as ResolvedRow[],
  availableShifts: [] as ShiftOption[],
  availablePeriods: [] as TasPeriod[],
  selectedPeriod: null as TasPeriod | null,
  inactiveEmployees: [],
  inactiveDecisions: {},
  absentEmployees: [],
  warnings: [] as string[],
  usedFallbackHolidays: false,
  fallbackBannerDismissed: false,
  jobId: null,
  jobResult: null,
  error: null,
  sessionSummaries: {} as Record<string, SessionSummary[]>,
  overtimeDecisions: {} as ByPeriod<OvertimeDecision>,
  stashedOvertimeDecisions: {} as ByPeriod<OvertimeDecision>,
  nonWorkedDaysOverrides: {} as ByPeriod<number>,
  stashedNonWorkedDaysOverrides: {} as ByPeriod<number>,
  duplicateCodes: [] as string[],
  duplicatesLoading: false,
  reviewSelectedEmployee: null,
  reviewSortColumn: 'name' as const,
  reviewSortDirection: 'asc' as const,
  reviewActiveFilter: 'review' as ReviewFilter,
  reviewExpandedScans: new Set<string>(),
};

export const useTasStore = create<TasStore>(set => ({
  ...tasInitialState,

  // Each time the review opens, it opens on what still needs a decision.
  setTasView: (view) => set(s => (view === 'review' && s.tasView !== 'review'
    ? { tasView: view, reviewActiveFilter: 'review' }
    : { tasView: view })),
  setUploadToken: (token) => set({ uploadToken: token }),
  setStateRevision: (revision) => set({ stateRevision: revision }),
  setProcessingMessage: (msg) => set({ processingMessage: msg }),
  setFlaggedSessions: (sessions) => set({ flaggedSessions: sessions }),
  setResolvedSession: (id, entry) => set(s => ({
    resolvedSessions: { ...s.resolvedSessions, [id]: entry },
  })),
  clearResolvedSession: (id) => set(s => {
    const { [id]: _, ...rest } = s.resolvedSessions;
    return { resolvedSessions: rest };
  }),
  setCardInput: (id, input) => set(s => ({ cardInputs: { ...s.cardInputs, [id]: input } })),
  clearCardInput: (id) => set(s => {
    const { [id]: _, ...rest } = s.cardInputs;
    return { cardInputs: rest };
  }),
  clearResolvedSessions: () => set({ resolvedSessions: {}, cardInputs: {}, shiftAcceptances: {}, sameDayDoubleResolutions: {} }),
  setShiftAcceptance: (sessionId, acceptedShiftId) => set(s => ({
    shiftAcceptances: { ...s.shiftAcceptances, [sessionId]: acceptedShiftId },
  })),
  setSameDayDoubleResolution: (groupKey, keepSessionId) => set(s => ({
    sameDayDoubleResolutions: { ...s.sameDayDoubleResolutions, [groupKey]: keepSessionId },
  })),
  setResolvedRowCount: (count) => set({ resolvedRowCount: count }),
  setResolvedRows: (rows) => set({ resolvedRows: rows }),
  setAvailableShifts: (shifts) => set({ availableShifts: shifts }),
  setAvailablePeriods: (periods) => set(s => {
    const stillValid = s.selectedPeriod !== null && periods.some(
      p => p.anio === s.selectedPeriod!.anio
        && p.mes === s.selectedPeriod!.mes
        && p.numeroDequincena === s.selectedPeriod!.numeroDequincena,
    );
    return {
      availablePeriods: periods,
      selectedPeriod: stillValid ? s.selectedPeriod : (periods[0] ?? null),
    };
  }),
  setSelectedPeriod: (period) => set({ selectedPeriod: period }),
  setInactiveEmployees: (employees) => set({ inactiveEmployees: employees }),
  setInactiveDecision: (employeeId, decision) => set(s => ({
    inactiveDecisions: { ...s.inactiveDecisions, [employeeId]: decision },
  })),
  setAbsentEmployees: (employees) => set({ absentEmployees: employees }),
  setWarnings: (warnings) => set({ warnings }),
  setUsedFallbackHolidays: (v) => set({ usedFallbackHolidays: v }),
  dismissFallbackBanner: () => set({ fallbackBannerDismissed: true }),
  setJobId: (id) => set({ jobId: id }),
  setJobResult: (result) => set({ jobResult: result }),
  setError: (msg) => set({ error: msg }),
  setSessionSummaries: (summaries) => set({ sessionSummaries: summaries }),
  setOvertimeField: (row, field, value) => set(s => {
    const key = periodKey(s.selectedPeriod);
    const decision = adjustedDecision(row, s.overtimeDecisions[key]?.[row.codigoEmpleado], field, value);
    return { overtimeDecisions: withEntry(s.overtimeDecisions, key, row.codigoEmpleado, decision) };
  }),
  approveOvertime: (row) => set(s => ({
    overtimeDecisions: withEntry(s.overtimeDecisions, periodKey(s.selectedPeriod), row.codigoEmpleado, approvedDecision(row)),
  })),
  clearOvertimeDecision: (codigoEmpleado) => set(s => ({
    overtimeDecisions: withoutEntry(s.overtimeDecisions, periodKey(s.selectedPeriod), codigoEmpleado),
  })),
  setNonWorkedDaysOverride: (codigoEmpleado, value) => set(s => ({
    nonWorkedDaysOverrides: withEntry(s.nonWorkedDaysOverrides, periodKey(s.selectedPeriod), codigoEmpleado, value),
  })),
  removeNonWorkedDaysOverride: (codigoEmpleado) => set(s => ({
    nonWorkedDaysOverrides: withoutEntry(s.nonWorkedDaysOverrides, periodKey(s.selectedPeriod), codigoEmpleado),
  })),
  stashNonWorkedDaysOverride: (codigoEmpleado) => set(s => {
    const key = periodKey(s.selectedPeriod);
    const current = s.nonWorkedDaysOverrides[key]?.[codigoEmpleado];
    if (current === undefined) return s;
    return {
      nonWorkedDaysOverrides: withoutEntry(s.nonWorkedDaysOverrides, key, codigoEmpleado),
      stashedNonWorkedDaysOverrides: withEntry(s.stashedNonWorkedDaysOverrides, key, codigoEmpleado, current),
    };
  }),
  restoreNonWorkedDaysOverride: (codigoEmpleado) => set(s => {
    const key = periodKey(s.selectedPeriod);
    const stashed = s.stashedNonWorkedDaysOverrides[key]?.[codigoEmpleado];
    if (stashed === undefined) return s;
    return {
      nonWorkedDaysOverrides: withEntry(s.nonWorkedDaysOverrides, key, codigoEmpleado, stashed),
      stashedNonWorkedDaysOverrides: withoutEntry(s.stashedNonWorkedDaysOverrides, key, codigoEmpleado),
    };
  }),
  stashOvertimeDecision: (codigoEmpleado) => set(s => {
    const key = periodKey(s.selectedPeriod);
    const current = s.overtimeDecisions[key]?.[codigoEmpleado];
    if (!current) return s;
    return {
      overtimeDecisions: withoutEntry(s.overtimeDecisions, key, codigoEmpleado),
      stashedOvertimeDecisions: withEntry(s.stashedOvertimeDecisions, key, codigoEmpleado, current),
    };
  }),
  restoreOvertimeDecision: (codigoEmpleado) => set(s => {
    const key = periodKey(s.selectedPeriod);
    const stashed = s.stashedOvertimeDecisions[key]?.[codigoEmpleado];
    if (!stashed) return s;
    return {
      overtimeDecisions: withEntry(s.overtimeDecisions, key, codigoEmpleado, stashed),
      stashedOvertimeDecisions: withoutEntry(s.stashedOvertimeDecisions, key, codigoEmpleado),
    };
  }),
  setDuplicateCodes: (codes) => set({ duplicateCodes: codes }),
  setDuplicatesLoading: (loading) => set({ duplicatesLoading: loading }),
  setReviewSelectedEmployee: (code) => set({ reviewSelectedEmployee: code }),
  setReviewSort: (column, direction) => set({ reviewSortColumn: column, reviewSortDirection: direction }),
  setReviewActiveFilter: (filter) => set({ reviewActiveFilter: filter }),
  toggleReviewScanExpanded: (dateKey) => set(s => {
    const next = new Set(s.reviewExpandedScans);
    if (next.has(dateKey)) next.delete(dateKey);
    else next.add(dateKey);
    return { reviewExpandedScans: next };
  }),
  setAllScansExpanded: (keys) => set({ reviewExpandedScans: new Set(keys) }),
  clearAllScansExpanded: () => set({ reviewExpandedScans: new Set() }),
  resetTas: () => set({ ...tasInitialState }),
}));

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ZUSTAND_TAS_STORE__ = useTasStore;
}
