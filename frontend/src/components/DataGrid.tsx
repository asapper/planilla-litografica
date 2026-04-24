import { AgGridReact } from 'ag-grid-react';
import type { ColDef, CellValueChangedEvent, CellStyle, CellClassParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { useStore } from '../store';
import type { EmployeeRow, RowValidationResult } from '../types';

ModuleRegistry.registerModules([AllCommunityModule]);

// Hardcoded M3 hex values — CSS variables cannot be used here because this
// runs at module load time, before the CSS variables are applied to the DOM.
const m3Theme = themeQuartz.withParams({
  fontFamily:                   'Roboto, system-ui, sans-serif',
  fontSize:                     14,
  rowHeight:                    44,
  headerHeight:                 48,
  backgroundColor:              '#FFFFFF',
  foregroundColor:              '#191C20',
  headerBackgroundColor:        '#E8EEFB',
  headerTextColor:              '#2D3748',
  borderColor:                  '#C3C7CF',
  rowBorder:                    true,
  columnBorder:                 true,
  headerColumnBorder:           true,
  rowHoverColor:                '#EEF2FB',
  selectedRowBackgroundColor:   '#D9E3F8',
  cellTextColor:                '#191C20',
  wrapperBorderRadius:          '12px',
  wrapperBorder:                false,
});

export default function DataGrid() {
  const rows          = useStore(s => s.rows);
  const validation    = useStore(s => s.validation);
  const updateRow     = useStore(s => s.updateRow);
  const selectedMonth = useStore(s => s.selectedMonth);
  const multiMonth    = useStore(s => s.multiMonth);

  // When multiple months are present, show only rows for the selected month
  const displayRows = multiMonth && selectedMonth
    ? rows.filter(r => r.mes === selectedMonth.mes && r.anio === selectedMonth.anio)
    : rows;

  const getRowValidation = (codigo: string): RowValidationResult | undefined =>
    validation?.rows.find(r => r.codigoEmpleado === codigo);

  const statusStyle = (params: CellClassParams<EmployeeRow>): CellStyle => {
    const v = getRowValidation(params.data?.codigoEmpleado ?? '');
    if (v?.duplicate) return { backgroundColor: '#FFDEA8', borderLeft: '3px solid #7C5800' };
    if (v && !v.valid)  return { backgroundColor: '#FFDAD6', borderLeft: '3px solid #BA1A1A' };
    return { backgroundColor: '' };
  };

  const rowStyle = (params: CellClassParams<EmployeeRow>): CellStyle => {
    const v = getRowValidation(params.data?.codigoEmpleado ?? '');
    if (v?.duplicate) return { backgroundColor: '#FFDEA8' };
    if (v && !v.valid)  return { backgroundColor: '#FFDAD6' };
    return { backgroundColor: '' };
  };

  const editableCellStyle = (fieldName: string) => (params: CellClassParams<EmployeeRow>): CellStyle => {
    const v = getRowValidation(params.data?.codigoEmpleado ?? '');
    if (v?.duplicate) return { backgroundColor: '#FFDEA8' };
    if (v && !v.valid && v.errors.some(e => e.field === fieldName))
      return { backgroundColor: '#FFDAD6' };
    return { backgroundColor: '#FAFCFF', cursor: 'text' };
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
