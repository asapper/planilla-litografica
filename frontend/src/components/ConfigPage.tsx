import { useState } from 'react';
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
      <div className="bg-surface-container-lowest rounded-shape-lg shadow-lg max-w-sm w-full mx-4 p-6">
        <h3 className="text-title-md font-medium text-on-surface mb-2">Cambios sin guardar</h3>
        <p className="text-body-sm text-on-surface-variant mb-6">
          Tienes cambios sin guardar. ¿Deseas descartarlos?
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onKeep}
            className="m3-btn-outlined"
          >
            Seguir editando
          </button>
          <button
            onClick={onDiscard}
            className="m3-btn-filled !bg-error !text-on-error"
          >
            Descartar cambios
          </button>
        </div>
      </div>
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
    <div className="min-h-screen bg-surface pt-16">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-headline-sm font-semibold text-on-surface mb-6">Configuración</h1>

        <div className="bg-surface-container-lowest rounded-shape-md shadow-sm border border-outline-variant">
          <div className="border-b border-outline-variant">
            <nav className="flex" role="tablist" aria-label="Secciones de configuración">
              {TAB_ORDER.map(tab => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => handleTabClick(tab)}
                  className={`px-6 py-3 text-label-lg font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === tab
                      ? 'border-primary text-primary'
                      : 'border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline'
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

    </div>
  );
}
