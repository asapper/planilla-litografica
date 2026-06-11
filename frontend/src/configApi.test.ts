import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Shift, Employee, Holiday, GeneralConfig } from './configTypes';

const mockPost = vi.hoisted(() => vi.fn());
const mockGet  = vi.hoisted(() => vi.fn());
const mockPut  = vi.hoisted(() => vi.fn());
const mockPatch = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post:   mockPost,
      get:    mockGet,
      put:    mockPut,
      patch:  mockPatch,
      delete: mockDelete,
    })),
  },
}));

const {
  getShifts, createShift, updateShift, deleteShift,
  getEmployees, updateEmployee, bulkAssignShift, deactivateEmployee, updateAccruesOvertime,
  getHolidays, createHoliday, deleteHoliday, refreshHolidays,
  getGeneralConfig, updateGeneralConfig,
} = await import('./configApi');

const shift: Shift = { id: 'manana', name: 'Diurno', startTime: '08:00', endTime: '17:00', crossMidnight: false };
const employee: Employee = { id: 'emp1', code: 'EMP001', name: 'Ana García', shiftId: 'manana', shiftName: 'Diurno', active: true, accruesOvertime: true };
const holiday: Holiday = { id: 1, date: '2026-01-01', name: 'Año Nuevo', source: 'API' };
const generalConfig: GeneralConfig = { legalBreakAllowanceMinutes: 45 };

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
  mockPut.mockReset();
  mockPatch.mockReset();
  mockDelete.mockReset();
});

// -----------------------------------------------------------------
// Shifts
// -----------------------------------------------------------------

describe('getShifts', () => {
  it('gets /config/shifts and returns array', async () => {
    mockGet.mockResolvedValue({ data: [shift] });
    const result = await getShifts();
    expect(mockGet).toHaveBeenCalledWith('/config/shifts');
    expect(result).toEqual([shift]);
  });

  it('propagates errors', async () => {
    mockGet.mockRejectedValue(new Error('network'));
    await expect(getShifts()).rejects.toThrow('network');
  });
});

describe('createShift', () => {
  it('posts to /config/shifts with body and returns new shift', async () => {
    mockPost.mockResolvedValue({ data: shift });
    const body = { name: 'Diurno', startTime: '08:00', endTime: '17:00', crossMidnight: false };
    const result = await createShift(body);
    expect(mockPost).toHaveBeenCalledWith('/config/shifts', body);
    expect(result).toEqual(shift);
  });

  it('propagates errors', async () => {
    mockPost.mockRejectedValue(new Error('conflict'));
    await expect(createShift({ name: 'X', startTime: '00:00', endTime: '01:00', crossMidnight: false })).rejects.toThrow('conflict');
  });
});

describe('updateShift', () => {
  it('puts to /config/shifts/{id} and returns updated shift', async () => {
    mockPut.mockResolvedValue({ data: shift });
    const result = await updateShift('manana', { name: 'Nuevo' });
    expect(mockPut).toHaveBeenCalledWith('/config/shifts/manana', { name: 'Nuevo' });
    expect(result).toEqual(shift);
  });

  it('propagates errors', async () => {
    mockPut.mockRejectedValue(new Error('not found'));
    await expect(updateShift('nonexistent', { name: 'X' })).rejects.toThrow('not found');
  });
});

describe('deleteShift', () => {
  it('deletes /config/shifts/{id} and resolves to undefined', async () => {
    mockDelete.mockResolvedValue({});
    await expect(deleteShift('manana')).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalledWith('/config/shifts/manana');
  });

  it('propagates 409 error when shift has active employees', async () => {
    mockDelete.mockRejectedValue({ response: { status: 409, data: { error: 'SHIFT_HAS_ACTIVE_EMPLOYEES' } } });
    await expect(deleteShift('manana')).rejects.toBeDefined();
  });
});

// -----------------------------------------------------------------
// Employees
// -----------------------------------------------------------------

describe('getEmployees', () => {
  it('gets /config/employees and returns array', async () => {
    mockGet.mockResolvedValue({ data: [employee] });
    const result = await getEmployees();
    expect(mockGet).toHaveBeenCalledWith('/config/employees', { params: undefined });
    expect(result).toEqual([employee]);
  });

  it('passes query params when provided', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await getEmployees({ active: true, shiftId: 'manana', search: 'ana' });
    expect(mockGet).toHaveBeenCalledWith('/config/employees', {
      params: { active: true, shiftId: 'manana', search: 'ana' },
    });
  });
});

