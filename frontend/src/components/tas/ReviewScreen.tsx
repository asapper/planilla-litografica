import { useTasStore } from '../../tasStore';
import { submitTas } from '../../tasApi';

export default function ReviewScreen() {
  const uploadToken  = useTasStore(s => s.uploadToken);
  const resolvedRows = useTasStore(s => s.resolvedRows);
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
