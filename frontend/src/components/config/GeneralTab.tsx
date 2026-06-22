import { useEffect, useState } from 'react';
import { useConfigStore } from '../../configStore';
import { useToastStore } from '../../toastStore';
import { getGeneralConfig, updateGeneralConfig } from '../../configApi';
import Spinner from '../ui/Spinner';

const DEFAULT_BREAK = 45;
const DEFAULT_MAX_SPAN_HOURS = 14;

export default function GeneralTab() {
  const generalData = useConfigStore(s => s.general.data);
  const generalLoading = useConfigStore(s => s.general.loading);
  const generalDirty = useConfigStore(s => s.general.dirty);
  const generalError = useConfigStore(s => s.general.error);
  const setGeneralLoading = useConfigStore(s => s.setGeneralLoading);
  const setGeneralData = useConfigStore(s => s.setGeneralData);
  const setGeneralDirty = useConfigStore(s => s.setGeneralDirty);
  const setGeneralError = useConfigStore(s => s.setGeneralError);
  const showToast = useToastStore(s => s.showToast);

  const [breakMinutes, setBreakMinutes] = useState(DEFAULT_BREAK);
  const [maxSpanHours, setMaxSpanHours] = useState(DEFAULT_MAX_SPAN_HOURS);

  useEffect(() => {
    setGeneralLoading(true);
    getGeneralConfig()
      .then(data => {
        setGeneralData(data);
        setBreakMinutes(data.legalBreakAllowanceMinutes);
        setMaxSpanHours(Math.round(data.maxSessionSpanMinutes / 60));
      })
      .catch(() => setGeneralError('No se pudo cargar la configuración general.'))
      .finally(() => setGeneralLoading(false));
  }, [setGeneralLoading, setGeneralData, setGeneralError]);

  const handleSave = async () => {
    setGeneralLoading(true);
    setGeneralError(null);
    try {
      const updated = await updateGeneralConfig({
        legalBreakAllowanceMinutes: breakMinutes,
        maxSessionSpanMinutes: maxSpanHours * 60,
      });
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
    if (generalData) {
      setBreakMinutes(generalData.legalBreakAllowanceMinutes);
      setMaxSpanHours(Math.round(generalData.maxSessionSpanMinutes / 60));
    }
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
        <div className="cfg-error-banner">{generalError}</div>
      )}

      <div className="max-w-md">
        <label className="block text-label-lg font-medium text-on-surface mb-1">
          Tiempo de descanso no deducible
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={breakMinutes}
            onChange={e => { setBreakMinutes(Number(e.target.value)); setGeneralDirty(true); }}
            className="cfg-input w-24"
            aria-label="Tiempo de descanso no deducible en minutos"
          />
          <span className="text-body-sm text-on-surface-variant">minutos</span>
        </div>
        <p className="mt-1.5 text-label-sm text-on-surface-variant">
          Tiempo de descanso diario que no se descuenta de las horas trabajadas. Mandato legal: 15 min refacción + 30 min almuerzo.
        </p>
        <p className="mt-2 text-label-sm text-warning">
          Los cambios aplican a partir del próximo archivo subido.
        </p>
      </div>

      <div className="max-w-md mt-6">
        <label className="block text-label-lg font-medium text-on-surface mb-1">
          Duración máxima de jornada
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={24}
            value={maxSpanHours}
            onChange={e => { setMaxSpanHours(Number(e.target.value)); setGeneralDirty(true); }}
            className="cfg-input w-24"
            aria-label="Duración máxima de jornada en horas"
          />
          <span className="text-body-sm text-on-surface-variant">horas</span>
        </div>
        <p className="mt-1.5 text-label-sm text-on-surface-variant">
          Tiempo máximo entre entrada y salida que se considera una sola jornada. Scans con mayor separación se tratarán como sesiones distintas.
        </p>
        <p className="mt-2 text-label-sm text-warning">
          Los cambios aplican a partir del próximo archivo subido.
        </p>
      </div>

      <div className="cfg-footer">
        <button
          onClick={handleSave}
          disabled={!generalDirty || generalLoading}
          className="cfg-save-btn"
        >
          Guardar cambios
        </button>
        <button
          onClick={handleDiscard}
          disabled={!generalDirty}
          className="cfg-discard-btn"
        >
          Descartar
        </button>
      </div>
    </div>
  );
}
