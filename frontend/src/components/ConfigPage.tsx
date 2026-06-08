import { useEffect, useState } from 'react';
import { useConfigStore } from '../configStore';
import type { ConfigTab } from '../configTypes';
import ShiftsTab from './config/ShiftsTab';
import EmployeesTab from './config/EmployeesTab';
import HolidaysTab from './config/HolidaysTab';
import GeneralTab from './config/GeneralTab';

const TAB_LABELS: Record<ConfigTab, string> = {
  shifts: 'Turnos',
  employees: 'Empleados',
  holidays: 'Feriados',
  general: 'General',
};

const TAB_ORDER: ConfigTab[] = ['shifts', 'employees', 'holidays', 'general'];

interface UnsavedGuardProps {
  onDiscard: () => void;
  onKeep: () => void;
}

function UnsavedGuard({ onDiscard, onKeep }: UnsavedGuardProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-lg max-w-sm w-full mx-4 p-6">
        <h3 className="text-base font-medium text-gray-900 mb-2">Cambios sin guardar</h3>
        <p className="text-sm text-gray-600 mb-6">
          Tienes cambios sin guardar. ¿Deseas descartarlos?
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onKeep}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Seguir editando
          </button>
          <button
            onClick={onDiscard}
            className="px-4 py-2 text-sm text-white bg-red-600 rounded hover:bg-red-700"
          >
            Descartar cambios
          </button>
        </div>
      </div>
    </div>
  );
}

interface ToastProps {
  message: string;
  visible: boolean;
  onHide: () => void;
}

function Toast({ message, visible, onHide }: ToastProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onHide, 3_000);
    return () => clearTimeout(timer);
  }, [visible, onHide]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-green-600 text-white rounded shadow-lg text-sm"
    >
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
      {message}
    </div>
  );
}

export default function ConfigPage() {
  const activeTab = useConfigStore(s => s.activeTab);
  const setActiveTab = useConfigStore(s => s.setActiveTab);

  const shiftsDirty = useConfigStore(s => s.shifts.dirty);
  const employeesDirty = useConfigStore(s => s.employees.dirty);
  const holidaysDirty = useConfigStore(s => s.holidays.dirty);
  const generalDirty = useConfigStore(s => s.general.dirty);

  const setShiftsDirty = useConfigStore(s => s.setShiftsDirty);
  const setEmployeesDirty = useConfigStore(s => s.setEmployeesDirty);
  const setHolidaysDirty = useConfigStore(s => s.setHolidaysDirty);
  const setGeneralDirty = useConfigStore(s => s.setGeneralDirty);

  const toastVisible = useConfigStore(s => s.toastVisible);
  const toastMessage = useConfigStore(s => s.toastMessage);
  const hideToast = useConfigStore(s => s.hideToast);

  const [pendingTab, setPendingTab] = useState<ConfigTab | null>(null);

  const currentTabDirty =
    (activeTab === 'shifts' && shiftsDirty) ||
    (activeTab === 'employees' && employeesDirty) ||
    (activeTab === 'holidays' && holidaysDirty) ||
    (activeTab === 'general' && generalDirty);

  const handleTabClick = (tab: ConfigTab) => {
    if (tab === activeTab) return;
    if (currentTabDirty) {
      setPendingTab(tab);
    } else {
      setActiveTab(tab);
    }
  };

  const handleGuardDiscard = () => {
    if (activeTab === 'shifts') setShiftsDirty(false);
    if (activeTab === 'employees') setEmployeesDirty(false);
    if (activeTab === 'holidays') setHolidaysDirty(false);
    if (activeTab === 'general') setGeneralDirty(false);
    if (pendingTab) setActiveTab(pendingTab);
    setPendingTab(null);
  };

  const handleGuardKeep = () => {
    setPendingTab(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 pt-16">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Configuración</h1>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="border-b border-gray-200">
            <nav className="flex" role="tablist" aria-label="Secciones de configuración">
              {TAB_ORDER.map(tab => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => handleTabClick(tab)}
                  className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === tab
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6" role="tabpanel" aria-label={TAB_LABELS[activeTab]}>
            {activeTab === 'shifts' && <ShiftsTab />}
            {activeTab === 'employees' && <EmployeesTab />}
            {activeTab === 'holidays' && <HolidaysTab />}
            {activeTab === 'general' && <GeneralTab />}
          </div>
        </div>
      </div>

      {pendingTab && (
        <UnsavedGuard
          onDiscard={handleGuardDiscard}
          onKeep={handleGuardKeep}
        />
      )}

      <Toast
        message={toastMessage}
        visible={toastVisible}
        onHide={hideToast}
      />
    </div>
  );
}
