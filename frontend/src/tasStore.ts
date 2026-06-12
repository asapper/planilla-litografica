import { create } from 'zustand';
import type { TasView, TasSession, InactiveEmployee, InactiveDecision, AbsentEmployee, ResolvedRow, TasPeriod, ShiftOption } from './tasTypes';

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
  usedFallbackHolidays: boolean;
  fallbackBannerDismissed: boolean;
  jobId: string | null;
  error: string | null;

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
  setError: (msg: string | null) => void;
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
  usedFallbackHolidays: false,
  fallbackBannerDismissed: false,
  jobId: null,
  error: null,
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
  setUsedFallbackHolidays: (v) => set({ usedFallbackHolidays: v }),
  dismissFallbackBanner: () => set({ fallbackBannerDismissed: true }),
  setJobId: (id) => set({ jobId: id }),
  setError: (msg) => set({ error: msg }),
  resetTas: () => set({ ...initialState }),
}));
