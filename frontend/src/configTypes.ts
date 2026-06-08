export interface Shift {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  crossMidnight: boolean;
}

export interface Employee {
  id: number;
  code: string;
  name: string;
  shiftId: number | null;
  shiftName: string | null;
  active: boolean;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
  source: 'API' | 'Manual';
}

export interface GeneralConfig {
  legalBreakAllowanceMinutes: number;
}

export type ConfigTab = 'shifts' | 'employees' | 'holidays' | 'general';
