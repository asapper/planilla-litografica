import { useStore } from '../store';
import {
  mockRows, mockRowsMultiMonth,
  mockValidationWithErrors, mockValidationWithDuplicates,
  mockSubmitSuccess, mockSubmitPartial, mockSubmitFailure,
} from './mockData';

const STATES = [
  { key: 'empty',             label: '1 · Vacía' },
  { key: 'loaded-single',     label: '2 · Cargado (1 mes)' },
  { key: 'loaded-multi',      label: '3 · Cargado (2 meses)' },
  { key: 'validation-errors', label: '4 · Errores' },
  { key: 'duplicates',        label: '5 · Duplicados' },
  { key: 'submitting',        label: '6 · Enviando' },
  { key: 'result-success',    label: '7 · Éxito' },
  { key: 'result-partial',    label: '8 · Parcial' },
  { key: 'result-failure',    label: '9 · Error total' },
] as const;

type StateKey = typeof STATES[number]['key'];

export default function PreviewPanel() {
  const store = useStore();

  const load = (key: StateKey) => {
    switch (key) {
      case 'empty':
        store.reset(); break;
      case 'loaded-single':
        store.setLoaded(mockRows, [{ mes: 12, anio: 2025 }], false, []);
        store.setQuincena(2); break;
      case 'loaded-multi':
        store.setLoaded(mockRowsMultiMonth, [{ mes: 11, anio: 2025 }, { mes: 12, anio: 2025 }], true, []);
        store.setQuincena(2); break;
      case 'validation-errors':
        store.setLoaded(mockRows, [{ mes: 12, anio: 2025 }], false, []);
        store.setQuincena(2);
        store.setValidation(mockValidationWithErrors); break;
      case 'duplicates':
        store.setLoaded(mockRows, [{ mes: 12, anio: 2025 }], false, []);
        store.setQuincena(2);
        store.setValidation(mockValidationWithDuplicates); break;
      case 'submitting':
        store.setLoaded(mockRows, [{ mes: 12, anio: 2025 }], false, []);
        store.setQuincena(2);
        store.setSubmitting(); break;
      case 'result-success':
        store.setLoaded(mockRows, [{ mes: 12, anio: 2025 }], false, []);
        store.setResult(mockSubmitSuccess); break;
      case 'result-partial':
        store.setLoaded(mockRows, [{ mes: 12, anio: 2025 }], false, []);
        store.setResult(mockSubmitPartial); break;
      case 'result-failure':
        store.setLoaded(mockRows, [{ mes: 12, anio: 2025 }], false, []);
        store.setResult(mockSubmitFailure); break;
    }
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center gap-2 px-3 overflow-x-auto"
      style={{ height: 44, backgroundColor: '#1e1b4b', borderBottom: '1px solid #312e81' }}
    >
      <span className="text-label-sm shrink-0 mr-1" style={{ color: '#a5b4fc' }}>
        Nico ·
      </span>
      {STATES.map(s => (
        <button
          key={s.key}
          onClick={() => load(s.key)}
          className="shrink-0 text-label-sm px-3 py-1 rounded-shape-sm cursor-pointer border-0 transition-colors"
          style={{
            backgroundColor: '#312e81',
            color: '#e0e7ff',
            border: '1px solid #4338ca',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#4338ca')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#312e81')}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