describe('updateEmployee', () => {
  it('puts to /config/employees/{id} and returns updated employee', async () => {
    mockPut.mockResolvedValue({ data: employee });
    const result = await updateEmployee('emp1', { shiftId: 'nocturno' });
    expect(mockPut).toHaveBeenCalledWith('/config/employees/emp1', { shiftId: 'nocturno' });
    expect(result).toEqual(employee);
  });
});

describe('bulkAssignShift', () => {
  it('posts to /config/employees/bulk-assign and resolves to undefined', async () => {
    mockPost.mockResolvedValue({});
    await expect(bulkAssignShift(['emp1', 'emp2'], 'nocturno')).resolves.toBeUndefined();
    expect(mockPost).toHaveBeenCalledWith('/config/employees/bulk-assign', { employeeIds: ['emp1', 'emp2'], shiftId: 'nocturno' });
  });
});

describe('deactivateEmployee', () => {
  it('posts to /config/employees/{id}/deactivate and resolves to undefined', async () => {
    mockPost.mockResolvedValue({});
    await expect(deactivateEmployee('emp1')).resolves.toBeUndefined();
    expect(mockPost).toHaveBeenCalledWith('/config/employees/emp1/deactivate');
  });
});

describe('updateAccruesOvertime', () => {
  it('patches /config/employees/{id}/accrues-overtime and returns updated employee', async () => {
    mockPatch.mockResolvedValue({ data: employee });
    const result = await updateAccruesOvertime('emp1', false);
    expect(mockPatch).toHaveBeenCalledWith('/config/employees/emp1/accrues-overtime', { accruesOvertime: false });
    expect(result).toEqual(employee);
  });
});

// -----------------------------------------------------------------
// Holidays
// -----------------------------------------------------------------

describe('getHolidays', () => {
  it('gets /config/holidays?year=2026 and returns array', async () => {
    mockGet.mockResolvedValue({ data: [holiday] });
    const result = await getHolidays(2026);
    expect(mockGet).toHaveBeenCalledWith('/config/holidays', { params: { year: 2026 } });
    expect(result).toEqual([holiday]);
  });
});

describe('createHoliday', () => {
  it('posts to /config/holidays with body and returns new holiday', async () => {
    mockPost.mockResolvedValue({ data: holiday });
    const body = { date: '2026-01-01', name: 'Año Nuevo' };
    const result = await createHoliday(body);
    expect(mockPost).toHaveBeenCalledWith('/config/holidays', body);
    expect(result).toEqual(holiday);
  });
});

describe('deleteHoliday', () => {
  it('deletes /config/holidays/{id} and resolves to undefined', async () => {
    mockDelete.mockResolvedValue({});
    await expect(deleteHoliday(1)).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalledWith('/config/holidays/1');
  });
});

describe('refreshHolidays', () => {
  it('posts to /config/holidays/refresh?year= and resolves to undefined', async () => {
    mockPost.mockResolvedValue({});
    await expect(refreshHolidays(2026)).resolves.toBeUndefined();
    expect(mockPost).toHaveBeenCalledWith('/config/holidays/refresh', null, { params: { year: 2026 } });
  });
});

// -----------------------------------------------------------------
// General
// -----------------------------------------------------------------

describe('getGeneralConfig', () => {
  it('gets /config/general and returns config', async () => {
    mockGet.mockResolvedValue({ data: generalConfig });
    const result = await getGeneralConfig();
    expect(mockGet).toHaveBeenCalledWith('/config/general');
    expect(result).toEqual(generalConfig);
  });
});

describe('updateGeneralConfig', () => {
  it('puts to /config/general and returns updated config', async () => {
    mockPut.mockResolvedValue({ data: generalConfig });
    const result = await updateGeneralConfig({ legalBreakAllowanceMinutes: 45 });
    expect(mockPut).toHaveBeenCalledWith('/config/general', { legalBreakAllowanceMinutes: 45 });
    expect(result).toEqual(generalConfig);
  });
});
