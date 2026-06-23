import { create } from 'zustand';
import type { TasView, TasSession, InactiveEmployee, InactiveDecision, AbsentEmployee, ResolvedRow, TasPeriod, ShiftOption, SessionSummary } from './tasTypes';

export interface ResolvedSessionEntry {
  resolvedStart: string;
  resolvedEnd: string;
}

interface TasStore {
  tasView: TasView;
  uploadToken: string | null;
  processingMessage: string;
  flaggedSessions: TasSession[];
  resolvedSessions: Record<number, ResolvedSessionEntry>;
  shiftAcceptances: Record<number, string>;
  sameDayDoubleResolutions: Record<string, number | 'all'>;
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
  overtimeOverrides: Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>;
  stashedOvertimeOverrides: Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>;
  duplicateCodes: string[];
  duplicatesLoading: boolean;
  reviewSelectedEmployee: string | null;
  reviewSortColumn: 'name' | 'code';
  reviewSortDirection: 'asc' | 'desc';
  reviewActiveFilter: 'all' | 'estimated' | 'duplicate' | 'adjusted';
  reviewExpandedScans: Set<string>;

  setWarnings: (warnings: string[]) => void;
  setTasView: (view: TasView) => void;
  setUploadToken: (token: string | null) => void;
  setProcessingMessage: (msg: string) => void;
  setFlaggedSessions: (sessions: TasSession[]) => void;
  setResolvedSession: (id: number, entry: ResolvedSessionEntry) => void;
  clearResolvedSessions: () => void;
  setShiftAcceptance: (sessionId: number, acceptedShiftId: string) => void;
  setSameDayDoubleResolution: (groupKey: string, keepSessionId: number | 'all') => void;
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
  setOvertimeOverride: (codigoEmpleado: string, field: 'horasExtrasSimples' | 'horasExtrasDobles', value: number) => void;
  clearOvertimeOverrides: () => void;
  stashOvertimeOverrides: (codigoEmpleado: string) => void;
  restoreOvertimeOverrides: (codigoEmpleado: string) => void;
  setDuplicateCodes: (codes: string[]) => void;
  setDuplicatesLoading: (loading: boolean) => void;
  setReviewSelectedEmployee: (code: string | null) => void;
  setReviewSort: (column: 'name' | 'code', direction: 'asc' | 'desc') => void;
  setReviewActiveFilter: (filter: 'all' | 'estimated' | 'duplicate' | 'adjusted') => void;
  toggleReviewScanExpanded: (dateKey: string) => void;
  setAllScansExpanded: (keys: string[]) => void;
  clearAllScansExpanded: () => void;
  resetTas: () => void;
}

const initialState = {
  tasView: 'idle' as TasView,
  uploadToken: null,
  processingMessage: '',
  flaggedSessions: [],
  resolvedSessions: {},
  shiftAcceptances: {} as Record<number, string>,
  sameDayDoubleResolutions: {} as Record<string, number | 'all'>,
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
  overtimeOverrides: {} as Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>,
  stashedOvertimeOverrides: {} as Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>,
  duplicateCodes: [] as string[],
  duplicatesLoading: false,
  reviewSelectedEmployee: null,
  reviewSortColumn: 'name' as const,
  reviewSortDirection: 'asc' as const,
  reviewActiveFilter: 'all' as const,
  reviewExpandedScans: new Set<string>(),
};

export const useTasStore = create<TasStore>(set => ({
  ...initialState,

  setTasView: (view) => set({ tasView: view }),
  setUploadToken: (token) => set({ uploadToken: token }),
  setProcessingMessage: (msg) => set({ processingMessage: msg }),
  setFlaggedSessions: (sessions) => set({ flaggedSessions: sessions }),
  setResolvedSession: (id, entry) => set(s => ({
    resolvedSessions: { ...s.resolvedSessions, [id]: entry },
  })),
  clearResolvedSessions: () => set({ resolvedSessions: {}, shiftAcceptances: {}, sameDayDoubleResolutions: {} }),
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
  setOvertimeOverride: (codigoEmpleado, field, value) => set(s => ({
    overtimeOverrides: {
      ...s.overtimeOverrides,
      [codigoEmpleado]: { ...s.overtimeOverrides[codigoEmpleado], [field]: value },
    },
  })),
  clearOvertimeOverrides: () => set({ overtimeOverrides: {} }),
  stashOvertimeOverrides: (codigoEmpleado) => set(s => {
    const current = s.overtimeOverrides[codigoEmpleado];
    if (!current) return s;
    const { [codigoEmpleado]: _, ...rest } = s.overtimeOverrides;
    return {
      overtimeOverrides: rest,
      stashedOvertimeOverrides: { ...s.stashedOvertimeOverrides, [codigoEmpleado]: current },
    };
  }),
  restoreOvertimeOverrides: (codigoEmpleado) => set(s => {
    const stashed = s.stashedOvertimeOverrides[codigoEmpleado];
    if (!stashed) return s;
    const { [codigoEmpleado]: _, ...rest } = s.stashedOvertimeOverrides;
    return {
      overtimeOverrides: { ...s.overtimeOverrides, [codigoEmpleado]: stashed },
      stashedOvertimeOverrides: rest,
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
  resetTas: () => set({ ...initialState }),
}));
