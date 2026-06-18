import { describe, it, expect, beforeEach } from 'vitest';
import { useTasStore } from './tasStore';
import type { TasSession, InactiveEmployee, AbsentEmployee, TasPeriod } from './tasTypes';

function makeSession(id: number): TasSession {
  return {
    sessionId: id,
    employeeId: `E${id}`,
    employeeName: `Empleado ${id}`,
    date: '2026-03-01',
    scans: [],
    matchedShiftId: null,
    matchedShiftName: null,
    assignedShiftId: null,
    assignedShiftName: null,
    effectiveStart: null,
    lastScan: null,
    workedMinutes: 0,
    workedHours: 0,
    needsResolution: true,
    flags: ['MISSING_ENTRY'],
  };
}

beforeEach(() => {
  useTasStore.getState().resetTas();
});

// -----------------------------------------------------------------
// Initial state
// -----------------------------------------------------------------

describe('initial state', () => {
  it('starts in idle view', () => {
    expect(useTasStore.getState().tasView).toBe('idle');
  });

  it('starts with null uploadToken', () => {
    expect(useTasStore.getState().uploadToken).toBeNull();
  });

  it('starts with empty processingMessage', () => {
    expect(useTasStore.getState().processingMessage).toBe('');
  });

  it('starts with empty flaggedSessions', () => {
    expect(useTasStore.getState().flaggedSessions).toHaveLength(0);
  });

  it('starts with empty resolvedSessions', () => {
    expect(useTasStore.getState().resolvedSessions).toEqual({});
  });

  it('starts with empty inactiveEmployees', () => {
    expect(useTasStore.getState().inactiveEmployees).toHaveLength(0);
  });

  it('starts with empty inactiveDecisions', () => {
    expect(useTasStore.getState().inactiveDecisions).toEqual({});
  });

  it('starts with empty absentEmployees', () => {
    expect(useTasStore.getState().absentEmployees).toHaveLength(0);
  });

  it('starts with usedFallbackHolidays false', () => {
    expect(useTasStore.getState().usedFallbackHolidays).toBe(false);
  });

  it('starts with fallbackBannerDismissed false', () => {
    expect(useTasStore.getState().fallbackBannerDismissed).toBe(false);
  });

  it('starts with null jobId', () => {
    expect(useTasStore.getState().jobId).toBeNull();
  });

  it('starts with null error', () => {
    expect(useTasStore.getState().error).toBeNull();
  });
});

// -----------------------------------------------------------------
// setTasView
// -----------------------------------------------------------------

describe('setTasView', () => {
  it('updates tasView to processing', () => {
    useTasStore.getState().setTasView('processing');
    expect(useTasStore.getState().tasView).toBe('processing');
  });

  it('updates tasView to verification', () => {
    useTasStore.getState().setTasView('verification');
    expect(useTasStore.getState().tasView).toBe('verification');
  });

  it('updates tasView to result', () => {
    useTasStore.getState().setTasView('result');
    expect(useTasStore.getState().tasView).toBe('result');
  });
});

// -----------------------------------------------------------------
// setUploadToken
// -----------------------------------------------------------------

describe('setUploadToken', () => {
  it('stores the token', () => {
    useTasStore.getState().setUploadToken('tok-abc');
    expect(useTasStore.getState().uploadToken).toBe('tok-abc');
  });

  it('can set to null', () => {
    useTasStore.getState().setUploadToken('tok-abc');
    useTasStore.getState().setUploadToken(null);
    expect(useTasStore.getState().uploadToken).toBeNull();
  });
});

// -----------------------------------------------------------------
// setProcessingMessage
// -----------------------------------------------------------------

describe('setProcessingMessage', () => {
  it('stores the message', () => {
    useTasStore.getState().setProcessingMessage('Analizando...');
    expect(useTasStore.getState().processingMessage).toBe('Analizando...');
  });
});

// -----------------------------------------------------------------
// setFlaggedSessions
// -----------------------------------------------------------------

describe('setFlaggedSessions', () => {
  it('stores the sessions', () => {
    const sessions = [makeSession(1), makeSession(2)];
    useTasStore.getState().setFlaggedSessions(sessions);
    expect(useTasStore.getState().flaggedSessions).toHaveLength(2);
    expect(useTasStore.getState().flaggedSessions[0].sessionId).toBe(1);
  });
});

