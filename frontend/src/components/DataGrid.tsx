import { AgGridReact } from 'ag-grid-react';
import type { ColDef, CellValueChangedEvent, CellStyle, CellClassParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { useStore } from '../store';
import type { EmployeeRow, RowValidationResult } from '../types';
import { GRID, ROW_STATUS } from '../constants/colors';

ModuleRegistry.registerModules([AllCommunityModule]);

const m3Theme = themeQuartz.withParams({
  fontFamily:                   'Roboto, system-ui, sans-serif',
  fontSize:                     14,
  rowHeight:                    44,
  headerHeight:                 48,
  backgroundColor:              GRID.background,
  foregroundColor:              GRID.foreground,
  headerBackgroundColor:        GRID.headerBackground,
  headerTextColor:              GRID.headerText,
  borderColor:                  GRID.border,
  rowBorder:                    true,
  columnBorder:                 true,
  headerColumnBorder:           true,
  rowHoverColor:                GRID.rowHover,
  selectedRowBackgroundColor:   GRID.selectedRow,
  cellTextColor:                GRID.foreground,
  wrapperBorderRadius:          '12px',
  wrapperBorder:                false,
});

export default function DataGrid() {
  const rows          = useStore(s => s.rows);
  const validation    = useStore(s => s.validation);
  const updateRow     = useStore(s => s.updateRow);
  const selectedMonth = useStore(s => s.selectedMonth);
  const multiMonth    = useStore(s => s.multiMonth);
  const searchText    = useStore(s => s.searchText);

  const monthFiltered = multiMonth && selectedMonth
    ? rows.filter(r => r.mes === selectedMonth.mes && r.anio === selectedMonth.anio)
    : rows;

  const q = searchText.trim().toLowerCase();
  const displayRows = q
    ? monthFiltered.filter(r =>
        r.codigoEmpleado.toLowerCase().includes(q) ||
        r.nombreEmpleado.toLowerCase().includes(q)
      )
    : monthFiltered;

  const getRowValidation = (codigo: string): RowValidationResult | undefined =>
    validation?.rows.find(r => r.codigoEmpleado === codigo);

  const statusStyle = (params: CellClassParams<EmployeeRow>): CellStyle => {
    const v = getRowValidation(params.data?.codigoEmpleado ?? '');
    if (v?.duplicate) return { backgroundColor: ROW_STATUS.duplicateBg, borderLeft: `3px solid ${ROW_STATUS.duplicateBorder}` };
    if (v && !v.valid)  return { backgroundColor: ROW_STATUS.errorBg,     borderLeft: `3px solid ${ROW_STATUS.errorBorder}` };
    return { backgroundColor: '' };
  };

  const rowStyle = (params: CellClassParams<EmployeeRow>): CellStyle => {
    const v = getRowValidation(params.data?.codigoEmpleado ?? '');
    if (v?.duplicate) return { backgroundColor: ROW_STATUS.duplicateBg };
    if (v && !v.valid)  return { backgroundColor: ROW_STATUS.errorBg };
    return { backgroundColor: '' };
  };

  const editableCellStyle = (fieldName: string) => (params: CellClassParams<EmployeeRow>): CellStyle => {
    const v = getRowValidation(params.data?.codigoEmpleado ?? '');
    if (v?.duplicate) return { backgroundColor: ROW_STATUS.duplicateBg };
    if (v && !v.valid && v.errors.some(e => e.field === fieldName))
      return { backgroundColor: ROW_STATUS.errorBg };
    return { backgroundColor: ROW_STATUS.editableBg, cursor: 'text' };
  };

  const columns: ColDef<EmployeeRow>[] = [
    { field: 'codigoEmpleado',     headerName: 'Código',              width: 90,  editable: false, cellStyle: statusStyle,
      comparator: (a: string, b: string) => parseInt(a, 10) - parseInt(b, 10) },
    { field: 'nombreEmpleado',     headerName: 'Nombre',              flex: 1,    editable: false, cellStyle: rowStyle },
    { field: 'diasNoLaborados',    headerName: '✎ Días no lab.',      width: 150, editable: true,  cellStyle: editableCellStyle('dias_no_laborados'),    headerClass: 'editable-header', headerTooltip: 'Campo editable — haz clic para modificar' },
    { field: 'horasExtrasSimples', headerName: '✎ H. Extra Simples',  width: 160, editable: true,  cellStyle: editableCellStyle('horas_extras_simples'), headerClass: 'editable-header', headerTooltip: 'Campo editable — haz clic para modificar' },
    { field: 'horasExtrasDobles',  headerName: '✎ H. Extra Dobles',   width: 155, editable: true,  cellStyle: editableCellStyle('horas_extras_dobles'),  headerClass: 'editable-header', headerTooltip: 'Campo editable — haz clic para modificar' },
    { field: 'mes',                headerName: 'Mes',                 width: 60,  editable: false },
    { field: 'anio',               headerName: 'Año',                 width: 70,  editable: false },
  ];

  const onCellValueChanged = (e: CellValueChangedEvent<EmployeeRow>) => {
    const index = rows.findIndex(r => r.codigoEmpleado === e.data.codigoEmpleado);
    if (index >= 0 && e.colDef.field) {
      updateRow(index, { [e.colDef.field]: e.newValue });
    }
  };

  return (
    <div className="rounded-shape-md overflow-hidden border border-outline-variant"
         style={{ height: 'calc(100vh - 300px)', minHeight: 300 }}>
      <AgGridReact
        theme={m3Theme}
        rowData={displayRows}
        columnDefs={columns}
        onCellValueChanged={onCellValueChanged}
        suppressMovableColumns
        defaultColDef={{ resizable: true, sortable: true }}
      />
    </div>
  );
}
