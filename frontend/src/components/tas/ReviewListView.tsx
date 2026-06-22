import { useState } from 'react';
import { useTasStore } from '../../tasStore';
import { updateAccruesOvertime } from '../../configApi';
import { recomputeTas } from '../../tasApi';
import { matchesSearch } from '../../textSearch';
import { useToastStore } from '../../toastStore';
import AlertMessage from '../ui/AlertMessage';
import type { ResolvedRow } from '../../tasTypes';

type FilterType = 'all' | 'estimated' | 'duplicate' | 'adjusted';

interface ReviewListViewProps {
  dbHealthy: boolean | null;
  onSubmit: () => void;
}

function sortRows(rows: ResolvedRow[], column: 'name' | 'code', direction: 'asc' | 'desc'): ResolvedRow[] {
  const sorted = [...rows].sort((a, b) => {
    const aVal = column === 'name' ? a.nombreEmpleado : a.codigoEmpleado;
    const bVal = column === 'name' ? b.nombreEmpleado : b.codigoEmpleado;
    return aVal.localeCompare(bVal, 'es');
  });
  return direction === 'desc' ? sorted.reverse() : sorted;
}

export default function ReviewListView({ dbHealthy, onSubmit }: ReviewListViewProps) {
  const resolvedRows = useTasStore(s => s.resolvedRows);
  const overtimeOverrides = useTasStore(s => s.overtimeOverrides);
  const duplicateCodes = useTasStore(s => s.duplicateCodes);
  const duplicatesLoading = useTasStore(s => s.duplicatesLoading);
  const sortColumn = useTasStore(s => s.reviewSortColumn);
  const sortDirection = useTasStore(s => s.reviewSortDirection);
  const activeFilter = useTasStore(s => s.reviewActiveFilter);
  const setReviewSelectedEmployee = useTasStore(s => s.setReviewSelectedEmployee);
  const setReviewSort = useTasStore(s => s.setReviewSort);
  const setReviewActiveFilter = useTasStore(s => s.setReviewActiveFilter);
  const setOvertimeOverride = useTasStore(s => s.setOvertimeOverride);
  const stashOvertimeOverrides = useTasStore(s => s.stashOvertimeOverrides);
  const restoreOvertimeOverrides = useTasStore(s => s.restoreOvertimeOverrides);
  const setResolvedRows = useTasStore(s => s.setResolvedRows);
  const setSessionSummaries = useTasStore(s => s.setSessionSummaries);
  const uploadToken = useTasStore(s => s.uploadToken);

  const [search, setSearch] = useState('');
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);

  const duplicateSet = new Set(duplicateCodes);
  const allDuplicate = resolvedRows.length > 0 && resolvedRows.every(r => duplicateSet.has(r.codigoEmpleado));

  const estimatedCount = resolvedRows.filter(r => r.diasTurnoEstimado > 0).length;
  const duplicateCount = duplicateCodes.length;
  const adjustedCount = Object.keys(overtimeOverrides).length;

  const chips: { key: FilterType; label: string; count: number; warn: boolean }[] = [
    { key: 'all', label: 'Todos', count: resolvedRows.length, warn: false },
    { key: 'estimated', label: 'Turno estimado', count: estimatedCount, warn: true },
    { key: 'duplicate', label: 'Duplicados', count: duplicateCount, warn: true },
    { key: 'adjusted', label: 'Ajustados', count: adjustedCount, warn: false },
  ];

  let filtered = resolvedRows;
  if (activeFilter === 'estimated') filtered = resolvedRows.filter(r => r.diasTurnoEstimado > 0);
  else if (activeFilter === 'duplicate') filtered = resolvedRows.filter(r => duplicateSet.has(r.codigoEmpleado));
  else if (activeFilter === 'adjusted') filtered = resolvedRows.filter(r => overtimeOverrides[r.codigoEmpleado] !== undefined);

  if (search.trim()) {
    filtered = filtered.filter(r =>
      matchesSearch(r.nombreEmpleado, search) || matchesSearch(r.codigoEmpleado, search));
  }

  const sorted = sortRows(filtered, sortColumn, sortDirection);

  const handleHeaderClick = (col: 'name' | 'code') => {
    if (sortColumn === col) {
      setReviewSort(col, sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setReviewSort(col, 'asc');
    }
  };

  const handleAccruesOvertimeToggle = async (row: ResolvedRow) => {
    if (!uploadToken) return;
    const newAccruesOvertime = !row.accruesOvertime;
    setPendingToggleId(row.codigoEmpleado);
    try {
      try {
        await updateAccruesOvertime(row.codigoEmpleado, newAccruesOvertime);
      } catch {
        useToastStore.getState().showToast('No se pudo actualizar el acumulado de horas extra del empleado.', 'error');
        return;
      }
      try {
        const result = await recomputeTas(uploadToken);
        setResolvedRows(result.resolvedRows);
        setSessionSummaries(result.sessionSummaries ?? {});
        if (newAccruesOvertime) {
          restoreOvertimeOverrides(row.codigoEmpleado);
        } else {
          stashOvertimeOverrides(row.codigoEmpleado);
        }
      } catch {
        useToastStore.getState().showToast('La sesión de carga expiró. Vuelve a subir el archivo.', 'error');
      }
    } finally {
      setPendingToggleId(null);
    }
  };

  const sortIndicator = (col: 'name' | 'code') => {
    if (sortColumn !== col) return '⇅';
    return sortDirection === 'asc' ? '▲' : '▼';
  };

  return (
    <>
      <div className="sticky top-0 z-10 bg-surface-container-lowest">
        <div className="px-6 pt-4 pb-2">
          <h2 className="text-headline-sm font-medium text-on-surface">
            Revisión de registros procesados
          </h2>
          <p className="text-body-md text-on-surface-variant mt-1">
            {resolvedRows.length === 1
              ? 'Se procesó 1 registro. Haz clic en un empleado para revisar detalles.'
              : `Se procesaron ${resolvedRows.length} registros. Haz clic en un empleado para revisar detalles.`}
          </p>
        </div>

        <div className="flex items-center gap-2 px-6 py-2 border-b border-outline-variant flex-wrap">
          <span className="text-label-sm text-on-surface-variant">Filtros:</span>
          {chips.map(chip => (
            <button
              key={chip.key}
              onClick={() => setReviewActiveFilter(chip.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-label-sm border transition-colors ${
                activeFilter === chip.key
                  ? 'bg-primary text-on-primary border-primary'
                  : chip.warn && chip.count > 0
                    ? 'bg-surface-container-lowest border-warning text-on-surface hover:bg-surface-container-low'
                    : 'bg-surface-container-lowest border-outline-variant text-on-surface hover:bg-surface-container-low'
              }`}
            >
              {chip.label}
              <span className={`text-label-sm px-1.5 rounded-full ${
                activeFilter === chip.key ? 'bg-on-primary/20' : 'bg-surface-container-high'
              }`}>
                {chip.count}
              </span>
            </button>
          ))}
          <div className="ml-auto relative w-60">
            <input
              type="text"
              placeholder="Buscar por nombre o código"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Buscar empleado"
              className="w-full border border-outline-variant rounded-shape-md px-3 py-1.5 pr-8 text-body-sm text-on-surface bg-surface-container-lowest focus:outline-none focus:border-primary transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface text-body-lg leading-none"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1">
        <table className="w-full border-collapse">
          <thead className="sticky top-[108px] z-[5]">
            <tr className="border-b border-outline-variant bg-surface-container-lowest">
              <th
                onClick={() => handleHeaderClick('name')}
                className="text-left text-label-lg text-on-surface-variant py-2 px-4 cursor-pointer hover:bg-surface-container-low select-none"
              >
                Empleado <span className={`text-label-sm ml-1 ${sortColumn === 'name' ? 'text-primary' : 'text-on-surface-variant'}`}>{sortIndicator('name')}</span>
              </th>
              <th
                onClick={() => handleHeaderClick('code')}
                className="text-left text-label-lg text-on-surface-variant py-2 px-4 cursor-pointer hover:bg-surface-container-low select-none"
              >
                Código <span className={`text-label-sm ml-1 ${sortColumn === 'code' ? 'text-primary' : 'text-on-surface-variant'}`}>{sortIndicator('code')}</span>
              </th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Días no lab.</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Extras simples</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Extras dobles</th>
              <th className="text-center text-label-lg text-on-surface-variant py-2 px-4">Acumula extras</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && search.trim() && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-body-md text-on-surface-variant">
                  No se encontraron empleados que coincidan con la búsqueda.
                </td>
              </tr>
            )}
            {sorted.map(row => {
              const isDuplicate = duplicateSet.has(row.codigoEmpleado);
              const override = overtimeOverrides[row.codigoEmpleado];
              const simplesOverride = override?.horasExtrasSimples;
              const doblesOverride = override?.horasExtrasDobles;

              return (
                <tr
                  key={row.codigoEmpleado}
                  onClick={() => !isDuplicate && setReviewSelectedEmployee(row.codigoEmpleado)}
                  className={`border-b border-outline-variant cursor-pointer transition-colors hover:bg-surface-container-low ${
                    isDuplicate ? 'opacity-50 cursor-default' : ''
                  }`}
                >
                  <td className="py-3 px-4 text-body-md text-on-surface">
                    {row.nombreEmpleado}
                    {row.diasTurnoEstimado > 0 && (
                      <span className="ml-2 text-label-sm px-2 py-0.5 rounded-full bg-warning-container text-on-warning-container">
                        {row.diasTurnoEstimado} turno est.
                      </span>
                    )}
                    {isDuplicate && (
                      <span className="ml-2 text-label-sm px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-medium">
                        ⚠ Duplicado
                      </span>
                    )}
                    {override !== undefined && (
                      <span className="ml-2 text-label-sm px-2 py-0.5 rounded-full bg-tertiary-container text-on-tertiary-container">
                        ✎ ajustado
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-body-md text-on-surface-variant">{row.codigoEmpleado}</td>
                  <td className="py-3 px-4 text-body-md text-on-surface-variant text-right">
                    {isDuplicate ? '—' : row.diasNoLaborados}
                  </td>
                  <td className="py-3 px-4 text-body-md text-right">
                    {isDuplicate ? '—' : (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          min={0}
                          value={simplesOverride ?? row.horasExtrasSimples}
                          onChange={e => {
                            const parsed = parseInt(e.target.value, 10);
                            setOvertimeOverride(row.codigoEmpleado, 'horasExtrasSimples', Number.isNaN(parsed) || parsed < 0 ? 0 : parsed);
                          }}
                          onClick={e => e.stopPropagation()}
                          aria-label={`Extras simples ${row.nombreEmpleado}`}
                          className={`w-16 text-right border rounded-shape-sm px-1.5 py-0.5 text-body-sm focus:outline-none focus:border-primary ${
                            simplesOverride !== undefined ? 'border-primary text-primary font-medium' : 'border-outline-variant text-on-surface-variant'
                          }`}
                        />
                        {simplesOverride !== undefined && (
                          <span className="text-label-sm text-on-surface-variant">(era {row.horasExtrasSimples})</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-body-md text-right">
                    {isDuplicate ? '—' : (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          min={0}
                          value={doblesOverride ?? row.horasExtrasDobles}
                          onChange={e => {
                            const parsed = parseInt(e.target.value, 10);
                            setOvertimeOverride(row.codigoEmpleado, 'horasExtrasDobles', Number.isNaN(parsed) || parsed < 0 ? 0 : parsed);
                          }}
                          onClick={e => e.stopPropagation()}
                          aria-label={`Extras dobles ${row.nombreEmpleado}`}
                          className={`w-16 text-right border rounded-shape-sm px-1.5 py-0.5 text-body-sm focus:outline-none focus:border-primary ${
                            doblesOverride !== undefined ? 'border-primary text-primary font-medium' : 'border-outline-variant text-on-surface-variant'
                          }`}
                        />
                        {doblesOverride !== undefined && (
                          <span className="text-label-sm text-on-surface-variant">(era {row.horasExtrasDobles})</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {isDuplicate ? '—' : (
                      <button
                        role="switch"
                        aria-checked={row.accruesOvertime}
                        aria-label={row.accruesOvertime ? `Desactivar acumulado ${row.nombreEmpleado}` : `Activar acumulado ${row.nombreEmpleado}`}
                        onClick={e => { e.stopPropagation(); handleAccruesOvertimeToggle(row); }}
                        disabled={pendingToggleId === row.codigoEmpleado}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          row.accruesOvertime ? 'bg-success' : 'bg-surface-container-high'
                        }`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface-container-lowest transition-transform ${
                          row.accruesOvertime ? 'translate-x-4' : 'translate-x-1'
                        }`} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 bg-surface-container-lowest border-t border-outline-variant px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-body-sm text-on-surface-variant">
          {dbHealthy === false && (
            <AlertMessage
              message="No se pudo conectar a la base de datos remota. Verifique la conexión de red e intente nuevamente."
              className="flex-shrink-0"
            />
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-body-sm text-on-surface-variant">
            {resolvedRows.length - duplicateCodes.length} registros a enviar
            {duplicateCodes.length > 0 && ` (${duplicateCodes.length} excluidos)`}
          </span>
          <button
            onClick={onSubmit}
            disabled={dbHealthy !== true || allDuplicate || duplicatesLoading}
            className="m3-btn-filled"
          >
            {allDuplicate ? 'Todos los registros ya fueron enviados' : 'Enviar'}
          </button>
        </div>
      </div>
    </>
  );
}
