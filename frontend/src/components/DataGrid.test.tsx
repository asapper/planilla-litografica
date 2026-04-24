import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AgGridReact } from 'ag-grid-react';
import { useStore } from '../store';
import type { EmployeeRow } from '../types';

// Mock AG Grid — it doesn't work in jsdom; we replace it with a testable stub
vi.mock('ag-grid-react', () => ({
  AgGridReact: vi.fn(({ rowData, columnDefs, onCellValueChanged }: any) => (
    <div data-testid="ag-grid">
      <span data-testid="row-count">{rowData?.length ?? 0}</span>
      {columnDefs?.map((col: any) => (
        <div key={col.field} data-testid={`col-${col.field}`}>
          {col.headerName}
        </div>
      ))}
      <button
        data-testid="trigger-cell-change"
        onClick={() => onCellValueChanged?.({
          data: rowData?.[0],
          colDef: { field: 'diasNoLaborados' },
          newValue: '5',
        })}
      >
        change
      </button>
    </div>
  )),
}));

vi.mock('ag-grid-community', () => ({
  AllCommunityModule: {},
  ModuleRegistry: { registerModules: vi.fn() },
  themeQuartz: { withParams: vi.fn(() => ({})) },
}));

import DataGrid from './DataGrid';

const DEC_2024 = { mes: 12, anio: 2024 };

function makeRow(codigo: string, mes = 12, anio = 2024): EmployeeRow {
  return {
    codigoEmpleado: codigo, nombreEmpleado: `Emp ${codigo}`,
    diasNoLaborados: 1, horasExtrasSimples: 0, horasExtrasDobles: 0,
    mes, anio,
  };
}

beforeEach(() => {
  useStore.getState().reset();
  // Restore default implementation after style-function tests
  vi.mocked(AgGridReact).mockRestore?.();
  vi.mocked(AgGridReact).mockImplementation((({ rowData, columnDefs, onCellValueChanged }: any) => (
    <div data-testid="ag-grid">
      <span data-testid="row-count">{rowData?.length ?? 0}</span>
      {columnDefs?.map((col: any) => (
        <div key={col.field} data-testid={`col-${col.field}`}>{col.headerName}</div>
      ))}
      <button
        data-testid="trigger-cell-change"
        onClick={() => onCellValueChanged?.({
          data: rowData?.[0],
          colDef: { field: 'diasNoLaborados' },
          newValue: '5',
        })}
      >
        change
      </button>
    </div>
  )) as any);
});

// -----------------------------------------------------------------
// General rendering
// -----------------------------------------------------------------

