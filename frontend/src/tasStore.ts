import { create } from 'zustand';
import type { TasView, TasSession, InactiveEmployee, InactiveDecision, AbsentEmployee } from './tasTypes';

export interface ResolvedSessionEntry {
  resolvedStart: string;
  resolvedEnd: string;
  updateShift?: boolean;
}

interface TasStore {
  tasView: TasView;
  uploadToken: string | null;
  processingMessage: string;
  flaggedSessions: TasSession[];
  resolvedSessions: Record<number, ResolvedSessionEntry>;
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
  clearResolvedSessions: () => set({ resolvedSessions: {} }),
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
