import { useStore } from '../store';
import { MONTH_NAMES } from '../types';
import type { MonthOption } from '../types';

export default function QuincenaBanner() {
  const selectedQuincena = useStore(s => s.selectedQuincena);
  const setQuincena      = useStore(s => s.setQuincena);
  const selectedMonth    = useStore(s => s.selectedMonth);
  const setMonth         = useStore(s => s.setMonth);
  const monthOptions     = useStore(s => s.monthOptions);
  const multiMonth       = useStore(s => s.multiMonth);

  const monthLabel = (m: MonthOption) => `${MONTH_NAMES[m.mes]} ${m.anio}`;
  const isComplete = selectedQuincena !== null && (!multiMonth || selectedMonth !== null);

  return (
    <div className={`
      rounded-shape-md border px-5 py-4 mb-4 flex flex-wrap items-center gap-4
      ${isComplete
        ? 'bg-secondary-container border-transparent'
        : 'bg-warning-container border-transparent'}
    `}>
      {/* Leading icon */}
      <svg
        className={`w-5 h-5 shrink-0 ${isComplete ? 'text-on-secondary-container' : 'text-on-warning-container'}`}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      >
        {isComplete
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        }
      </svg>

      <span className={`text-label-lg shrink-0 ${isComplete ? 'text-on-secondary-container' : 'text-on-warning-container'}`}>
        {isComplete ? 'Período seleccionado' : 'Selecciona la quincena para esta carga'}
      </span>

      <div className="flex flex-wrap gap-3 items-center ml-auto">
        {/* Quincena toggle */}
        <div className="flex gap-1">
          {[1, 2].map(q => (
            <button
              key={q}
              onClick={() => setQuincena(q)}
              className={`m3-chip ${selectedQuincena === q ? 'm3-chip-selected' : ''}`}
            >
              Quincena {q}
            </button>
          ))}
        </div>

        {/* Month: read-only or selector */}
        {multiMonth ? (
          <div className="flex gap-1">
            {monthOptions.map(m => (
              <button
                key={`${m.mes}-${m.anio}`}
                onClick={() => setMonth(m)}
                className={`m3-chip ${
                  selectedMonth?.mes === m.mes && selectedMonth?.anio === m.anio
                    ? 'm3-chip-selected'
                    : ''
                }`}
              >
                {monthLabel(m)}
              </button>
            ))}
          </div>
        ) : (
          <span className="m3-chip m3-chip-selected pointer-events-none">
            {selectedMonth ? monthLabel(selectedMonth) : '—'}
          </span>
        )}
      </div>
    </div>
  );
}
