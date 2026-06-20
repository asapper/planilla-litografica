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
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-base font-medium text-gray-800 w-12 text-center">{holidayYear}</span>
          <button
            onClick={() => setHolidayYear(holidayYear + 1)}
            aria-label="Año siguiente"
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
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
            className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <p className="text-xs text-red-600">{refreshError}</p>
          )}
          <p className="text-xs text-gray-400 max-w-xs text-right">
            Descarga el calendario oficial de feriados de Guatemala desde internet. Los feriados agregados manualmente no serán reemplazados.
          </p>
        </div>
      </div>

      {holidaysError && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {holidaysError}
        </div>
      )}

      {holidaysLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="w-6 h-6" />
        </div>
      ) : holidays.length === 0 ? (
        <div className="py-12 text-center text-gray-500 text-sm">
          No hay feriados registrados para este año. Usa el botón 'Actualizar desde internet' para cargarlos.
        </div>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 bg-gray-50 text-left">
                <th className="px-4 py-2 font-medium text-gray-700">Fecha</th>
                <th className="px-4 py-2 font-medium text-gray-700">Nombre</th>
                <th className="px-4 py-2 font-medium text-gray-700">Fuente</th>
                <th className="px-4 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {holidays.map(h => (
                <tr key={h.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-700">{formatDate(h.date)}</td>
                  <td className="px-4 py-2">{h.name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        h.source === 'API'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {h.source === 'API' ? 'API' : 'Manual'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => setDeleteTarget(h)}
                      aria-label="Eliminar feriado"
                      className="text-red-600 hover:text-red-800 transition-colors"
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

      <div className="border-t border-gray-200 pt-4">
        <p className="text-sm font-medium text-gray-700 mb-2">+ Agregar feriado</p>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Fecha</label>
            <input
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              aria-label="Fecha del nuevo feriado"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-40">
            <label className="text-xs text-gray-500">Nombre</label>
            <input
              type="text"
              placeholder="Nombre del feriado"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              aria-label="Nombre del nuevo feriado"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!newDate || !newName.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
