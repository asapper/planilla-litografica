import { useTasStore } from '../../tasStore';
import ScreenLayout from '../ui/ScreenLayout';
import IconBadge from '../ui/IconBadge';

export default function TasResultScreen() {
  const resolvedRowCount = useTasStore(s => s.resolvedRowCount);
  const absentEmployees  = useTasStore(s => s.absentEmployees);
  const resetTas         = useTasStore(s => s.resetTas);
  const setTasView       = useTasStore(s => s.setTasView);

  const handleReviewAbsent = () => {
    setTasView('absentReview');
  };

  return (
    <ScreenLayout maxWidth="max-w-lg" centerText>
      <IconBadge bg="bg-primary-container" color="text-on-primary-container">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </IconBadge>

      <h2 className="text-headline-sm font-medium text-on-surface mb-3">Carga completada</h2>
      <p className="text-body-md text-on-surface-variant mb-6">
        {resolvedRowCount === 1
          ? 'Se envió 1 registro.'
          : `Se enviaron ${resolvedRowCount} registros.`}
      </p>

      {absentEmployees.length > 0 && (
        <p className="text-body-md text-on-surface-variant mb-6">
          {absentEmployees.length} empleado{absentEmployees.length !== 1 ? 's' : ''} activo
          {absentEmployees.length !== 1 ? 's' : ''} no {absentEmployees.length !== 1 ? 'tuvieron' : 'tuvo'} marcaciones en este período.
        </p>
      )}

      {absentEmployees.length > 0 && (
        <button
          className="m3-btn-filled w-full mb-3"
          onClick={handleReviewAbsent}
        >
          Revisar empleados sin marcaciones →
        </button>
      )}

      <button
        className={absentEmployees.length > 0 ? 'm3-btn-outlined w-full' : 'm3-btn-filled w-full'}
        onClick={resetTas}
      >
        Nueva carga
      </button>
    </ScreenLayout>
  );
}
