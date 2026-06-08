import { useEffect, useState } from 'react';
import { useConfigStore } from '../../configStore';
import { getGeneralConfig, updateGeneralConfig } from '../../configApi';
import Spinner from '../ui/Spinner';

const DEFAULT_BREAK = 45;

export default function GeneralTab() {
  const generalData = useConfigStore(s => s.general.data);
  const generalLoading = useConfigStore(s => s.general.loading);
  const generalDirty = useConfigStore(s => s.general.dirty);
  const generalError = useConfigStore(s => s.general.error);
  const setGeneralLoading = useConfigStore(s => s.setGeneralLoading);
  const setGeneralData = useConfigStore(s => s.setGeneralData);
  const setGeneralDirty = useConfigStore(s => s.setGeneralDirty);
  const setGeneralError = useConfigStore(s => s.setGeneralError);
  const showToast = useConfigStore(s => s.showToast);

  const [breakMinutes, setBreakMinutes] = useState(DEFAULT_BREAK);

  useEffect(() => {
    setGeneralLoading(true);
    getGeneralConfig()
      .then(data => {
        setGeneralData(data);
        setBreakMinutes(data.legalBreakAllowanceMinutes);
      })
      .catch(() => setGeneralError('No se pudo cargar la configuración general.'))
      .finally(() => setGeneralLoading(false));
  }, [setGeneralLoading, setGeneralData, setGeneralError]);

  const handleChange = (val: number) => {
    setBreakMinutes(val);
    setGeneralDirty(true);
  };

  const handleSave = async () => {
    setGeneralLoading(true);
    setGeneralError(null);
    try {
      const updated = await updateGeneralConfig({ legalBreakAllowanceMinutes: breakMinutes });
      setGeneralData(updated);
      setGeneralDirty(false);
      showToast('Cambios guardados');
    } catch {
      setGeneralError('No se pudieron guardar los cambios.');
    } finally {
      setGeneralLoading(false);
    }
  };

  const handleDiscard = () => {
    if (generalData) setBreakMinutes(generalData.legalBreakAllowanceMinutes);
    setGeneralDirty(false);
  };

  if (generalLoading && !generalData) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="w-6 h-6" />
      </div>
    );
  }

  return (
    <div>
      {generalError && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {generalError}
        </div>
      )}

      <div className="max-w-md">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Tiempo de descanso no deducible
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={breakMinutes}
            onChange={e => handleChange(Number(e.target.value))}
            className="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            aria-label="Tiempo de descanso no deducible en minutos"
          />
          <span className="text-sm text-gray-600">minutos</span>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          Tiempo de descanso diario que no se descuenta de las horas trabajadas. Mandato legal: 15 min refacción + 30 min almuerzo.
        </p>
        <p className="mt-2 text-xs text-amber-600">
          Los cambios aplican a partir del próximo archivo subido.
        </p>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={!generalDirty || generalLoading}
          className="px-5 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Guardar cambios
        </button>
        <button
          onClick={handleDiscard}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Descartar
        </button>
      </div>
    </div>
  );
}
