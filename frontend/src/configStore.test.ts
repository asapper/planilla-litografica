import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigStore } from './configStore';
import type { Shift, Employee, Holiday, GeneralConfig } from './configTypes';

const shift: Shift = { id: 'manana', name: 'Diurno', startTime: '08:00', endTime: '17:00', crossMidnight: false };
const employee: Employee = { id: 'emp1', code: 'EMP001', name: 'Ana García', shiftId: 'manana', shiftName: 'Diurno', active: true };
const holiday: Holiday = { id: 1, date: '2026-01-01', name: 'Año Nuevo', source: 'API' };
const generalConfig: GeneralConfig = { legalBreakAllowanceMinutes: 45 };

beforeEach(() => {
  useConfigStore.setState({
    activeTab: 'shifts',
    shifts: { loading: false, data: null, dirty: false, error: null },
    employees: { loading: false, data: null, dirty: false, error: null },
    holidays: { loading: false, data: null, dirty: false, error: null },
    general: { loading: false, data: null, dirty: false, error: null },
    toastVisible: false,
    toastMessage: '',
    holidayYear: new Date().getFullYear(),
  });
});

// -----------------------------------------------------------------
// Initial state
// -----------------------------------------------------------------

describe('initial state', () => {
  it('activeTab defaults to shifts', () => {
    expect(useConfigStore.getState().activeTab).toBe('shifts');
  });

  it('all tab states start clean', () => {
    const s = useConfigStore.getState();
    for (const tab of ['shifts', 'employees', 'holidays', 'general'] as const) {
      expect(s[tab].loading).toBe(false);
      expect(s[tab].data).toBeNull();
      expect(s[tab].dirty).toBe(false);
      expect(s[tab].error).toBeNull();
    }
  });

  it('toast starts hidden', () => {
    expect(useConfigStore.getState().toastVisible).toBe(false);
    expect(useConfigStore.getState().toastMessage).toBe('');
  });
});

// -----------------------------------------------------------------
// setActiveTab
// -----------------------------------------------------------------

describe('setActiveTab', () => {
  it('switches to employees tab', () => {
    useConfigStore.getState().setActiveTab('employees');
    expect(useConfigStore.getState().activeTab).toBe('employees');
  });

  it('switches to holidays tab', () => {
    useConfigStore.getState().setActiveTab('holidays');
    expect(useConfigStore.getState().activeTab).toBe('holidays');
  });

  it('switches to general tab', () => {
    useConfigStore.getState().setActiveTab('general');
    expect(useConfigStore.getState().activeTab).toBe('general');
  });
});

// -----------------------------------------------------------------
// Shifts tab actions
// -----------------------------------------------------------------

describe('shifts tab', () => {
  it('setShiftsLoading updates loading state', () => {
    useConfigStore.getState().setShiftsLoading(true);
    expect(useConfigStore.getState().shifts.loading).toBe(true);
    useConfigStore.getState().setShiftsLoading(false);
    expect(useConfigStore.getState().shifts.loading).toBe(false);
  });

  it('setShiftsData stores data and clears error', () => {
    useConfigStore.getState().setShiftsError('some error');
    useConfigStore.getState().setShiftsData([shift]);
    expect(useConfigStore.getState().shifts.data).toEqual([shift]);
    expect(useConfigStore.getState().shifts.error).toBeNull();
  });

  it('setShiftsDirty marks tab as dirty', () => {
    useConfigStore.getState().setShiftsDirty(true);
    expect(useConfigStore.getState().shifts.dirty).toBe(true);
  });

  it('setShiftsDirty can clear dirty flag', () => {
    useConfigStore.getState().setShiftsDirty(true);
    useConfigStore.getState().setShiftsDirty(false);
    expect(useConfigStore.getState().shifts.dirty).toBe(false);
  });

  it('setShiftsError stores error message', () => {
    useConfigStore.getState().setShiftsError('Network error');
    expect(useConfigStore.getState().shifts.error).toBe('Network error');
  });

  it('setShiftsError can clear error', () => {
    useConfigStore.getState().setShiftsError('error');
    useConfigStore.getState().setShiftsError(null);
    expect(useConfigStore.getState().shifts.error).toBeNull();
  });

  it('shifts data change does not affect employees tab', () => {
    useConfigStore.getState().setShiftsData([shift]);
    expect(useConfigStore.getState().employees.data).toBeNull();
  });
});

// -----------------------------------------------------------------
// Employees tab actions
// -----------------------------------------------------------------

