import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTasStore } from '../../tasStore';
import { submitInactiveReview } from '../../tasApi';
import { matchesSearch } from '../../textSearch';
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
  const setAvailablePeriods = useTasStore(s => s.setAvailablePeriods);
  const setAvailableShifts = useTasStore(s => s.setAvailableShifts);
  const setResolvedRowCount = useTasStore(s => s.setResolvedRowCount);
  const setResolvedRows    = useTasStore(s => s.setResolvedRows);
  const setSessionSummaries = useTasStore(s => s.setSessionSummaries);
  const setError           = useTasStore(s => s.setError);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, []);

  const [search, setSearch] = useState('');

  const filteredEmployees = search.trim()
    ? inactiveEmployees.filter(e =>
        matchesSearch(e.name, search) || matchesSearch(e.employeeId, search))
    : inactiveEmployees;

  const tableRef = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || inactiveEmployees.length === 0) return;
    const ths = table.querySelectorAll<HTMLElement>('thead th');
    ths.forEach(th => { th.style.minWidth = `${th.getBoundingClientRect().width}px`; });
  }, [inactiveEmployees]);

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
      setResolvedRowCount(result.resolvedRows?.length ?? 0);
      setInactiveEmployees(result.inactiveEmployeesFound);
      setAbsentEmployees(result.absentActiveEmployees);
      setUsedFallbackHolidays(result.usedFallbackHolidays);
      setAvailablePeriods(result.availablePeriods ?? []);
      setAvailableShifts(result.availableShifts ?? []);

      setResolvedRows(result.resolvedRows ?? []);
      setSessionSummaries(result.sessionSummaries ?? {});
      const hasNeedsResolution = result.flaggedSessions.some(s => s.needsResolution);
      const hasMultiplePeriods = (result.availablePeriods?.length ?? 0) > 1;
      setTasView(hasNeedsResolution || hasMultiplePeriods ? 'verification' : 'review');
    } catch {
      setTasView('inactiveReview');
      setError('Ocurrió un error al continuar. Intente nuevamente.');
    }
  };

  return (
    <div ref={scrollRef} className="fixed inset-0 flex flex-col bg-surface-container-lowest overflow-auto" style={{ paddingTop: 64 }}>
      <div className="flex-1 px-6 py-8 max-w-3xl mx-auto w-full">
        <h2 className="text-headline-sm font-medium text-on-surface mb-2">
          Empleados inactivos detectados
        </h2>
        <p className="text-body-md text-on-surface-variant mb-6">
          Los siguientes empleados están marcados como inactivos pero aparecen en el archivo.
          Decide qué hacer con cada uno.
        </p>

        <div className="relative mb-4 w-72">
          <input
            type="text"
            placeholder="Buscar por nombre o ID"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Buscar empleado"
            className="w-full border border-outline-variant rounded-shape-md px-3 py-2 pr-8 text-body-md text-on-surface bg-surface-container-lowest focus:outline-none focus:border-primary transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface text-body-lg leading-none"
            >
              ✕
            </button>
          )}
        </div>

        <table ref={tableRef} className="w-full border-collapse">
          <thead>
            <tr className="border-b border-outline-variant">
              <th className="text-left text-label-lg text-on-surface-variant py-2 pr-4">Nombre</th>
              <th className="text-left text-label-lg text-on-surface-variant py-2 pr-4">ID</th>
              <th className="text-left text-label-lg text-on-surface-variant py-2 pr-4">Sesiones</th>
              <th className="text-left text-label-lg text-on-surface-variant py-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.length === 0 && search.trim() && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-body-md text-on-surface-variant">
                  No se encontraron empleados que coincidan con la búsqueda.
                </td>
              </tr>
            )}
            {filteredEmployees.map(emp => {
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
                            ? 'bg-success text-on-success'
                            : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
                        }`}
                      >
                        Reactivar y enviar
                      </button>
                      <button
                        onClick={() => setInactiveDecision(emp.employeeId, 'ignore')}
                        className={`px-3 py-1 text-label-md font-medium transition-colors cursor-pointer ${
                          decision === 'ignore'
                            ? 'bg-secondary text-on-secondary'
                            : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
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

      <div className="sticky bottom-0 bg-surface-container-lowest border-t border-outline-variant px-6 py-4 flex justify-end">
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
