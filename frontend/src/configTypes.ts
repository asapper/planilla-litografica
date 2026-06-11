export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  crossMidnight: boolean;
}

export interface Employee {
  id: string;
  code: string;
  name: string;
  shiftId: string | null;
  shiftName: string | null;
  active: boolean;
  accruesOvertime: boolean;
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
