import { Fragment, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useTasStore } from '../../tasStore';
import { submitTas, recomputeTas } from '../../tasApi';
import { updateAccruesOvertime } from '../../configApi';
import AlertMessage from '../ui/AlertMessage';
import type { ResolvedRow, SessionSummary } from '../../tasTypes';

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const t = iso.includes('T') ? iso.split('T')[1] : iso;
  return t.substring(0, 5);
}

function minutesToHours(minutes: number): number {
  return Math.round(Math.floor(minutes / 30) / 2 * 10) / 10;
}

function SessionDetailRows({ sessions }: { sessions: SessionSummary[] }) {
  if (sessions.length === 0) {
    return (
      <tr>
        <td colSpan={8} className="py-2 px-8 text-body-sm text-on-surface-variant italic">
          Sin sesiones registradas.
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={8} className="p-0">
        <table className="w-full border-collapse bg-gray-50">
          <thead>
            <tr>
              <th className="py-1 px-4 text-left text-label-sm text-on-surface-variant font-medium">Fecha</th>
              <th className="py-1 px-4 text-left text-label-sm text-on-surface-variant font-medium">Turno</th>
              <th className="py-1 px-4 text-left text-label-sm text-on-surface-variant font-medium">Entrada</th>
              <th className="py-1 px-4 text-left text-label-sm text-on-surface-variant font-medium">Salida</th>
              <th className="py-1 px-4 text-right text-label-sm text-on-surface-variant font-medium">Horas trabajadas</th>
              <th className="py-1 px-4 text-right text-label-sm text-on-surface-variant font-medium">Extras simples</th>
              <th className="py-1 px-4 text-right text-label-sm text-on-surface-variant font-medium">Extras dobles</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => (
              <tr key={`${s.date}-${i}`} className="border-t border-gray-100">
                <td className="py-1.5 px-4 text-body-sm text-on-surface-variant">{s.date}</td>
                <td className="py-1.5 px-4 text-body-sm text-on-surface-variant">{s.shiftName ?? '—'}</td>
                <td className="py-1.5 px-4 text-body-sm text-on-surface-variant">{formatTime(s.entryTime)}</td>
                <td className="py-1.5 px-4 text-body-sm text-on-surface-variant">{formatTime(s.exitTime)}</td>
                <td className="py-1.5 px-4 text-body-sm text-on-surface-variant text-right">{s.workedHours}</td>
                <td className="py-1.5 px-4 text-body-sm text-on-surface-variant text-right">{minutesToHours(s.simplesMinutes)}</td>
                <td className="py-1.5 px-4 text-body-sm text-on-surface-variant text-right">{minutesToHours(s.doblesMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

export default function ReviewScreen() {
  const uploadToken  = useTasStore(s => s.uploadToken);
  const resolvedRows = useTasStore(s => s.resolvedRows);
  const setResolvedRows = useTasStore(s => s.setResolvedRows);
  const sessionSummaries = useTasStore(s => s.sessionSummaries);
  const setSessionSummaries = useTasStore(s => s.setSessionSummaries);
  const setTasView   = useTasStore(s => s.setTasView);
  const setJobId     = useTasStore(s => s.setJobId);
  const error        = useTasStore(s => s.error);
  const setError     = useTasStore(s => s.setError);
  const overtimeOverrides = useTasStore(s => s.overtimeOverrides);
  const setOvertimeOverride = useTasStore(s => s.setOvertimeOverride);
  const stashOvertimeOverrides = useTasStore(s => s.stashOvertimeOverrides);
  const restoreOvertimeOverrides = useTasStore(s => s.restoreOvertimeOverrides);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, []);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!uploadToken) return;
    setError(null);
    try {
      setTasView('submitting');
      const { jobId } = await submitTas(uploadToken, overtimeOverrides);
      setJobId(jobId);
      setTasView('result');
    } catch (err) {
      setTasView('review');
      const msg = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Ocurrió un error al enviar. Intente nuevamente.';
      setError(msg);
    }
  };

  const handleAccruesOvertimeToggle = async (row: ResolvedRow) => {
    if (!uploadToken) return;
    setError(null);
    const newAccruesOvertime = !row.accruesOvertime;
    setPendingToggleId(row.codigoEmpleado);
    try {
      try {
        await updateAccruesOvertime(row.codigoEmpleado, newAccruesOvertime);
      } catch {
        setError('No se pudo actualizar el acumulado de horas extra del empleado.');
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
        setError('La sesión de carga expiró. Vuelve a subir el archivo.');
      }
    } finally {
      setPendingToggleId(null);
    }
  };

  const handleOvertimeChange = (codigoEmpleado: string, field: 'horasExtrasSimples' | 'horasExtrasDobles', raw: string) => {
    const parsed = parseInt(raw, 10);
    const value = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setOvertimeOverride(codigoEmpleado, field, value);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-6">
        <h2 className="text-headline-sm font-medium text-on-surface mb-2">
          Revisión de registros procesados
        </h2>

        {error && <AlertMessage message={error} />}

        <p className="text-body-md text-on-surface-variant mb-6">
          {resolvedRows.length === 1
            ? 'Se procesó 1 registro. Revisa la información antes de enviar.'
            : `Se procesaron ${resolvedRows.length} registros. Revisa la información antes de enviar.`}
        </p>

        <table className="w-full border-collapse bg-white rounded-shape-md overflow-hidden shadow-sm">
          <thead>
            <tr className="border-b border-outline-variant">
              <th className="w-10" />
              <th className="text-left text-label-lg text-on-surface-variant py-2 px-4">Empleado</th>
              <th className="text-left text-label-lg text-on-surface-variant py-2 px-4">Código</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Días no laborados</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Horas extras simples</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Horas extras dobles</th>
              <th className="text-center text-label-lg text-on-surface-variant py-2 px-4">Acumula horas extra</th>
            </tr>
          </thead>
          <tbody>
            {resolvedRows.map(row => {
              const isExpanded = expandedIds.has(row.codigoEmpleado);
              const sessions = sessionSummaries[row.codigoEmpleado] ?? [];
              return (
                <Fragment key={`${row.codigoEmpleado}-${row.anio}-${row.mes}-${row.numeroDequincena}`}>
                  <tr className="border-b border-outline-variant last:border-b-0">
                    <td className="py-3 px-2 text-center">
                      <button
                        onClick={() => toggleExpanded(row.codigoEmpleado)}
                        aria-label={isExpanded ? `Ocultar detalles de ${row.nombreEmpleado}` : `Ver detalles de ${row.nombreEmpleado}`}
                        className="text-on-surface-variant hover:text-on-surface p-1"
                      >
                        {isExpanded ? '▼' : '▶'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-body-md text-on-surface">
                      {row.nombreEmpleado}
                      {row.diasTurnoEstimado > 0 && (
                        <span
                          title={`${row.diasTurnoEstimado} día(s) en que las marcaciones no cayeron dentro de la ventana de detección de ningún turno. Se asignó el turno más cercano automáticamente y las horas se calcularon con base en las marcaciones reales.`}
                          className="ml-2 text-label-sm px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                        >
                          {row.diasTurnoEstimado} turno estimado
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-body-md text-on-surface-variant">{row.codigoEmpleado}</td>
                    <td className="py-3 px-4 text-body-md text-on-surface-variant text-right">{row.diasNoLaborados}</td>
                    {(['horasExtrasSimples', 'horasExtrasDobles'] as const).map(field => {
                      const override = overtimeOverrides[row.codigoEmpleado]?.[field];
                      const isOverridden = override !== undefined;
                      return (
                        <td key={field} className={`py-3 px-4 text-right ${isOverridden ? 'bg-amber-50' : ''}`}>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={override ?? row[field]}
                            onChange={e => handleOvertimeChange(row.codigoEmpleado, field, e.target.value)}
                            className={`w-16 text-right text-body-md border-b focus:border-primary focus:outline-none transition-colors ${
                              isOverridden
                                ? 'bg-amber-50 border-amber-300 text-amber-900 font-medium'
                                : 'bg-transparent border-outline-variant text-on-surface-variant'
                            }`}
                          />
                          {isOverridden && (
                            <div className="text-label-sm text-on-surface-variant mt-0.5">
                              {row[field] === 1 ? 'era' : 'eran'} {row[field]}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-3 px-4 text-center">
                      <button
                        role="switch"
                        aria-checked={row.accruesOvertime}
                        aria-label={row.accruesOvertime ? `Desactivar acumulado de horas extra de ${row.nombreEmpleado}` : `Activar acumulado de horas extra de ${row.nombreEmpleado}`}
                        onClick={() => handleAccruesOvertimeToggle(row)}
                        disabled={pendingToggleId !== null}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          row.accruesOvertime ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            row.accruesOvertime ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                  {isExpanded && <SessionDetailRows sessions={sessions} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-outline-variant px-6 py-4 flex justify-end">
        <button onClick={handleSubmit} className="m3-btn-filled">
          Enviar
        </button>
      </div>
    </div>
  );
}
