import { useEffect, useState } from 'react';
import { useConfigStore } from '../../configStore';
import { useToastStore } from '../../toastStore';
import { getShifts, createShift, updateShift, deleteShift } from '../../configApi';
import type { Shift } from '../../configTypes';
import Spinner from '../ui/Spinner';

function isCrossMidnight(start: string, end: string): boolean {
  if (!start || !end) return false;
  return end < start;
}

interface RowProps {
  shift: Shift;
  onUpdate: (id: string, field: keyof Pick<Shift, 'name' | 'startTime' | 'endTime'>, value: string) => void;
  onDetectionChange: (id: string, field: 'detectionBeforeMinutes' | 'detectionAfterMinutes', value: number) => void;
  onDelete: (id: string) => void;
  deleteError: string | null;
}

function ShiftRow({ shift, onUpdate, onDetectionChange, onDelete, deleteError }: RowProps) {
  return (
    <>
      <tr className="cfg-table-row">
        <td className="px-4 py-2">
          <input
            className="cfg-input w-full"
            value={shift.name}
            onChange={e => onUpdate(shift.id, 'name', e.target.value)}
            aria-label="Nombre del turno"
          />
        </td>
        <td className="px-4 py-2">
          <input
            type="time"
            lang="en-US"
            className="cfg-input"
            value={shift.startTime}
            onChange={e => onUpdate(shift.id, 'startTime', e.target.value)}
            aria-label="Hora de inicio"
          />
        </td>
        <td className="px-4 py-2">
          <input
            type="time"
            lang="en-US"
            className="cfg-input"
            value={shift.endTime}
            onChange={e => onUpdate(shift.id, 'endTime', e.target.value)}
            aria-label="Hora de fin"
          />
        </td>
        <td className="px-4 py-2">
          <input
            type="number"
            className="cfg-input w-20"
            value={shift.detectionBeforeMinutes}
            min={0}
            onChange={e => {
              const parsed = Number(e.target.value);
              onDetectionChange(shift.id, 'detectionBeforeMinutes', Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
            }}
            aria-label="Detección antes (min)"
          />
        </td>
        <td className="px-4 py-2">
          <input
            type="number"
            className="cfg-input w-20"
            value={shift.detectionAfterMinutes}
            min={0}
            onChange={e => {
              const parsed = Number(e.target.value);
              onDetectionChange(shift.id, 'detectionAfterMinutes', Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
            }}
            aria-label="Detección después (min)"
          />
        </td>
        <td className="px-4 py-2 text-center">
          <button
            onClick={() => onDelete(shift.id)}
            aria-label="Eliminar turno"
            className="text-error hover:text-on-error-container transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </td>
      </tr>
      {deleteError && (
        <tr>
          <td colSpan={6} className="px-4 py-1">
            <p className="text-body-sm text-error bg-error-container rounded-shape-xs px-2 py-1">{deleteError}</p>
          </td>
        </tr>
      )}
    </>
  );
}

interface AddRowProps {
  onAdd: (name: string, startTime: string, endTime: string, detectionBeforeMinutes: number, detectionAfterMinutes: number) => void;
}

function AddShiftRow({ onAdd }: AddRowProps) {
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [detectionBeforeMinutes, setDetectionBeforeMinutes] = useState(60);
  const [detectionAfterMinutes, setDetectionAfterMinutes] = useState(10);

  const canAdd = name.trim() !== '' && startTime !== '' && endTime !== '';

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd(name.trim(), startTime, endTime, detectionBeforeMinutes, detectionAfterMinutes);
    setName('');
    setStartTime('');
    setEndTime('');
    setDetectionBeforeMinutes(60);
    setDetectionAfterMinutes(10);
  };

  return (
    <tr className="border-t-2 border-outline bg-primary-container/30">
      <td className="px-4 py-2">
        <input
          className="cfg-input w-full"
          placeholder="Nombre del turno"
          value={name}
          onChange={e => setName(e.target.value)}
          aria-label="Nombre del nuevo turno"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="time"
          className="cfg-input"
          value={startTime}
          onChange={e => setStartTime(e.target.value)}
          aria-label="Hora de inicio del nuevo turno"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="time"
          className="cfg-input"
          value={endTime}
          onChange={e => setEndTime(e.target.value)}
          aria-label="Hora de fin del nuevo turno"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          className="cfg-input w-20"
          value={detectionBeforeMinutes}
          min={0}
          onChange={e => {
            const parsed = Number(e.target.value);
            setDetectionBeforeMinutes(Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
          }}
          aria-label="Detección antes (min) del nuevo turno"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          className="cfg-input w-20"
          value={detectionAfterMinutes}
          min={0}
          onChange={e => {
            const parsed = Number(e.target.value);
            setDetectionAfterMinutes(Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
          }}
          aria-label="Detección después (min) del nuevo turno"
        />
      </td>
      <td className="px-4 py-2 text-center">
        <button
          onClick={handleAdd}
          disabled={!canAdd}
          className="m3-btn-filled text-label-lg whitespace-nowrap"
        >
          + Agregar turno
        </button>
      </td>
    </tr>
  );
}

export default function ShiftsTab() {
  const shiftsData = useConfigStore(s => s.shifts.data);
  const shiftsLoading = useConfigStore(s => s.shifts.loading);
  const shiftsDirty = useConfigStore(s => s.shifts.dirty);
  const shiftsError = useConfigStore(s => s.shifts.error);
  const setShiftsLoading = useConfigStore(s => s.setShiftsLoading);
  const setShiftsData = useConfigStore(s => s.setShiftsData);
  const setShiftsDirty = useConfigStore(s => s.setShiftsDirty);
  const setShiftsError = useConfigStore(s => s.setShiftsError);
  const showToast = useToastStore(s => s.showToast);

  const [localShifts, setLocalShifts] = useState<Shift[]>([]);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (shiftsData) {
      setLocalShifts(shiftsData);
    }
  }, [shiftsData]);

  useEffect(() => {
    setShiftsLoading(true);
    getShifts()
      .then(data => setShiftsData(data))
      .catch(() => setShiftsError('No se pudo cargar los turnos.'))
      .finally(() => setShiftsLoading(false));
  }, [setShiftsLoading, setShiftsData, setShiftsError]);

  const handleUpdate = (id: string, field: keyof Pick<Shift, 'name' | 'startTime' | 'endTime'>, value: string) => {
    setLocalShifts(prev => prev.map(s => {
      if (s.id !== id) return s;
      const updated = { ...s, [field]: value };
      updated.crossMidnight = isCrossMidnight(updated.startTime, updated.endTime);
      return updated;
    }));
    setShiftsDirty(true);
  };

  const handleDetectionChange = (id: string, field: 'detectionBeforeMinutes' | 'detectionAfterMinutes', value: number) => {
    setLocalShifts(prev => prev.map(s => (s.id === id ? { ...s, [field]: value } : s)));
    setShiftsDirty(true);
  };

  const handleSave = async () => {
    setShiftsLoading(true);
    setShiftsError(null);
    try {
      const updated = await Promise.all(
        localShifts.map(s =>
          updateShift(s.id, {
            name: s.name,
            startTime: s.startTime,
            endTime: s.endTime,
            crossMidnight: s.crossMidnight,
            detectionBeforeMinutes: s.detectionBeforeMinutes,
            detectionAfterMinutes: s.detectionAfterMinutes,
          })
        )
      );
      setShiftsData(updated);
      setShiftsDirty(false);
      showToast('Cambios guardados');
    } catch {
      setShiftsError('No se pudieron guardar los cambios.');
    } finally {
      setShiftsLoading(false);
    }
  };

  const handleDiscard = () => {
    if (shiftsData) setLocalShifts(shiftsData);
    setShiftsDirty(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteShift(id);
      const newData = localShifts.filter(s => s.id !== id);
      setLocalShifts(newData);
      setShiftsData(newData);
      setDeleteErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err: any) {
      const body = err?.response?.data;
      if (body?.error === 'SHIFT_HAS_ACTIVE_EMPLOYEES') {
        const count = body?.activeEmployeeCount ?? '';
        const msg = count
          ? `Este turno está asignado a ${count} empleado(s) activo(s). Reasígnalos antes de eliminarlo.`
          : 'Este turno está asignado a empleados activos. Reasígnalos antes de eliminarlo.';
        setDeleteErrors(prev => ({ ...prev, [id]: msg }));
      } else {
        setDeleteErrors(prev => ({ ...prev, [id]: 'No se pudo eliminar el turno.' }));
      }
    }
  };

  const handleAdd = async (name: string, startTime: string, endTime: string, detectionBeforeMinutes: number, detectionAfterMinutes: number) => {
    const crossMidnight = isCrossMidnight(startTime, endTime);
    try {
      const created = await createShift({ name, startTime, endTime, crossMidnight, detectionBeforeMinutes, detectionAfterMinutes });
      const newData = [...localShifts, created];
      setLocalShifts(newData);
      setShiftsData(newData);
    } catch {
      setShiftsError('No se pudo agregar el turno.');
    }
  };

  if (shiftsLoading && !localShifts.length) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="w-6 h-6" />
      </div>
    );
  }

  return (
    <div>
      {shiftsError && (
        <div className="cfg-error-banner">{shiftsError}</div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="cfg-table-header">
              <th className="cfg-th">Nombre</th>
              <th className="cfg-th">Inicio (HH:MM)</th>
              <th className="cfg-th">Fin (HH:MM)</th>
              <th className="cfg-th">Detección antes (min)</th>
              <th className="cfg-th">Detección después (min)</th>
              <th className="cfg-th text-center w-40"></th>
            </tr>
          </thead>
          <tbody>
            {localShifts.map(shift => (
              <ShiftRow
                key={shift.id}
                shift={shift}
                onUpdate={handleUpdate}
                onDetectionChange={handleDetectionChange}
                onDelete={handleDelete}
                deleteError={deleteErrors[shift.id] ?? null}
              />
            ))}
            <AddShiftRow onAdd={handleAdd} />
          </tbody>
        </table>
      </div>

      <div className="cfg-footer">
        <button
          onClick={handleSave}
          disabled={!shiftsDirty || shiftsLoading}
          className="cfg-save-btn"
        >
          Guardar cambios
        </button>
        <button
          onClick={handleDiscard}
          disabled={!shiftsDirty}
          className="cfg-discard-btn"
        >
          Descartar
        </button>
      </div>
    </div>
  );
}
