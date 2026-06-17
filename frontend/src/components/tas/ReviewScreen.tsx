import { Fragment, useState } from 'react';
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

function SessionDetailRows({ sessions }: { sessions: SessionSummary[] }) {
  if (sessions.length === 0) {
    return (
      <tr>
        <td colSpan={7} className="py-2 px-8 text-body-sm text-on-surface-variant italic">
          Sin sesiones registradas.
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={7} className="p-0">
        <table className="w-full border-collapse bg-gray-50">
          <thead>
            <tr>
              <th className="py-1 px-4 text-left text-label-sm text-on-surface-variant font-medium">Fecha</th>
              <th className="py-1 px-4 text-left text-label-sm text-on-surface-variant font-medium">Turno</th>
              <th className="py-1 px-4 text-left text-label-sm text-on-surface-variant font-medium">Entrada</th>
              <th className="py-1 px-4 text-left text-label-sm text-on-surface-variant font-medium">Salida</th>
              <th className="py-1 px-4 text-right text-label-sm text-on-surface-variant font-medium">Horas trabajadas</th>
              <th className="py-1 px-4 text-right text-label-sm text-on-surface-variant font-medium">Extras simples (min)</th>
              <th className="py-1 px-4 text-right text-label-sm text-on-surface-variant font-medium">Extras dobles (min)</th>
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
                <td className="py-1.5 px-4 text-body-sm text-on-surface-variant text-right">{s.simplesMinutes}</td>
                <td className="py-1.5 px-4 text-body-sm text-on-surface-variant text-right">{s.doblesMinutes}</td>
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
      const { jobId } = await submitTas(uploadToken);
      setJobId(jobId);
      setTasView('result');
    } catch {
      setTasView('review');
      setError('Ocurrió un error al enviar. Intente nuevamente.');
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
      } catch {
        setError('La sesión de carga expiró. Vuelve a subir el archivo.');
      }
    } finally {
      setPendingToggleId(null);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div className="flex-1 overflow-auto px-6 py-6">
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
                      {row.diasTurnoAmbiguo > 0 && (
                        <span
                          title={`${row.diasTurnoAmbiguo} día(s) en que las marcaciones no coincidieron con ningún turno configurado. Se calcularon con base en las marcaciones reales (turno de 8h por defecto).`}
                          className="ml-2 text-label-sm px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                        >
                          {row.diasTurnoAmbiguo} sin turno
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-body-md text-on-surface-variant">{row.codigoEmpleado}</td>
                    <td className="py-3 px-4 text-body-md text-on-surface-variant text-right">{row.diasNoLaborados}</td>
                    <td className="py-3 px-4 text-body-md text-on-surface-variant text-right">{row.horasExtrasSimples}</td>
                    <td className="py-3 px-4 text-body-md text-on-surface-variant text-right">{row.horasExtrasDobles}</td>
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
