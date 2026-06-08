import { useTasStore } from '../../tasStore';
import { deactivateAbsentEmployees } from '../../tasApi';

export default function AbsentReviewOverlay() {
  const uploadToken     = useTasStore(s => s.uploadToken);
  const absentEmployees = useTasStore(s => s.absentEmployees);
  const setAbsentEmployees = useTasStore(s => s.setAbsentEmployees);
  const setTasView      = useTasStore(s => s.setTasView);

  const handleToggle = async (employeeId: string) => {
    if (!uploadToken) return;
    await deactivateAbsentEmployees(uploadToken, [employeeId]);
    setAbsentEmployees(absentEmployees.filter(e => e.employeeId !== employeeId));
  };

  const handleClose = () => {
    setTasView('result');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.8)' }}>
      <div className="bg-white rounded-shape-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-6 py-5 border-b border-outline-variant">
          <h2 className="text-headline-sm font-medium text-on-surface mb-1">
            Empleados sin marcaciones
          </h2>
          <p className="text-body-md text-on-surface-variant">
            Estos empleados activos no aparecieron en el archivo de este período.
            Puede marcarlos como inactivos si ya no trabajan en la empresa.
          </p>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-outline-variant">
                <th className="text-left text-label-lg text-on-surface-variant py-2 pr-4">Nombre</th>
                <th className="text-left text-label-lg text-on-surface-variant py-2 pr-4">ID</th>
                <th className="text-left text-label-lg text-on-surface-variant py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {absentEmployees.map(emp => (
                <tr key={emp.employeeId} className="border-b border-outline-variant">
                  <td className="py-3 pr-4 text-body-md text-on-surface">{emp.name}</td>
                  <td className="py-3 pr-4 text-body-md text-on-surface-variant">{emp.employeeId}</td>
                  <td className="py-3">
                    <button
                      onClick={() => handleToggle(emp.employeeId)}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-400 text-green-700 text-label-sm hover:bg-green-50 transition-colors cursor-pointer"
                      aria-label={`Desactivar ${emp.name}`}
                    >
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      Activo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-outline-variant flex justify-end">
          <button onClick={handleClose} className="m3-btn-outlined">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