// -----------------------------------------------------------------
// setResolvedSession
// -----------------------------------------------------------------

describe('setResolvedSession', () => {
  it('stores a resolved session', () => {
    useTasStore.getState().setResolvedSession(5, { resolvedStart: '08:00', resolvedEnd: '17:00' });
    expect(useTasStore.getState().resolvedSessions[5]).toEqual({
      resolvedStart: '08:00',
      resolvedEnd: '17:00',
    });
  });

  it('can store multiple sessions', () => {
    useTasStore.getState().setResolvedSession(1, { resolvedStart: '07:00', resolvedEnd: '16:00' });
    useTasStore.getState().setResolvedSession(2, { resolvedStart: '08:00', resolvedEnd: '17:00' });
    expect(Object.keys(useTasStore.getState().resolvedSessions)).toHaveLength(2);
  });

  it('overwrites an existing entry', () => {
    useTasStore.getState().setResolvedSession(1, { resolvedStart: '07:00', resolvedEnd: '16:00' });
    useTasStore.getState().setResolvedSession(1, { resolvedStart: '09:00', resolvedEnd: '18:00' });
    expect(useTasStore.getState().resolvedSessions[1].resolvedStart).toBe('09:00');
  });

});

// -----------------------------------------------------------------
// setShiftAcceptance / setSameDayDoubleResolution
// -----------------------------------------------------------------

describe('setShiftAcceptance', () => {
  it('stores the chosen shift id by session id', () => {
    useTasStore.getState().setShiftAcceptance(7, 'tarde');
    expect(useTasStore.getState().shiftAcceptances[7]).toBe('tarde');
  });
});

describe('setSameDayDoubleResolution', () => {
  it('stores the keep choice by group key', () => {
    useTasStore.getState().setSameDayDoubleResolution('100|2026-03-10', 'all');
    expect(useTasStore.getState().sameDayDoubleResolutions['100|2026-03-10']).toBe('all');
  });
});

// -----------------------------------------------------------------
// clearResolvedSessions
// -----------------------------------------------------------------

describe('clearResolvedSessions', () => {
  it('empties the resolvedSessions map', () => {
    useTasStore.getState().setResolvedSession(1, { resolvedStart: '08:00', resolvedEnd: '17:00' });
    useTasStore.getState().setResolvedSession(2, { resolvedStart: '09:00', resolvedEnd: '18:00' });
    useTasStore.getState().clearResolvedSessions();
    expect(useTasStore.getState().resolvedSessions).toEqual({});
  });

  it('is idempotent when already empty', () => {
    useTasStore.getState().clearResolvedSessions();
    expect(useTasStore.getState().resolvedSessions).toEqual({});
  });

  it('clears shiftAcceptances and sameDayDoubleResolutions too', () => {
    useTasStore.getState().setShiftAcceptance(7, 'tarde');
    useTasStore.getState().setSameDayDoubleResolution('100|2026-03-10', 'all');
    useTasStore.getState().clearResolvedSessions();
    expect(useTasStore.getState().shiftAcceptances).toEqual({});
    expect(useTasStore.getState().sameDayDoubleResolutions).toEqual({});
  });
});

// -----------------------------------------------------------------
// setInactiveEmployees
// -----------------------------------------------------------------

describe('setInactiveEmployees', () => {
  it('stores the employees', () => {
    const emps: InactiveEmployee[] = [{ employeeId: 'E1', name: 'Ana', sessionCount: 3 }];
    useTasStore.getState().setInactiveEmployees(emps);
    expect(useTasStore.getState().inactiveEmployees).toHaveLength(1);
  });
});

// -----------------------------------------------------------------
// setInactiveDecision
// -----------------------------------------------------------------

describe('setInactiveDecision', () => {
  it('stores a reactivate decision', () => {
    useTasStore.getState().setInactiveDecision('E1', 'reactivate');
    expect(useTasStore.getState().inactiveDecisions['E1']).toBe('reactivate');
  });

  it('stores an ignore decision', () => {
    useTasStore.getState().setInactiveDecision('E2', 'ignore');
    expect(useTasStore.getState().inactiveDecisions['E2']).toBe('ignore');
  });

  it('can change a decision', () => {
    useTasStore.getState().setInactiveDecision('E1', 'reactivate');
    useTasStore.getState().setInactiveDecision('E1', 'ignore');
    expect(useTasStore.getState().inactiveDecisions['E1']).toBe('ignore');
  });
});

