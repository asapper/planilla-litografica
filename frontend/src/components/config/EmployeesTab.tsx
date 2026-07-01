import { useEffect, useState } from 'react';
import { useConfigStore } from '../../configStore';
import { useToastStore } from '../../toastStore';
import { getEmployees, updateEmployee, bulkAssignShift, getShifts, updateAccruesOvertime } from '../../configApi';
import type { Employee, Shift } from '../../configTypes';
import Spinner from '../ui/Spinner';

type FilterStatus = 'all' | 'active' | 'inactive';
type SortColumn = 'code' | 'name' | 'shiftName' | 'active' | 'accruesOvertime';

export default function EmployeesTab() {
  const employeesData = useConfigStore(s => s.employees.data);
  const employeesLoading = useConfigStore(s => s.employees.loading);
  const employeesError = useConfigStore(s => s.employees.error);
  const setEmployeesLoading = useConfigStore(s => s.setEmployeesLoading);
  const setEmployeesData = useConfigStore(s => s.setEmployeesData);
  const setEmployeesError = useConfigStore(s => s.setEmployeesError);
  const showToast = useToastStore(s => s.showToast);

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterShiftId, setFilterShiftId] = useState<string | ''>('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkShiftId, setBulkShiftId] = useState<string | ''>('');
  const [reactivationNotes, setReactivationNotes] = useState<Set<string>>(new Set());
  const [dismissedNotes, setDismissedNotes] = useState<Set<string>>(new Set());

  useEffect(() => {
    setEmployeesLoading(true);
    Promise.all([
      getEmployees(),
      getShifts(),
    ])
      .then(([emps, sh]) => {
        setEmployeesData(emps);
        setShifts(sh);
      })
      .catch(() => setEmployeesError('No se pudo cargar los empleados.'))
      .finally(() => setEmployeesLoading(false));
  }, [setEmployeesLoading, setEmployeesData, setEmployeesError]);

  const employees = employeesData ?? [];

  const filtered = employees.filter(e => {
    if (filterStatus === 'active' && !e.active) return false;
    if (filterStatus === 'inactive' && e.active) return false;
    if (filterShiftId !== '' && e.shiftId !== filterShiftId) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!e.name.toLowerCase().includes(q) && !e.code.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortColumn) {
      case 'code': cmp = a.code.localeCompare(b.code, 'es'); break;
      case 'name': cmp = a.name.localeCompare(b.name, 'es'); break;
      case 'shiftName': cmp = (a.shiftName ?? '').localeCompare(b.shiftName ?? '', 'es'); break;
      case 'active': cmp = Number(a.active) - Number(b.active); break;
      case 'accruesOvertime': cmp = Number(a.accruesOvertime) - Number(b.accruesOvertime); break;
    }
    return sortDirection === 'desc' ? -cmp : cmp;
  });

  const handleHeaderClick = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const sortIndicator = (col: SortColumn) =>
    sortColumn !== col ? '⇅' : sortDirection === 'asc' ? '▲' : '▼';

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(e => e.id)));
    }
  };

  const handleShiftChange = async (id: string, shiftId: string | null) => {
    try {
      const updated = await updateEmployee(id, { shiftId });
      setEmployeesData(employees.map(e => e.id === id ? updated : e));
    } catch {
      setEmployeesError('No se pudo actualizar el turno del empleado.');
    }
  };

  const handleActiveToggle = async (emp: Employee) => {
    const newActive = !emp.active;
    try {
      const updated = await updateEmployee(emp.id, { active: newActive });
      setEmployeesData(employees.map(e => e.id === emp.id ? updated : e));
      if (newActive && !emp.shiftId) {
        setReactivationNotes(prev => new Set([...prev, emp.id]));
      }
      showToast('Cambios guardados');
    } catch {
      setEmployeesError('No se pudo actualizar el estado del empleado.');
    }
  };

  const handleAccruesOvertimeToggle = async (emp: Employee) => {
    const newAccruesOvertime = !emp.accruesOvertime;
    try {
      const updated = await updateAccruesOvertime(emp.id, newAccruesOvertime);
      setEmployeesData(employees.map(e => e.id === emp.id ? updated : e));
      showToast('Cambios guardados');
    } catch {
      setEmployeesError('No se pudo actualizar el acumulado de horas extra del empleado.');
    }
  };

  const handleBulkAssign = async () => {
    if (bulkShiftId === '' || selectedIds.size === 0) return;
    try {
      await bulkAssignShift([...selectedIds], bulkShiftId as string);
      const shiftName = shifts.find(s => s.id === bulkShiftId)?.name ?? null;
      setEmployeesData(employees.map(e =>
        selectedIds.has(e.id) ? { ...e, shiftId: bulkShiftId as string, shiftName } : e
      ));
      setSelectedIds(new Set());
      setBulkShiftId('');
      showToast('Cambios guardados');
    } catch {
      setEmployeesError('No se pudo asignar el turno en masa.');
    }
  };

  if (employeesLoading && !employeesData) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="w-6 h-6" />
      </div>
    );
  }

  return (
    <div>
      {employeesError && (
        <div className="cfg-error-banner">{employeesError}</div>
      )}

      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative w-56">
          <input
            type="text"
            placeholder="Buscar por nombre o código"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="cfg-input w-full pr-8"
            aria-label="Buscar empleado"
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

        <div className="flex gap-1">
          {(['all', 'active', 'inactive'] as FilterStatus[]).map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`m3-chip ${filterStatus === status ? 'm3-chip-selected' : ''}`}
            >
              {status === 'all' ? 'Todos' : status === 'active' ? 'Activos' : 'Inactivos'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-label-lg text-on-surface-variant">Turno:</label>
          <select
            value={filterShiftId}
            onChange={e => setFilterShiftId(e.target.value === '' ? '' : e.target.value)}
            className="cfg-input"
          >
            <option value="">Todos</option>
            {shifts.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 px-3 py-2 bg-primary-container border border-primary rounded-shape-xs">
          <span className="text-body-sm text-on-primary-container">{selectedIds.size} seleccionado(s)</span>
          <select
            value={bulkShiftId}
            onChange={e => setBulkShiftId(e.target.value === '' ? '' : e.target.value)}
            className="cfg-input"
            aria-label="Turno para asignación masiva"
          >
            <option value="">Seleccionar turno</option>
            {shifts.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={handleBulkAssign}
            disabled={bulkShiftId === ''}
            className="m3-btn-filled text-label-lg"
          >
            Aplicar
          </button>
        </div>
      )}

      {employees.length === 0 ? (
        <div className="py-12 text-center text-on-surface-variant text-body-sm">
          Aún no hay empleados registrados. Sube un archivo TAS para comenzar.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="cfg-table-header">
                <th className="px-4 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleAll}
                    aria-label="Seleccionar todos"
                  />
                </th>
                <th className="cfg-th cursor-pointer hover:bg-surface-container-low select-none" onClick={() => handleHeaderClick('code')}>
                  Código <span className={`text-label-sm ml-1 ${sortColumn === 'code' ? 'text-primary' : 'text-on-surface-variant'}`}>{sortIndicator('code')}</span>
                </th>
                <th className="cfg-th cursor-pointer hover:bg-surface-container-low select-none" onClick={() => handleHeaderClick('name')}>
                  Nombre <span className={`text-label-sm ml-1 ${sortColumn === 'name' ? 'text-primary' : 'text-on-surface-variant'}`}>{sortIndicator('name')}</span>
                </th>
                <th className="cfg-th cursor-pointer hover:bg-surface-container-low select-none" onClick={() => handleHeaderClick('shiftName')}>
                  Turno asignado <span className={`text-label-sm ml-1 ${sortColumn === 'shiftName' ? 'text-primary' : 'text-on-surface-variant'}`}>{sortIndicator('shiftName')}</span>
                </th>
                <th className="cfg-th cursor-pointer hover:bg-surface-container-low select-none" onClick={() => handleHeaderClick('active')}>
                  Activo <span className={`text-label-sm ml-1 ${sortColumn === 'active' ? 'text-primary' : 'text-on-surface-variant'}`}>{sortIndicator('active')}</span>
                </th>
                <th className="cfg-th cursor-pointer hover:bg-surface-container-low select-none" onClick={() => handleHeaderClick('accruesOvertime')}>
                  Acumula horas extra <span className={`text-label-sm ml-1 ${sortColumn === 'accruesOvertime' ? 'text-primary' : 'text-on-surface-variant'}`}>{sortIndicator('accruesOvertime')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(emp => (
                <>
                  <tr key={emp.id} className="cfg-table-row">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(emp.id)}
                        onChange={() => toggleSelect(emp.id)}
                        aria-label={`Seleccionar ${emp.name}`}
                      />
                    </td>
                    <td className="px-4 py-2 text-on-surface-variant font-mono">{emp.code}</td>
                    <td className="px-4 py-2 text-on-surface">{emp.name}</td>
                    <td className="px-4 py-2">
                      <select
                        value={emp.shiftId ?? ''}
                        onChange={e => handleShiftChange(emp.id, e.target.value === '' ? null : e.target.value)}
                        className="cfg-input"
                        aria-label={`Turno de ${emp.name}`}
                      >
                        <option value="">Sin turno</option>
                        {shifts.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        role="switch"
                        aria-checked={emp.active}
                        aria-label={emp.active ? 'Desactivar empleado' : 'Activar empleado'}
                        onClick={() => handleActiveToggle(emp)}
                        className={emp.active ? 'cfg-toggle-on' : 'cfg-toggle-off'}
                      >
                        <span
                          className={`cfg-toggle-thumb ${emp.active ? 'translate-x-4' : 'translate-x-1'}`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        role="switch"
                        aria-checked={emp.accruesOvertime}
                        aria-label={emp.accruesOvertime ? 'Desactivar acumulado de horas extra' : 'Activar acumulado de horas extra'}
                        onClick={() => handleAccruesOvertimeToggle(emp)}
                        className={emp.accruesOvertime ? 'cfg-toggle-on' : 'cfg-toggle-off'}
                      >
                        <span
                          className={`cfg-toggle-thumb ${emp.accruesOvertime ? 'translate-x-4' : 'translate-x-1'}`}
                        />
                      </button>
                    </td>
                  </tr>
                  {reactivationNotes.has(emp.id) && !dismissedNotes.has(emp.id) && (
                    <tr key={`note-${emp.id}`}>
                      <td colSpan={6} className="px-4 py-1">
                        <div className="flex items-center justify-between bg-warning-container border border-warning rounded-shape-xs px-3 py-1.5 text-body-sm text-on-warning-container">
                          <span>Turno restablecido al turno por defecto. Verifique si corresponde.</span>
                          <button
                            onClick={() => setDismissedNotes(prev => new Set([...prev, emp.id]))}
                            aria-label="Descartar nota"
                            className="ml-2 text-warning hover:text-on-warning-container"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-label-sm text-on-surface-variant">
        Los empleados se agregan automáticamente al subir un archivo TAS.
      </p>
    </div>
  );
}
