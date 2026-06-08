import { create } from 'zustand';
import type { Shift, Employee, Holiday, GeneralConfig, ConfigTab } from './configTypes';

interface TabState<T> {
  loading: boolean;
  data: T | null;
  dirty: boolean;
  error: string | null;
}

interface ConfigStore {
  activeTab: ConfigTab;
  shifts: TabState<Shift[]>;
  employees: TabState<Employee[]>;
  holidays: TabState<Holiday[]>;
  general: TabState<GeneralConfig>;
  toastVisible: boolean;
  toastMessage: string;
  holidayYear: number;

  setActiveTab: (tab: ConfigTab) => void;

  setShiftsLoading: (v: boolean) => void;
  setShiftsData: (data: Shift[]) => void;
  setShiftsDirty: (v: boolean) => void;
  setShiftsError: (msg: string | null) => void;

  setEmployeesLoading: (v: boolean) => void;
  setEmployeesData: (data: Employee[]) => void;
  setEmployeesDirty: (v: boolean) => void;
  setEmployeesError: (msg: string | null) => void;

  setHolidaysLoading: (v: boolean) => void;
  setHolidaysData: (data: Holiday[]) => void;
  setHolidaysDirty: (v: boolean) => void;
  setHolidaysError: (msg: string | null) => void;

  setGeneralLoading: (v: boolean) => void;
  setGeneralData: (data: GeneralConfig) => void;
  setGeneralDirty: (v: boolean) => void;
  setGeneralError: (msg: string | null) => void;

  showToast: (message: string) => void;
  hideToast: () => void;

  setHolidayYear: (year: number) => void;
}

function makeTabState<T>(): TabState<T> {
  return { loading: false, data: null, dirty: false, error: null };
}

export const useConfigStore = create<ConfigStore>(set => ({
  activeTab: 'shifts',
  shifts: makeTabState<Shift[]>(),
  employees: makeTabState<Employee[]>(),
  holidays: makeTabState<Holiday[]>(),
  general: makeTabState<GeneralConfig>(),
  toastVisible: false,
  toastMessage: '',
  holidayYear: new Date().getFullYear(),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setShiftsLoading: (v) => set(s => ({ shifts: { ...s.shifts, loading: v } })),
  setShiftsData: (data) => set(s => ({ shifts: { ...s.shifts, data, error: null } })),
  setShiftsDirty: (v) => set(s => ({ shifts: { ...s.shifts, dirty: v } })),
  setShiftsError: (msg) => set(s => ({ shifts: { ...s.shifts, error: msg } })),

  setEmployeesLoading: (v) => set(s => ({ employees: { ...s.employees, loading: v } })),
  setEmployeesData: (data) => set(s => ({ employees: { ...s.employees, data, error: null } })),
  setEmployeesDirty: (v) => set(s => ({ employees: { ...s.employees, dirty: v } })),
  setEmployeesError: (msg) => set(s => ({ employees: { ...s.employees, error: msg } })),

  setHolidaysLoading: (v) => set(s => ({ holidays: { ...s.holidays, loading: v } })),
  setHolidaysData: (data) => set(s => ({ holidays: { ...s.holidays, data, error: null } })),
  setHolidaysDirty: (v) => set(s => ({ holidays: { ...s.holidays, dirty: v } })),
  setHolidaysError: (msg) => set(s => ({ holidays: { ...s.holidays, error: msg } })),

  setGeneralLoading: (v) => set(s => ({ general: { ...s.general, loading: v } })),
  setGeneralData: (data) => set(s => ({ general: { ...s.general, data, error: null } })),
  setGeneralDirty: (v) => set(s => ({ general: { ...s.general, dirty: v } })),
  setGeneralError: (msg) => set(s => ({ general: { ...s.general, error: msg } })),

  showToast: (message) => set({ toastVisible: true, toastMessage: message }),
  hideToast: () => set({ toastVisible: false }),

  setHolidayYear: (year) => set({ holidayYear: year }),
}));