describe('employees tab', () => {
  it('setEmployeesLoading updates loading state', () => {
    useConfigStore.getState().setEmployeesLoading(true);
    expect(useConfigStore.getState().employees.loading).toBe(true);
  });

  it('setEmployeesData stores data and clears error', () => {
    useConfigStore.getState().setEmployeesError('error');
    useConfigStore.getState().setEmployeesData([employee]);
    expect(useConfigStore.getState().employees.data).toEqual([employee]);
    expect(useConfigStore.getState().employees.error).toBeNull();
  });

  it('setEmployeesDirty marks tab as dirty', () => {
    useConfigStore.getState().setEmployeesDirty(true);
    expect(useConfigStore.getState().employees.dirty).toBe(true);
  });

  it('setEmployeesError stores error', () => {
    useConfigStore.getState().setEmployeesError('fail');
    expect(useConfigStore.getState().employees.error).toBe('fail');
  });
});

// -----------------------------------------------------------------
// Holidays tab actions
// -----------------------------------------------------------------

describe('holidays tab', () => {
  it('setHolidaysLoading updates loading state', () => {
    useConfigStore.getState().setHolidaysLoading(true);
    expect(useConfigStore.getState().holidays.loading).toBe(true);
  });

  it('setHolidaysData stores data and clears error', () => {
    useConfigStore.getState().setHolidaysError('error');
    useConfigStore.getState().setHolidaysData([holiday]);
    expect(useConfigStore.getState().holidays.data).toEqual([holiday]);
    expect(useConfigStore.getState().holidays.error).toBeNull();
  });

  it('setHolidaysDirty marks tab as dirty', () => {
    useConfigStore.getState().setHolidaysDirty(true);
    expect(useConfigStore.getState().holidays.dirty).toBe(true);
  });

  it('setHolidaysError stores error', () => {
    useConfigStore.getState().setHolidaysError('fail');
    expect(useConfigStore.getState().holidays.error).toBe('fail');
  });

  it('setHolidayYear updates year', () => {
    useConfigStore.getState().setHolidayYear(2025);
    expect(useConfigStore.getState().holidayYear).toBe(2025);
  });
});

// -----------------------------------------------------------------
// General tab actions
// -----------------------------------------------------------------

describe('general tab', () => {
  it('setGeneralLoading updates loading state', () => {
    useConfigStore.getState().setGeneralLoading(true);
    expect(useConfigStore.getState().general.loading).toBe(true);
  });

  it('setGeneralData stores data and clears error', () => {
    useConfigStore.getState().setGeneralError('error');
    useConfigStore.getState().setGeneralData(generalConfig);
    expect(useConfigStore.getState().general.data).toEqual(generalConfig);
    expect(useConfigStore.getState().general.error).toBeNull();
  });

  it('setGeneralDirty marks tab as dirty', () => {
    useConfigStore.getState().setGeneralDirty(true);
    expect(useConfigStore.getState().general.dirty).toBe(true);
  });

  it('setGeneralError stores error', () => {
    useConfigStore.getState().setGeneralError('fail');
    expect(useConfigStore.getState().general.error).toBe('fail');
  });
});

// -----------------------------------------------------------------
// Toast
// -----------------------------------------------------------------

describe('toast', () => {
  it('showToast makes toast visible with message', () => {
    useConfigStore.getState().showToast('Cambios guardados');
    expect(useConfigStore.getState().toastVisible).toBe(true);
    expect(useConfigStore.getState().toastMessage).toBe('Cambios guardados');
  });

  it('hideToast hides the toast', () => {
    useConfigStore.getState().showToast('test');
    useConfigStore.getState().hideToast();
    expect(useConfigStore.getState().toastVisible).toBe(false);
  });

  it('showToast with new message replaces previous message', () => {
    useConfigStore.getState().showToast('first');
    useConfigStore.getState().showToast('second');
    expect(useConfigStore.getState().toastMessage).toBe('second');
  });
});

// -----------------------------------------------------------------
// Cross-tab isolation
// -----------------------------------------------------------------

describe('cross-tab isolation', () => {
  it('dirty flag on shifts does not affect holidays', () => {
    useConfigStore.getState().setShiftsDirty(true);
    expect(useConfigStore.getState().holidays.dirty).toBe(false);
  });

  it('error on general does not affect shifts', () => {
    useConfigStore.getState().setGeneralError('err');
    expect(useConfigStore.getState().shifts.error).toBeNull();
  });

  it('loading on employees does not affect general', () => {
    useConfigStore.getState().setEmployeesLoading(true);
    expect(useConfigStore.getState().general.loading).toBe(false);
  });
});