describe('DataGrid', () => {
  it('renders without crashing', () => {
    render(<DataGrid />);
    expect(screen.getByTestId('ag-grid')).toBeInTheDocument();
  });

  it('passes all rows to AG Grid in single-month mode', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2')], [DEC_2024], false, []);
    render(<DataGrid />);
    expect(screen.getByTestId('row-count').textContent).toBe('2');
  });

  it('filters rows by selectedMonth in multi-month mode', () => {
    useStore.getState().setLoaded(
      [makeRow('1', 11, 2024), makeRow('2', 12, 2024)],
      [{ mes: 11, anio: 2024 }, DEC_2024],
      true,
      []
    );
    useStore.getState().setMonth(DEC_2024);
    render(<DataGrid />);
    expect(screen.getByTestId('row-count').textContent).toBe('1');
  });

  it('shows all rows in multi-month mode when no month is selected', () => {
    useStore.getState().setLoaded(
      [makeRow('1', 11, 2024), makeRow('2', 12, 2024)],
      [{ mes: 11, anio: 2024 }, DEC_2024],
      true,
      []
    );
    render(<DataGrid />);
    expect(screen.getByTestId('row-count').textContent).toBe('2');
  });

  it('renders all expected column headers', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<DataGrid />);
    expect(screen.getByTestId('col-codigoEmpleado')).toBeInTheDocument();
    expect(screen.getByTestId('col-nombreEmpleado')).toBeInTheDocument();
    expect(screen.getByTestId('col-diasNoLaborados')).toBeInTheDocument();
    expect(screen.getByTestId('col-horasExtrasSimples')).toBeInTheDocument();
    expect(screen.getByTestId('col-horasExtrasDobles')).toBeInTheDocument();
    expect(screen.getByTestId('col-mes')).toBeInTheDocument();
    expect(screen.getByTestId('col-anio')).toBeInTheDocument();
  });

  it('updates store row when cell value changes', async () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<DataGrid />);
    await act(async () => {
      screen.getByTestId('trigger-cell-change').click();
    });
    expect(useStore.getState().rows[0].diasNoLaborados).toBe('5' as any);
  });

  it('filters rows by searchText matching codigoEmpleado', () => {
    useStore.getState().setLoaded([makeRow('101'), makeRow('202')], [DEC_2024], false, []);
    useStore.getState().setSearchText('101');
    render(<DataGrid />);
    expect(screen.getByTestId('row-count').textContent).toBe('1');
  });

  it('filters rows by searchText matching nombreEmpleado (case-insensitive)', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2')], [DEC_2024], false, []);
    useStore.getState().setSearchText('emp 1');
    render(<DataGrid />);
    expect(screen.getByTestId('row-count').textContent).toBe('1');
  });

  it('shows all rows when searchText is empty', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2'), makeRow('3')], [DEC_2024], false, []);
    render(<DataGrid />);
    expect(screen.getByTestId('row-count').textContent).toBe('3');
  });

  it('shows no rows when searchText matches nothing', () => {
    useStore.getState().setLoaded([makeRow('1'), makeRow('2')], [DEC_2024], false, []);
    useStore.getState().setSearchText('zzz');
    render(<DataGrid />);
    expect(screen.getByTestId('row-count').textContent).toBe('0');
  });

  it('renders without error when validation is present', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    useStore.getState().setValidation({
      allValid: false, hasDuplicates: false,
      rows: [{ codigoEmpleado: '1', valid: false, duplicate: false,
               errors: [{ field: 'diasNoLaborados', message: 'bad' }] }],
    });
    render(<DataGrid />);
    expect(screen.getByTestId('ag-grid')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// Cell style functions — capture columnDefs via mock override
// -----------------------------------------------------------------

describe('DataGrid cell style functions', () => {
  let capturedColumnDefs: any[] = [];

  beforeEach(() => {
    capturedColumnDefs = [];
    vi.mocked(AgGridReact).mockImplementation(({ columnDefs }: any) => {
      capturedColumnDefs = columnDefs ?? [];
      return null as any;
    });
  });

  function getColStyle(field: string, params: any): any {
    const col = capturedColumnDefs.find((c: any) => c.field === field);
    return col?.cellStyle?.(params);
  }

  function params(codigo: string): any {
    return { data: { codigoEmpleado: codigo } };
  }

  function setDupValidation() {
    useStore.getState().setValidation({
      allValid: false, hasDuplicates: true,
      rows: [{ codigoEmpleado: '1', valid: true, duplicate: true, errors: [] }],
    });
  }

  function setErrorValidation(field = 'dias_no_laborados') {
    useStore.getState().setValidation({
      allValid: false, hasDuplicates: false,
      rows: [{ codigoEmpleado: '1', valid: false, duplicate: false,
               errors: [{ field, message: 'bad' }] }],
    });
  }

  // statusStyle (codigoEmpleado column)
  it('statusStyle: duplicate → orange background with left border', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    setDupValidation();
    render(<DataGrid />);
    const style = getColStyle('codigoEmpleado', params('1'));
    expect(style?.backgroundColor).toBe('#FFDEA8');
    expect(style?.borderLeft).toBeDefined();
  });

  it('statusStyle: invalid → red background with left border', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    setErrorValidation();
    render(<DataGrid />);
    const style = getColStyle('codigoEmpleado', params('1'));
    expect(style?.backgroundColor).toBe('#FFDAD6');
  });

  it('statusStyle: valid → empty background', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<DataGrid />);
    const style = getColStyle('codigoEmpleado', params('1'));
    expect(style?.backgroundColor).toBe('');
  });

  // rowStyle (nombreEmpleado column)
  it('rowStyle: duplicate → orange background', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    setDupValidation();
    render(<DataGrid />);
    expect(getColStyle('nombreEmpleado', params('1'))?.backgroundColor).toBe('#FFDEA8');
  });

  it('rowStyle: invalid → red background', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    setErrorValidation();
    render(<DataGrid />);
    expect(getColStyle('nombreEmpleado', params('1'))?.backgroundColor).toBe('#FFDAD6');
  });

  it('rowStyle: valid → empty background', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<DataGrid />);
    expect(getColStyle('nombreEmpleado', params('1'))?.backgroundColor).toBe('');
  });

  // editableCellStyle (diasNoLaborados column)
  it('editableCellStyle: duplicate → orange background', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    setDupValidation();
    render(<DataGrid />);
    expect(getColStyle('diasNoLaborados', params('1'))?.backgroundColor).toBe('#FFDEA8');
  });

  it('editableCellStyle: invalid with matching field → red background', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    setErrorValidation('dias_no_laborados');
    render(<DataGrid />);
    expect(getColStyle('diasNoLaborados', params('1'))?.backgroundColor).toBe('#FFDAD6');
  });

  it('editableCellStyle: invalid but field does not match → editable default', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    setErrorValidation('mes'); // error on different field
    render(<DataGrid />);
    expect(getColStyle('diasNoLaborados', params('1'))?.backgroundColor).toBe('#FAFCFF');
  });

  it('editableCellStyle: valid → editable default with cursor text', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<DataGrid />);
    const style = getColStyle('diasNoLaborados', params('1'));
    expect(style?.backgroundColor).toBe('#FAFCFF');
    expect(style?.cursor).toBe('text');
  });

  it('editableCellStyle: undefined data does not crash', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<DataGrid />);
    expect(() => getColStyle('diasNoLaborados', { data: undefined })).not.toThrow();
  });

  it('statusStyle: undefined data falls back to empty background', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<DataGrid />);
    const style = getColStyle('codigoEmpleado', { data: undefined });
    expect(style?.backgroundColor).toBe('');
  });

  it('rowStyle: undefined data falls back to empty background', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<DataGrid />);
    const style = getColStyle('nombreEmpleado', { data: undefined });
    expect(style?.backgroundColor).toBe('');
  });

  // comparator function on codigoEmpleado column
  it('codigoEmpleado comparator sorts numerically not lexicographically', () => {
    useStore.getState().setLoaded([makeRow('1')], [DEC_2024], false, []);
    render(<DataGrid />);
    const col = capturedColumnDefs.find((c: any) => c.field === 'codigoEmpleado');
    expect(col?.comparator('3', '16')).toBeLessThan(0);  // 3 < 16 numerically
    expect(col?.comparator('16', '3')).toBeGreaterThan(0);
    expect(col?.comparator('10', '10')).toBe(0);
  });
});