// -----------------------------------------------------------------
// setAbsentEmployees
// -----------------------------------------------------------------

describe('setAbsentEmployees', () => {
  it('stores the employees', () => {
    const emps: AbsentEmployee[] = [{ employeeId: 'E1', name: 'Luis' }];
    useTasStore.getState().setAbsentEmployees(emps);
    expect(useTasStore.getState().absentEmployees).toHaveLength(1);
  });
});

// -----------------------------------------------------------------
// setUsedFallbackHolidays
// -----------------------------------------------------------------

describe('setUsedFallbackHolidays', () => {
  it('sets to true', () => {
    useTasStore.getState().setUsedFallbackHolidays(true);
    expect(useTasStore.getState().usedFallbackHolidays).toBe(true);
  });

  it('sets to false', () => {
    useTasStore.getState().setUsedFallbackHolidays(true);
    useTasStore.getState().setUsedFallbackHolidays(false);
    expect(useTasStore.getState().usedFallbackHolidays).toBe(false);
  });
});

// -----------------------------------------------------------------
// dismissFallbackBanner
// -----------------------------------------------------------------

describe('dismissFallbackBanner', () => {
  it('sets fallbackBannerDismissed to true', () => {
    useTasStore.getState().dismissFallbackBanner();
    expect(useTasStore.getState().fallbackBannerDismissed).toBe(true);
  });
});

// -----------------------------------------------------------------
// setJobId
// -----------------------------------------------------------------

describe('setJobId', () => {
  it('stores the jobId', () => {
    useTasStore.getState().setJobId('job-xyz');
    expect(useTasStore.getState().jobId).toBe('job-xyz');
  });

  it('can set to null', () => {
    useTasStore.getState().setJobId('job-xyz');
    useTasStore.getState().setJobId(null);
    expect(useTasStore.getState().jobId).toBeNull();
  });
});

// -----------------------------------------------------------------
// setError
// -----------------------------------------------------------------

describe('setError', () => {
  it('stores an error message', () => {
    useTasStore.getState().setError('Algo salió mal');
    expect(useTasStore.getState().error).toBe('Algo salió mal');
  });

  it('can clear the error', () => {
    useTasStore.getState().setError('error');
    useTasStore.getState().setError(null);
    expect(useTasStore.getState().error).toBeNull();
  });
});

// -----------------------------------------------------------------
// setResolvedRows
// -----------------------------------------------------------------

