import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import type { EmployeeRow, MonthOption, ValidateResponse, SubmitResponse } from './types';

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function makeRow(codigo: string, mes = 12, anio = 2024): EmployeeRow {
  return {
    codigoEmpleado: codigo,
    nombreEmpleado: `Empleado ${codigo}`,
    diasNoLaborados: 0,
    horasExtrasSimples: 0,
    horasExtrasDobles: 0,
    mes,
    anio,
  };
}

const DEC_2024: MonthOption = { mes: 12, anio: 2024 };
const NOV_2024: MonthOption = { mes: 11, anio: 2024 };

// -----------------------------------------------------------------
// Reset store before each test for isolation
// -----------------------------------------------------------------

beforeEach(() => {
  useStore.getState().reset();
});

// -----------------------------------------------------------------
// Initial state
// -----------------------------------------------------------------

describe('initial state', () => {
  it('starts in empty appState', () => {
    expect(useStore.getState().appState).toBe('empty');
  });

  it('starts with no rows', () => {
    expect(useStore.getState().rows).toHaveLength(0);
  });

  it('starts with no validation', () => {
    expect(useStore.getState().validation).toBeNull();
  });

  it('starts with dbReachable null', () => {
    expect(useStore.getState().dbReachable).toBeNull();
  });

  it('starts with empty searchText', () => {
    expect(useStore.getState().searchText).toBe('');
  });
});

// -----------------------------------------------------------------
// setLoaded
// -----------------------------------------------------------------

describe('setLoaded', () => {
  it('transitions to loaded state', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    expect(useStore.getState().appState).toBe('loaded');
  });

  it('stores rows', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2')], [DEC_2024], false, []);
    expect(useStore.getState().rows).toHaveLength(2);
  });

  it('auto-selects month when multiMonth is false', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    expect(useStore.getState().selectedMonth).toEqual(DEC_2024);
  });

  it('does not auto-select month when multiMonth is true', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2', 11, 2024)], [NOV_2024, DEC_2024], true, []);
    expect(useStore.getState().selectedMonth).toBeNull();
  });

  it('clears prior validation on load', () => {
    const state = useStore.getState();
    state.setLoaded([makeRow('1')], [DEC_2024], false, []);
    state.setValidation({ allValid: true, hasDuplicates: false, rows: [] });
    state.setLoaded([makeRow('2')], [DEC_2024], false, []);
    expect(useStore.getState().validation).toBeNull();
  });

  it('resets dbReachable to null on load', () => {
    const state = useStore.getState();
    state.setLoaded([makeRow('1')], [DEC_2024], false, []);
    state.setDbReachable(true);
    state.setLoaded([makeRow('2')], [DEC_2024], false, []);
    expect(useStore.getState().dbReachable).toBeNull();
  });
});

// -----------------------------------------------------------------
// setQuincena / setMonth
// -----------------------------------------------------------------

describe('setQuincena', () => {
  it('stores the quincena value', () => {
    useStore.getState().setQuincena(2);
    expect(useStore.getState().selectedQuincena).toBe(2);
  });
});

describe('setMonth', () => {
  it('stores the selected month', () => {
    useStore.getState().setMonth(NOV_2024);
    expect(useStore.getState().selectedMonth).toEqual(NOV_2024);
  });
});

// -----------------------------------------------------------------
// updateRow
// -----------------------------------------------------------------

describe('updateRow', () => {
  it('updates the row at the given index', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().updateRow(0, { diasNoLaborados: 5 });
    expect(useStore.getState().rows[0].diasNoLaborados).toBe(5);
  });

  it('clears validation when a row is edited', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setValidation({ allValid: true, hasDuplicates: false, rows: [] });
    useStore.getState().updateRow(0, { diasNoLaborados: 3 });
    expect(useStore.getState().validation).toBeNull();
  });

  it('resets dbReachable to null when a row is edited', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setDbReachable(true);
    useStore.getState().updateRow(0, { diasNoLaborados: 3 });
    expect(useStore.getState().dbReachable).toBeNull();
  });

  it('does not mutate other rows', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2')], [DEC_2024], false, []);
    useStore.getState().updateRow(0, { diasNoLaborados: 7 });
    expect(useStore.getState().rows[1].diasNoLaborados).toBe(0);
  });
});

// -----------------------------------------------------------------
// setValidation
// -----------------------------------------------------------------

describe('setValidation', () => {
  it('stores validation result', () => {
    const v: ValidateResponse = { allValid: true, hasDuplicates: false, rows: [] };
    useStore.getState().setValidation(v);
    expect(useStore.getState().validation).toEqual(v);
  });
});

// -----------------------------------------------------------------
// setSubmitting / setResult
// -----------------------------------------------------------------

describe('setSubmitting', () => {
  it('transitions appState to submitting', () => {
    useStore.getState().setSubmitting();
    expect(useStore.getState().appState).toBe('submitting');
  });
});

