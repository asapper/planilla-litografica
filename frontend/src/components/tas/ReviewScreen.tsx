import { useTasStore } from '../../tasStore';
import { submitTas, recomputeTas } from '../../tasApi';
import { updateAccruesOvertime } from '../../configApi';
import type { ResolvedRow } from '../../tasTypes';

export default function ReviewScreen() {
  const uploadToken  = useTasStore(s => s.uploadToken);
  const resolvedRows = useTasStore(s => s.resolvedRows);
  const setResolvedRows = useTasStore(s => s.setResolvedRows);
  const setTasView   = useTasStore(s => s.setTasView);
  const setJobId     = useTasStore(s => s.setJobId);
  const setError     = useTasStore(s => s.setError);

  const handleSubmit = async () => {
    if (!uploadToken) return;
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
    const newAccruesOvertime = !row.accruesOvertime;
    try {
      await updateAccruesOvertime(row.codigoEmpleado, newAccruesOvertime);
    } catch {
      setError('No se pudo actualizar el acumulado de horas extra del empleado.');
      return;
    }
    try {
      const result = await recomputeTas(uploadToken);
      setResolvedRows(result.resolvedRows);
    } catch {
      setError('La sesión de carga expiró. Vuelve a subir el archivo.');
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div className="flex-1 overflow-auto px-6 py-6">
        <h2 className="text-headline-sm font-medium text-on-surface mb-2">
          Revisión de registros procesados
        </h2>
        <p className="text-body-md text-on-surface-variant mb-6">
          {resolvedRows.length === 1
            ? 'Se procesó 1 registro. Revisa la información antes de enviar.'
            : `Se procesaron ${resolvedRows.length} registros. Revisa la información antes de enviar.`}
        </p>

        <table className="w-full border-collapse bg-white rounded-shape-md overflow-hidden shadow-sm">
          <thead>
            <tr className="border-b border-outline-variant">
              <th className="text-left text-label-lg text-on-surface-variant py-2 px-4">Empleado</th>
              <th className="text-left text-label-lg text-on-surface-variant py-2 px-4">Código</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Días no laborados</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Horas extras simples</th>
              <th className="text-right text-label-lg text-on-surface-variant py-2 px-4">Horas extras dobles</th>
              <th className="text-center text-label-lg text-on-surface-variant py-2 px-4">Acumula horas extra</th>
            </tr>
          </thead>
          <tbody>
            {resolvedRows.map(row => (
              <tr key={`${row.codigoEmpleado}-${row.anio}-${row.mes}-${row.numeroDequincena}`} className="border-b border-outline-variant last:border-b-0">
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
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
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
            ))}
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
