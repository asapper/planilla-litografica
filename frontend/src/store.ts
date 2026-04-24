import { create } from 'zustand';
import type {
  AppState, EmployeeRow, MonthOption,
  ValidateResponse, SubmitResponse, JobResponse,
} from './types';

interface AppStore {
  appState: AppState;
  rows: EmployeeRow[];
  monthOptions: MonthOption[];
  multiMonth: boolean;
  parseWarnings: string[];
  selectedQuincena: number | null;
  selectedMonth: MonthOption | null;
  validation: ValidateResponse | null;
  submitResult: SubmitResponse | null;
  dbReachable: boolean | null;
  jobId: string | null;
  jobResponse: JobResponse | null;

  setLoaded: (
    rows: EmployeeRow[],
    monthOptions: MonthOption[],
    multiMonth: boolean,
    warnings: string[]
  ) => void;
  setQuincena: (q: number) => void;
  setMonth: (m: MonthOption) => void;
  setValidation: (v: ValidateResponse) => void;
  updateRow: (index: number, updated: Partial<EmployeeRow>) => void;
  setSubmitting: () => void;
  cancelSubmit: () => void;
  setPolling: (jobId: string) => void;
  updateJobResponse: (r: JobResponse) => void;
  setResult: (r: SubmitResponse) => void;
  setDbReachable: (v: boolean) => void;
  reset: () => void;

  // Derived: rows with quincena + selected month injected
  getRowsForSubmit: () => EmployeeRow[];
}

export const useStore = create<AppStore>((set, get) => ({
  appState: 'empty',
  rows: [],
  monthOptions: [],
  multiMonth: false,
  parseWarnings: [],
  selectedQuincena: null,
  selectedMonth: null,
  validation: null,
  submitResult: null,
  dbReachable: null,
  jobId: null,
  jobResponse: null,

  setLoaded: (rows, monthOptions, multiMonth, warnings) => set({
    appState: 'loaded',
    rows,
    monthOptions,
    multiMonth,
    parseWarnings: warnings,
    selectedQuincena: null,
    selectedMonth: multiMonth ? null : (monthOptions[0] ?? null),
    validation: null,
    submitResult: null,
    dbReachable: null,
    jobId: null,
    jobResponse: null,
  }),

  setQuincena: (q) => set({ selectedQuincena: q, validation: null, dbReachable: null }),
  setMonth: (m) => set({ selectedMonth: m, validation: null, dbReachable: null }),
  setValidation: (v) => set({ validation: v }),

  updateRow: (index, updated) => set(state => {
    const rows = [...state.rows];
    rows[index] = { ...rows[index], ...updated };
    return { rows, validation: null, dbReachable: null };
  }),

  setSubmitting: () => set({ appState: 'submitting' }),
  cancelSubmit: () => set({ appState: 'loaded' }),
  setPolling: (jobId) => set({ appState: 'polling', jobId, jobResponse: null }),
  updateJobResponse: (r) => set({ jobResponse: r }),
  setResult: (r) => set({ appState: 'result', submitResult: r }),
  setDbReachable: (v) => set({ dbReachable: v }),
  reset: () => set({
    appState: 'empty',
    rows: [], monthOptions: [], multiMonth: false,
    parseWarnings: [], selectedQuincena: null,
    selectedMonth: null, validation: null, submitResult: null,
    dbReachable: null, jobId: null, jobResponse: null,
  }),

  getRowsForSubmit: () => {
    const { rows, multiMonth, selectedQuincena, selectedMonth } = get();
    const filtered = multiMonth && selectedMonth
      ? rows.filter(r => r.mes === selectedMonth.mes && r.anio === selectedMonth.anio)
      : rows;
    return filtered.map(row => ({
      ...row,
      numeroDequincena: selectedQuincena ?? undefined,
      mes: selectedMonth?.mes ?? row.mes,
      anio: selectedMonth?.anio ?? row.anio,
    }));
  },
}));
