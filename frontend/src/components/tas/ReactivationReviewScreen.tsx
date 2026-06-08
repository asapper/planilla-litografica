import { useTasStore } from '../../tasStore';
import { submitInactiveReview, submitTas } from '../../tasApi';
import type { InactiveDecision } from '../../tasTypes';

export default function ReactivationReviewScreen() {
  const uploadToken        = useTasStore(s => s.uploadToken);
  const inactiveEmployees  = useTasStore(s => s.inactiveEmployees);
  const inactiveDecisions  = useTasStore(s => s.inactiveDecisions);
  const setInactiveDecision = useTasStore(s => s.setInactiveDecision);
  const setTasView         = useTasStore(s => s.setTasView);
  const setFlaggedSessions = useTasStore(s => s.setFlaggedSessions);
  const setUploadToken     = useTasStore(s => s.setUploadToken);
  const setInactiveEmployees = useTasStore(s => s.setInactiveEmployees);
  const setAbsentEmployees = useTasStore(s => s.setAbsentEmployees);
  const setUsedFallbackHolidays = useTasStore(s => s.setUsedFallbackHolidays);
  const setJobId           = useTasStore(s => s.setJobId);
  const setError           = useTasStore(s => s.setError);

  const getDecision = (employeeId: string): InactiveDecision =>
    inactiveDecisions[employeeId] ?? 'ignore';

  const handleContinue = async () => {
    if (!uploadToken) return;
    try {
      const reactivate = inactiveEmployees
        .filter(e => getDecision(e.employeeId) === 'reactivate')
        .map(e => e.employeeId);
      const ignore = inactiveEmployees
        .filter(e => getDecision(e.employeeId) === 'ignore')
        .map(e => e.employeeId);

      const result = await submitInactiveReview(uploadToken, reactivate, ignore);
      setUploadToken(result.uploadToken);
      setFlaggedSessions(result.flaggedSessions);
      setInactiveEmployees(result.inactiveEmployeesFound);
      setAbsentEmployees(result.absentActiveEmployees);
      setUsedFallbackHolidays(result.usedFallbackHolidays);

      const hasNeedsResolution = result.flaggedSessions.some(s => s.needsResolution);
      if (hasNeedsResolution) {
        setTasView('verification');
      } else {
        setTasView('submitting');
        const { jobId } = await submitTas(result.uploadToken);
        setJobId(jobId);
        setTasView('result');
      }
    } catch {
      setTasView('inactiveReview');
      setError('Ocurrió un error al continuar. Intente nuevamente.');
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-white overflow-auto" style={{ paddingTop: 64 }}>
      <div className="flex-1 px-6 py-8 max-w-3xl mx-auto w-full">
        <h2 className="text-headline-sm font-medium text-on-surface mb-2">
          Empleados inactivos detectados
        </h2>
        <p className="text-body-md text-on-surface-variant mb-6">
          Los siguientes empleados están marcados como inactivos pero aparecen en el archivo.
          Decide qué hacer con cada uno.
        </p>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-outline-variant">
              <th className="text-left text-label-lg text-on-surface-variant py-2 pr-4">Nombre</th>
              <th className="text-left text-label-lg text-on-surface-variant py-2 pr-4">ID</th>
              <th className="text-left text-label-lg text-on-surface-variant py-2 pr-4">Sesiones</th>
              <th className="text-left text-label-lg text-on-surface-variant py-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            {inactiveEmployees.map(emp => {
              const decision = getDecision(emp.employeeId);
              return (
                <tr key={emp.employeeId} className="border-b border-outline-variant">
                  <td className="py-3 pr-4 text-body-md text-on-surface">{emp.name}</td>
                  <td className="py-3 pr-4 text-body-md text-on-surface-variant">{emp.employeeId}</td>
                  <td className="py-3 pr-4 text-body-md text-on-surface-variant">{emp.sessionCount} sesiones</td>
                  <td className="py-3">
                    <div className="inline-flex rounded-full overflow-hidden border border-outline-variant">
                      <button
                        onClick={() => setInactiveDecision(emp.employeeId, 'reactivate')}
                        className={`px-3 py-1 text-label-md font-medium transition-colors cursor-pointer ${
                          decision === 'reactivate'
                            ? 'bg-green-600 text-white'
                            : 'bg-white text-on-surface-variant hover:bg-surface-container-low'
                        }`}
                      >
                        Reactivar y enviar
                      </button>
                      <button
                        onClick={() => setInactiveDecision(emp.employeeId, 'ignore')}
                        className={`px-3 py-1 text-label-md font-medium transition-colors cursor-pointer ${
                          decision === 'ignore'
                            ? 'bg-surface-container text-on-surface'
                            : 'bg-white text-on-surface-variant hover:bg-surface-container-low'
                        }`}
                      >
                        Ignorar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-outline-variant px-6 py-4 flex justify-end">
        <button
          onClick={handleContinue}
          className="m3-btn-filled"
        >
          Continuar →
        </button>
      </div>
    </div>
  );
}