describe('setResult', () => {
  it('transitions appState to result', () => {
    const r: SubmitResponse = { totalSubmitted: 1, totalSkippedDuplicates: 0, totalFailed: 0, rows: [] };
    useStore.getState().setResult(r);
    expect(useStore.getState().appState).toBe('result');
    expect(useStore.getState().submitResult).toEqual(r);
  });
});

// -----------------------------------------------------------------
// reset
// -----------------------------------------------------------------

describe('reset', () => {
  it('returns to empty state', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setSearchText('test');
    useStore.getState().reset();
    const s = useStore.getState();
    expect(s.appState).toBe('empty');
    expect(s.rows).toHaveLength(0);
    expect(s.validation).toBeNull();
    expect(s.submitResult).toBeNull();
    expect(s.selectedQuincena).toBeNull();
    expect(s.selectedMonth).toBeNull();
    expect(s.dbReachable).toBeNull();
    expect(s.searchText).toBe('');
  });
});

// -----------------------------------------------------------------
// setDbReachable
// -----------------------------------------------------------------

describe('setDbReachable', () => {
  it('sets dbReachable to true', () => {
    useStore.getState().setDbReachable(true);
    expect(useStore.getState().dbReachable).toBe(true);
  });

  it('sets dbReachable to false', () => {
    useStore.getState().setDbReachable(false);
    expect(useStore.getState().dbReachable).toBe(false);
  });
});

// -----------------------------------------------------------------
// getRowsForSubmit
// -----------------------------------------------------------------

describe('getRowsForSubmit', () => {
  it('injects quincena into every row', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2')], [DEC_2024], false, []);
    useStore.getState().setQuincena(2);
    const rows = useStore.getState().getRowsForSubmit();
    expect(rows[0].numeroDequincena).toBe(2);
    expect(rows[1].numeroDequincena).toBe(2);
  });

  it('overrides mes/anio from selectedMonth in single-month mode', () => {
    useStore.getState().setLoaded([makeRow('1', 12, 2024)], [DEC_2024], false, []);
    useStore.getState().setQuincena(1);
    const rows = useStore.getState().getRowsForSubmit();
    expect(rows[0].mes).toBe(12);
    expect(rows[0].anio).toBe(2024);
  });

  it('filters to selectedMonth rows when multiMonth is true', () => {
    const novRow = makeRow('1', 11, 2024);
    const decRow = makeRow('2', 12, 2024);
    useStore.getState().setLoaded([novRow, decRow], [NOV_2024, DEC_2024], true, []);
    useStore.getState().setMonth(DEC_2024);
    useStore.getState().setQuincena(1);
    const rows = useStore.getState().getRowsForSubmit();
    expect(rows).toHaveLength(1);
    expect(rows[0].codigoEmpleado).toBe('2');
  });

  it('returns all rows when multiMonth is false', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2')], [DEC_2024], false, []);
    useStore.getState().setQuincena(1);
    const rows = useStore.getState().getRowsForSubmit();
    expect(rows).toHaveLength(2);
  });

  it('sets numeroDequincena to undefined when quincena is not yet selected', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    // selectedQuincena is null → ?? undefined gives undefined
    const rows = useStore.getState().getRowsForSubmit();
    expect(rows[0].numeroDequincena).toBeUndefined();
  });

  it('falls back to row mes/anio when no selectedMonth', () => {
    useStore.getState().setLoaded(
      [makeRow('1', 11, 2024), makeRow('2', 12, 2024)],
      [NOV_2024, DEC_2024],
      true,
      []
    );
    // selectedMonth is null → uses row.mes and row.anio
    const rows = useStore.getState().getRowsForSubmit();
    expect(rows[0].mes).toBe(11);
    expect(rows[1].mes).toBe(12);
  });

  it('returns all rows when multiMonth is true but no month is selected yet', () => {
    useStore.getState().setLoaded(
      [makeRow('1', 11, 2024), makeRow('2', 12, 2024)],
      [NOV_2024, DEC_2024],
      true,
      []
    );
    useStore.getState().setQuincena(1);
    // selectedMonth is null → multiMonth && selectedMonth = false → return all
    const rows = useStore.getState().getRowsForSubmit();
    expect(rows).toHaveLength(2);
  });
});

// -----------------------------------------------------------------
// setLoaded edge cases
// -----------------------------------------------------------------

// -----------------------------------------------------------------
// setSearchText
// -----------------------------------------------------------------

describe('setSearchText', () => {
  it('stores the search text', () => {
    useStore.getState().setSearchText('garcia');
    expect(useStore.getState().searchText).toBe('garcia');
  });

  it('is cleared by setLoaded', () => {
    useStore.getState().setSearchText('garcia');
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    expect(useStore.getState().searchText).toBe('');
  });
});

// -----------------------------------------------------------------
// setLoaded edge cases
// -----------------------------------------------------------------

describe('setLoaded edge cases', () => {
  it('selectedMonth is null when monthOptions is empty and multiMonth is false', () => {
    useStore.getState().setLoaded([makeRow('1')], [], false, []);
    // monthOptions[0] is undefined → ?? null gives null
    expect(useStore.getState().selectedMonth).toBeNull();
  });
});
