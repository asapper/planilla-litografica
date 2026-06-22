import { Fragment, useEffect, useState } from 'react';
import { useTasStore } from '../../tasStore';
import { updateAccruesOvertime } from '../../configApi';
import { recomputeTas } from '../../tasApi';
import { useToastStore } from '../../toastStore';
import type { SessionSummary } from '../../tasTypes';

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const t = iso.includes('T') ? iso.split('T')[1] : iso;
  return t.substring(0, 5);
}

function formatScanTime(iso: string): string {
  const t = iso.includes('T') ? iso.split('T')[1] : iso;
  return t.substring(0, 5);
}

function minutesToHours(minutes: number): number {
  return Math.round(Math.floor(minutes / 30) / 2 * 10) / 10;
}

interface ReviewDetailViewProps {
  onBack: () => void;
}

export default function ReviewDetailView({ onBack }: ReviewDetailViewProps) {
  const resolvedRows = useTasStore(s => s.resolvedRows);
  const sessionSummaries = useTasStore(s => s.sessionSummaries);
  const selectedEmployee = useTasStore(s => s.reviewSelectedEmployee);
  const setSelectedEmployee = useTasStore(s => s.setReviewSelectedEmployee);
  const overtimeOverrides = useTasStore(s => s.overtimeOverrides);
  const setOvertimeOverride = useTasStore(s => s.setOvertimeOverride);
  const stashOvertimeOverrides = useTasStore(s => s.stashOvertimeOverrides);
  const restoreOvertimeOverrides = useTasStore(s => s.restoreOvertimeOverrides);
  const expandedScans = useTasStore(s => s.reviewExpandedScans);
  const toggleScanExpanded = useTasStore(s => s.toggleReviewScanExpanded);
  const setAllScansExpanded = useTasStore(s => s.setAllScansExpanded);
  const clearAllScansExpanded = useTasStore(s => s.clearAllScansExpanded);
  const uploadToken = useTasStore(s => s.uploadToken);
  const setResolvedRows = useTasStore(s => s.setResolvedRows);
  const setSessionSummaries = useTasStore(s => s.setSessionSummaries);

  const [pendingToggle, setPendingToggle] = useState(false);

  const currentIndex = resolvedRows.findIndex(r => r.codigoEmpleado === selectedEmployee);
  const row = resolvedRows[currentIndex];
  const sessions: SessionSummary[] = row ? (sessionSummaries[row.codigoEmpleado] ?? []) : [];

  useEffect(() => {
    if (row && sessions.length > 0) {
      setAllScansExpanded(sessions.map(s => `${row.codigoEmpleado}-${s.date}`));
    }
  }, [selectedEmployee, sessions.length]);

  if (!row) return null;

  const allExpanded = sessions.length > 0 && sessions.every(s => expandedScans.has(`${row.codigoEmpleado}-${s.date}`));

  const handleToggleAllScans = () => {
    if (allExpanded) {
      clearAllScansExpanded();
    } else {
      setAllScansExpanded(sessions.map(s => `${row.codigoEmpleado}-${s.date}`));
    }
  };

  const handleOvertimeChange = (field: 'horasExtrasSimples' | 'horasExtrasDobles', raw: string) => {
    const parsed = parseInt(raw, 10);
    const value = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setOvertimeOverride(row.codigoEmpleado, field, value);
  };

  const handleAccruesOvertimeToggle = async () => {
    if (!uploadToken) return;
    const newAccruesOvertime = !row.accruesOvertime;
    setPendingToggle(true);
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
      setPendingToggle(false);
    }
  };

  const override = overtimeOverrides[row.codigoEmpleado];
  const simplesValue = override?.horasExtrasSimples ?? row.horasExtrasSimples;
  const doblesValue = override?.horasExtrasDobles ?? row.horasExtrasDobles;

  const navigate = (direction: 'prev' | 'next') => {
    clearAllScansExpanded();
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < resolvedRows.length) {
      setSelectedEmployee(resolvedRows[newIndex].codigoEmpleado);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 bg-surface-container-lowest border-b border-outline-variant">
        <div className="flex items-center gap-3 px-6 py-3">
          <button onClick={onBack} className="text-body-md text-primary hover:text-primary/80">
            ← Volver a lista
          </button>
          <div className="flex-1">
            <span className="text-title-md font-medium text-on-surface">{row.nombreEmpleado}</span>
            <span className="text-body-md text-on-surface-variant ml-2">
              · {row.codigoEmpleado} · Q{row.numeroDequincena} {row.mes}/{row.anio}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('prev')}
              disabled={currentIndex <= 0}
              aria-label="Anterior"
              className="px-3 py-1 border border-outline-variant rounded-shape-md text-body-sm text-on-surface disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-container-low"
            >
              ← Anterior
            </button>
            <span className="text-body-sm text-on-surface-variant">{currentIndex + 1} de {resolvedRows.length}</span>
            <button
              onClick={() => navigate('next')}
              disabled={currentIndex >= resolvedRows.length - 1}
              aria-label="Siguiente"
              className="px-3 py-1 border border-outline-variant rounded-shape-md text-body-sm text-on-surface disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-container-low"
            >
              Siguiente →
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-title-sm font-medium text-on-surface">Sesiones</h3>
              {sessions.length > 0 && (
                <button
                  onClick={handleToggleAllScans}
                  className="text-label-sm text-primary hover:text-primary/80 underline"
                >
                  {allExpanded ? 'Colapsar marcaciones' : 'Expandir marcaciones'}
                </button>
              )}
            </div>

            <table className="w-full border-collapse bg-surface-container-lowest rounded-shape-md overflow-hidden shadow-sm">
              <thead>
                <tr className="border-b border-outline-variant">
                  <th className="w-8" />
                  <th className="text-left text-label-sm text-on-surface-variant py-2 px-3 font-medium">Fecha</th>
                  <th className="text-left text-label-sm text-on-surface-variant py-2 px-3 font-medium">Turno</th>
                  <th className="text-left text-label-sm text-on-surface-variant py-2 px-3 font-medium">Entrada</th>
                  <th className="text-left text-label-sm text-on-surface-variant py-2 px-3 font-medium">Salida</th>
                  <th className="text-right text-label-sm text-on-surface-variant py-2 px-3 font-medium">Hrs</th>
                  <th className="text-right text-label-sm text-on-surface-variant py-2 px-3 font-medium">Simp.</th>
                  <th className="text-right text-label-sm text-on-surface-variant py-2 px-3 font-medium">Dobl.</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-body-sm text-on-surface-variant italic">
                      Sin sesiones registradas.
                    </td>
                  </tr>
                )}
                {sessions.map((s, i) => {
                  const dateKey = `${row.codigoEmpleado}-${s.date}`;
                  const isExpanded = expandedScans.has(dateKey);
                  const scans = s.scans ?? [];
                  return (
                    <Fragment key={`${s.date}-${i}`}>
                      <tr className="border-b border-outline-variant last:border-b-0">
                        <td className="py-2 px-2 text-center">
                          {scans.length > 0 && (
                            <button
                              onClick={() => toggleScanExpanded(dateKey)}
                              aria-label={isExpanded ? `Ocultar marcaciones de ${s.date}` : `Ver marcaciones de ${s.date}`}
                              className="text-on-surface-variant hover:text-on-surface p-0.5"
                            >
                              {isExpanded ? '▼' : '▶'}
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-3 text-body-sm text-on-surface">{s.date}</td>
                        <td className="py-2 px-3 text-body-sm text-on-surface-variant">{s.shiftName ?? '—'}</td>
                        <td className="py-2 px-3 text-body-sm text-on-surface-variant">{formatTime(s.entryTime)}</td>
                        <td className="py-2 px-3 text-body-sm text-on-surface-variant">{formatTime(s.exitTime)}</td>
                        <td className="py-2 px-3 text-body-sm text-on-surface-variant text-right">{s.workedHours}</td>
                        <td className="py-2 px-3 text-body-sm text-on-surface-variant text-right">{minutesToHours(s.simplesMinutes)}</td>
                        <td className="py-2 px-3 text-body-sm text-on-surface-variant text-right">{minutesToHours(s.doblesMinutes)}</td>
                      </tr>
                      {isExpanded && scans.length > 0 && (
                        <tr className="bg-surface-container-low">
                          <td />
                          <td colSpan={7} className="py-1.5 px-3">
                            <span className="text-label-sm text-on-surface-variant mr-2">Marcaciones:</span>
                            {scans.map((scan, si) => (
                              <span
                                key={si}
                                className="inline-block bg-primary-container text-on-primary-container text-label-sm px-2 py-0.5 rounded-full mr-1.5 mb-0.5 font-mono"
                              >
                                {formatScanTime(scan)}
                              </span>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {sessions.length > 0 && (
                  <tr className="border-t-2 border-outline-variant bg-surface-container-low">
                    <td />
                    <td colSpan={4} className="py-2 px-3 text-body-sm font-medium text-on-surface text-right">
                      Totales quincena
                    </td>
                    <td className="py-2 px-3 text-body-sm font-medium text-on-surface text-right">
                      {sessions.reduce((sum, s) => sum + s.workedHours, 0)}
                    </td>
                    <td className="py-2 px-3 text-body-sm font-medium text-on-surface text-right">
                      {sessions.reduce((sum, s) => sum + minutesToHours(s.simplesMinutes), 0)}
                    </td>
                    <td className="py-2 px-3 text-body-sm font-medium text-on-surface text-right">
                      {sessions.reduce((sum, s) => sum + minutesToHours(s.doblesMinutes), 0)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="w-60 flex-shrink-0 space-y-4">
            <div className="border border-outline-variant rounded-shape-md p-4 bg-surface-container-lowest">
              <h4 className="text-label-lg text-on-surface font-medium mb-3">Ajuste de horas extra</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-label-sm text-on-surface-variant block mb-1">
                    Extras simples
                    <span className="text-label-sm text-on-surface-variant/60 ml-1">calculado: {row.horasExtrasSimples}</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={simplesValue}
                    onChange={e => handleOvertimeChange('horasExtrasSimples', e.target.value)}
                    className={`w-full text-right text-body-md border rounded-shape-sm px-3 py-1.5 focus:outline-none focus:border-primary transition-colors ${
                      override?.horasExtrasSimples !== undefined
                        ? 'bg-warning-container/40 border-warning font-medium'
                        : 'bg-surface-container-lowest border-outline-variant'
                    }`}
                  />
                </div>
                <div>
                  <label className="text-label-sm text-on-surface-variant block mb-1">
                    Extras dobles
                    <span className="text-label-sm text-on-surface-variant/60 ml-1">calculado: {row.horasExtrasDobles}</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={doblesValue}
                    onChange={e => handleOvertimeChange('horasExtrasDobles', e.target.value)}
                    className={`w-full text-right text-body-md border rounded-shape-sm px-3 py-1.5 focus:outline-none focus:border-primary transition-colors ${
                      override?.horasExtrasDobles !== undefined
                        ? 'bg-warning-container/40 border-warning font-medium'
                        : 'bg-surface-container-lowest border-outline-variant'
                    }`}
                  />
                </div>
              </div>
            </div>

            <div className="border border-outline-variant rounded-shape-md p-4 bg-surface-container-lowest">
              <h4 className="text-label-lg text-on-surface font-medium mb-3">Configuración</h4>
              <div className="flex items-center justify-between">
                <span className="text-body-sm text-on-surface-variant">Acumula horas extra</span>
                <button
                  role="switch"
                  aria-checked={row.accruesOvertime}
                  aria-label={row.accruesOvertime ? 'Desactivar acumulado de horas extra' : 'Activar acumulado de horas extra'}
                  onClick={handleAccruesOvertimeToggle}
                  disabled={pendingToggle}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    row.accruesOvertime ? 'bg-success' : 'bg-surface-container-high'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface-container-lowest transition-transform ${
                    row.accruesOvertime ? 'translate-x-4' : 'translate-x-1'
                  }`} />
                </button>
              </div>
              <div className="mt-2 text-body-sm text-on-surface-variant">
                Días no laborados: {row.diasNoLaborados}
              </div>
            </div>

            {row.diasTurnoEstimado > 0 && (
              <div className="border border-warning rounded-shape-md p-4 bg-warning-container/30">
                <h4 className="text-label-lg text-on-warning-container font-medium mb-1">Alertas</h4>
                <p className="text-body-sm text-on-warning-container">
                  {row.diasTurnoEstimado} día(s) con turno estimado
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
