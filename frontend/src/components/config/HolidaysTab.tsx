import { useEffect, useState } from 'react';
import { useConfigStore } from '../../configStore';
import { useToastStore } from '../../toastStore';
import { getHolidays, createHoliday, deleteHoliday, refreshHolidays } from '../../configApi';
import type { Holiday } from '../../configTypes';
import Spinner from '../ui/Spinner';
import ConfirmModal from '../ui/ConfirmModal';
import { MONTH_NAMES_ES } from '../../dateNames';

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dayName = DAY_NAMES[d.getDay()];
  const monthName = MONTH_NAMES_ES[month];
  const capitalDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
  return `${capitalDay} ${day} de ${monthName}`;
}

export default function HolidaysTab() {
  const holidaysData = useConfigStore(s => s.holidays.data);
  const holidaysLoading = useConfigStore(s => s.holidays.loading);
  const holidaysError = useConfigStore(s => s.holidays.error);
  const holidayYear = useConfigStore(s => s.holidayYear);
  const setHolidaysLoading = useConfigStore(s => s.setHolidaysLoading);
  const setHolidaysData = useConfigStore(s => s.setHolidaysData);
  const setHolidaysError = useConfigStore(s => s.setHolidaysError);
  const setHolidayYear = useConfigStore(s => s.setHolidayYear);
  const showToast = useToastStore(s => s.showToast);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setHolidaysLoading(true);
    setHolidaysError(null);
    getHolidays(holidayYear)
      .then(data => setHolidaysData(data))
      .catch(() => setHolidaysError('No se pudo cargar los feriados.'))
      .finally(() => setHolidaysLoading(false));
  }, [holidayYear, setHolidaysLoading, setHolidaysData, setHolidaysError]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshSuccess(false);
    try {
      await refreshHolidays(holidayYear);
      const data = await getHolidays(holidayYear);
      setHolidaysData(data);
      setRefreshSuccess(true);
    } catch {
      setRefreshError('No se pudo actualizar. Revise su conexión e intente de nuevo.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteHoliday(deleteTarget.id);
      setHolidaysData((holidaysData ?? []).filter(h => h.id !== deleteTarget.id));
      setDeleteTarget(null);
      showToast('Cambios guardados');
    } catch {
      setHolidaysError('No se pudo eliminar el feriado.');
      setDeleteTarget(null);
    }
  };

  const handleAdd = async () => {
    if (!newDate || !newName.trim()) return;
    try {
      const created = await createHoliday({ date: newDate, name: newName.trim() });
      setHolidaysData([...(holidaysData ?? []), created]);
      setNewDate('');
      setNewName('');
      showToast('Cambios guardados');
    } catch {
      setHolidaysError('No se pudo agregar el feriado.');
    }
  };

  const holidays = holidaysData ?? [];

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setHolidayYear(holidayYear - 1)}
            aria-label="Año anterior"
            className="p-1 rounded-shape-xs hover:bg-surface-container-low text-on-surface-variant"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-title-md font-medium text-on-surface w-12 text-center">{holidayYear}</span>
          <button
            onClick={() => setHolidayYear(holidayYear + 1)}
            aria-label="Año siguiente"
            className="p-1 rounded-shape-xs hover:bg-surface-container-low text-on-surface-variant"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col items-end gap-1">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="m3-btn-outlined"
          >
            {refreshing ? (
              <Spinner size="w-4 h-4" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {refreshSuccess ? 'Actualizado ✓' : 'Actualizar desde internet'}
          </button>
          {refreshError && (
            <p className="text-label-sm text-error">{refreshError}</p>
          )}
          <p className="text-label-sm text-on-surface-variant max-w-xs text-right">
            Descarga el calendario oficial de feriados de Guatemala desde internet. Los feriados agregados manualmente no serán reemplazados.
          </p>
        </div>
      </div>

      {holidaysError && (
        <div className="cfg-error-banner">{holidaysError}</div>
      )}

      {holidaysLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="w-6 h-6" />
        </div>
      ) : holidays.length === 0 ? (
        <div className="py-12 text-center text-on-surface-variant text-body-sm">
          No hay feriados registrados para este año. Usa el botón 'Actualizar desde internet' para cargarlos.
        </div>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="cfg-table-header">
                <th className="cfg-th">Fecha</th>
                <th className="cfg-th">Nombre</th>
                <th className="cfg-th">Fuente</th>
                <th className="px-4 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {holidays.map(h => (
                <tr key={h.id} className="cfg-table-row">
                  <td className="px-4 py-2 text-on-surface">{formatDate(h.date)}</td>
                  <td className="px-4 py-2 text-on-surface">{h.name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium ${
                        h.source === 'API'
                          ? 'bg-primary-container text-on-primary-container'
                          : 'bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      {h.source === 'API' ? 'API' : 'Manual'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => setDeleteTarget(h)}
                      aria-label="Eliminar feriado"
                      className="text-error hover:text-on-error-container transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-outline-variant pt-4">
        <p className="text-label-lg font-medium text-on-surface mb-2">+ Agregar feriado</p>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-label-sm text-on-surface-variant">Fecha</label>
            <input
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="cfg-input"
              aria-label="Fecha del nuevo feriado"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-40">
            <label className="text-label-sm text-on-surface-variant">Nombre</label>
            <input
              type="text"
              placeholder="Nombre del feriado"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="cfg-input"
              aria-label="Nombre del nuevo feriado"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!newDate || !newName.trim()}
            className="m3-btn-filled"
          >
            Agregar
          </button>
        </div>
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="Eliminar feriado"
          message={`¿Estás seguro de que deseas eliminar ${deleteTarget.name} (${formatDate(deleteTarget.date)})? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
