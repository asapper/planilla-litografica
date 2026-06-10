import axios from 'axios';
import type { Shift, Employee, Holiday, GeneralConfig } from './configTypes';

const client = axios.create({
  baseURL: 'http://localhost:49301/api',
  timeout: 30_000,
});

// Shifts
export const getShifts = (): Promise<Shift[]> =>
  client.get<Shift[]>('/config/shifts').then(r => r.data);

export const createShift = (body: { name: string; startTime: string; endTime: string; crossMidnight: boolean }): Promise<Shift> =>
  client.post<Shift>('/config/shifts', body).then(r => r.data);

export const updateShift = (id: string, body: Partial<{ name: string; startTime: string; endTime: string; crossMidnight: boolean }>): Promise<Shift> =>
  client.put<Shift>(`/config/shifts/${id}`, body).then(r => r.data);

export const deleteShift = (id: string): Promise<void> =>
  client.delete(`/config/shifts/${id}`).then(() => undefined);

// Employees
export const getEmployees = (params?: { active?: boolean; shiftId?: string; search?: string }): Promise<Employee[]> =>
  client.get<Employee[]>('/config/employees', { params }).then(r => r.data);

export const updateEmployee = (id: string, body: { shiftId?: string | null; active?: boolean }): Promise<Employee> =>
  client.put<Employee>(`/config/employees/${id}`, body).then(r => r.data);

export const bulkAssignShift = (employeeIds: string[], shiftId: string): Promise<void> =>
  client.post('/config/employees/bulk-assign', { employeeIds, shiftId }).then(() => undefined);

export const deactivateEmployee = (id: string): Promise<void> =>
  client.post(`/config/employees/${id}/deactivate`).then(() => undefined);

// Holidays
export const getHolidays = (year: number): Promise<Holiday[]> =>
  client.get<Holiday[]>('/config/holidays', { params: { year } }).then(r => r.data);

export const createHoliday = (body: { date: string; name: string }): Promise<Holiday> =>
  client.post<Holiday>('/config/holidays', body).then(r => r.data);

export const deleteHoliday = (id: number): Promise<void> =>
  client.delete(`/config/holidays/${id}`).then(() => undefined);

export const refreshHolidays = (year: number): Promise<void> =>
  client.post('/config/holidays/refresh', null, { params: { year } }).then(() => undefined);

// General
export const getGeneralConfig = (): Promise<GeneralConfig> =>
  client.get<GeneralConfig>('/config/general').then(r => r.data);

export const updateGeneralConfig = (body: { legalBreakAllowanceMinutes: number }): Promise<GeneralConfig> =>
  client.put<GeneralConfig>('/config/general', body).then(r => r.data);
