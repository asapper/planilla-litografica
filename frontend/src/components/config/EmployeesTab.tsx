import { useEffect, useState } from 'react';
import { useConfigStore } from '../../configStore';
import { useToastStore } from '../../toastStore';
import { getEmployees, updateEmployee, bulkAssignShift, getShifts, updateAccruesOvertime } from '../../configApi';
import type { Employee, Shift } from '../../configTypes';
import Spinner from '../ui/Spinner';

type FilterStatus = 'all' | 'active' | 'inactive';

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
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {employeesError}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Buscar por nombre o código"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-56"
          aria-label="Buscar empleado"
        />

        <div className="flex gap-1">
          {(['all', 'active', 'inactive'] as FilterStatus[]).map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                filterStatus === status
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {status === 'all' ? 'Todos' : status === 'active' ? 'Activos' : 'Inactivos'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Turno:</label>
          <select
            value={filterShiftId}
            onChange={e => setFilterShiftId(e.target.value === '' ? '' : e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">Todos</option>
            {shifts.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded">
          <span className="text-sm text-blue-700">{selectedIds.size} seleccionado(s)</span>
          <select
            value={bulkShiftId}
            onChange={e => setBulkShiftId(e.target.value === '' ? '' : e.target.value)}
            className="border border-blue-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
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
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Aplicar
          </button>
        </div>
      )}

      {employees.length === 0 ? (
        <div className="py-12 text-center text-gray-500 text-sm">
          Aún no hay empleados registrados. Sube un archivo TAS para comenzar.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 bg-gray-50 text-left">
                <th className="px-4 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleAll}
                    aria-label="Seleccionar todos"
                  />
                </th>
                <th className="px-4 py-2 font-medium text-gray-700">Código</th>
                <th className="px-4 py-2 font-medium text-gray-700">Nombre</th>
                <th className="px-4 py-2 font-medium text-gray-700">Turno asignado</th>
                <th className="px-4 py-2 font-medium text-gray-700">Activo</th>
                <th className="px-4 py-2 font-medium text-gray-700">Acumula horas extra</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => (
                <>
                  <tr key={emp.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(emp.id)}
                        onChange={() => toggleSelect(emp.id)}
                        aria-label={`Seleccionar ${emp.name}`}
                      />
                    </td>
                    <td className="px-4 py-2 text-gray-600 font-mono">{emp.code}</td>
                    <td className="px-4 py-2">{emp.name}</td>
                    <td className="px-4 py-2">
                      <select
                        value={emp.shiftId ?? ''}
                        onChange={e => handleShiftChange(emp.id, e.target.value === '' ? null : e.target.value)}
                        className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
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
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          emp.active ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            emp.active ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        role="switch"
                        aria-checked={emp.accruesOvertime}
                        aria-label={emp.accruesOvertime ? 'Desactivar acumulado de horas extra' : 'Activar acumulado de horas extra'}
                        onClick={() => handleAccruesOvertimeToggle(emp)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          emp.accruesOvertime ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            emp.accruesOvertime ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                  {reactivationNotes.has(emp.id) && !dismissedNotes.has(emp.id) && (
                    <tr key={`note-${emp.id}`}>
                      <td colSpan={6} className="px-4 py-1">
                        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded px-3 py-1.5 text-sm text-amber-700">
                          <span>Turno restablecido al turno por defecto. Verifique si corresponde.</span>
                          <button
                            onClick={() => setDismissedNotes(prev => new Set([...prev, emp.id]))}
                            aria-label="Descartar nota"
                            className="ml-2 text-amber-500 hover:text-amber-700"
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

      <p className="mt-4 text-xs text-gray-400">
        Los empleados se agregan automáticamente al subir un archivo TAS.
      </p>
    </div>
  );
}