describe('setResolvedRows', () => {
  it('starts with an empty array', () => {
    expect(useTasStore.getState().resolvedRows).toEqual([]);
  });

  it('stores the rows', () => {
    const rows = [
      { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
    ];
    useTasStore.getState().setResolvedRows(rows);
    expect(useTasStore.getState().resolvedRows).toEqual(rows);
  });
});

// -----------------------------------------------------------------
// availablePeriods / selectedPeriod
// -----------------------------------------------------------------

describe('initial state', () => {
  it('starts with empty availablePeriods', () => {
    expect(useTasStore.getState().availablePeriods).toEqual([]);
  });

  it('starts with null selectedPeriod', () => {
    expect(useTasStore.getState().selectedPeriod).toBeNull();
  });
});

describe('setAvailablePeriods', () => {
  const p1: TasPeriod = { anio: 2026, mes: 4, numeroDequincena: 1 };
  const p2: TasPeriod = { anio: 2026, mes: 4, numeroDequincena: 2 };

  it('stores the periods', () => {
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    expect(useTasStore.getState().availablePeriods).toEqual([p1, p2]);
  });

  it('auto-selects the first period when selectedPeriod is null', () => {
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    expect(useTasStore.getState().selectedPeriod).toEqual(p1);
  });

  it('preserves the current selection if still present in the new list', () => {
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    useTasStore.getState().setSelectedPeriod(p2);
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    expect(useTasStore.getState().selectedPeriod).toEqual(p2);
  });

  it('falls back to the first period if the current selection is no longer present', () => {
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    useTasStore.getState().setSelectedPeriod(p2);
    useTasStore.getState().setAvailablePeriods([p1]);
    expect(useTasStore.getState().selectedPeriod).toEqual(p1);
  });

  it('sets selectedPeriod to null when periods is empty', () => {
    useTasStore.getState().setAvailablePeriods([p1, p2]);
    useTasStore.getState().setAvailablePeriods([]);
    expect(useTasStore.getState().selectedPeriod).toBeNull();
  });
});

describe('setSelectedPeriod', () => {
  it('sets the selected period directly', () => {
    const p: TasPeriod = { anio: 2026, mes: 5, numeroDequincena: 1 };
    useTasStore.getState().setSelectedPeriod(p);
    expect(useTasStore.getState().selectedPeriod).toEqual(p);
  });

  it('can be set to null', () => {
    const p: TasPeriod = { anio: 2026, mes: 5, numeroDequincena: 1 };
    useTasStore.getState().setSelectedPeriod(p);
    useTasStore.getState().setSelectedPeriod(null);
    expect(useTasStore.getState().selectedPeriod).toBeNull();
  });
});

// -----------------------------------------------------------------
// resetTas
// -----------------------------------------------------------------

// -----------------------------------------------------------------
// overtimeOverrides
// -----------------------------------------------------------------

describe('overtimeOverrides', () => {
  it('starts empty', () => {
    expect(useTasStore.getState().overtimeOverrides).toEqual({});
  });

  it('setOvertimeOverride upserts a single field', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 5 },
    });
  });

  it('setOvertimeOverride preserves other fields for same employee', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasDobles', 3);
    expect(useTasStore.getState().overtimeOverrides).toEqual({
      E1: { horasExtrasSimples: 5, horasExtrasDobles: 3 },
    });
  });

  it('setOvertimeOverride keeps other employees untouched', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    useTasStore.getState().setOvertimeOverride('E2', 'horasExtrasDobles', 2);
    expect(useTasStore.getState().overtimeOverrides.E1).toEqual({ horasExtrasSimples: 5 });
    expect(useTasStore.getState().overtimeOverrides.E2).toEqual({ horasExtrasDobles: 2 });
  });

  it('clearOvertimeOverrides resets to empty', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    useTasStore.getState().clearOvertimeOverrides();
    expect(useTasStore.getState().overtimeOverrides).toEqual({});
  });

  it('resetTas clears overtimeOverrides', () => {
    useTasStore.getState().setOvertimeOverride('E1', 'horasExtrasSimples', 5);
    useTasStore.getState().resetTas();
    expect(useTasStore.getState().overtimeOverrides).toEqual({});
  });
});

// -----------------------------------------------------------------
// resetTas
// -----------------------------------------------------------------

describe('resetTas', () => {
  it('resets all state to initial values', () => {
    useTasStore.getState().setTasView('verification');
    useTasStore.getState().setUploadToken('tok-abc');
    useTasStore.getState().setFlaggedSessions([makeSession(1)]);
    useTasStore.getState().setInactiveEmployees([{ employeeId: 'E1', name: 'Ana', sessionCount: 2 }]);
    useTasStore.getState().setInactiveDecision('E1', 'reactivate');
    useTasStore.getState().setAbsentEmployees([{ employeeId: 'E2', name: 'Luis' }]);
    useTasStore.getState().setUsedFallbackHolidays(true);
    useTasStore.getState().dismissFallbackBanner();
    useTasStore.getState().setJobId('job-123');
    useTasStore.getState().setError('err');
    useTasStore.getState().setResolvedSession(1, { resolvedStart: '08:00', resolvedEnd: '17:00' });
    useTasStore.getState().setResolvedRows([
      { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
    ]);
    useTasStore.getState().setAvailablePeriods([{ anio: 2026, mes: 4, numeroDequincena: 1 }]);

    useTasStore.getState().resetTas();

    const s = useTasStore.getState();
    expect(s.tasView).toBe('idle');
    expect(s.uploadToken).toBeNull();
    expect(s.processingMessage).toBe('');
    expect(s.flaggedSessions).toHaveLength(0);
    expect(s.resolvedSessions).toEqual({});
    expect(s.inactiveEmployees).toHaveLength(0);
    expect(s.inactiveDecisions).toEqual({});
    expect(s.absentEmployees).toHaveLength(0);
    expect(s.usedFallbackHolidays).toBe(false);
    expect(s.fallbackBannerDismissed).toBe(false);
    expect(s.jobId).toBeNull();
    expect(s.error).toBeNull();
    expect(s.resolvedRows).toEqual([]);
    expect(s.availablePeriods).toEqual([]);
    expect(s.selectedPeriod).toBeNull();
  });
});
