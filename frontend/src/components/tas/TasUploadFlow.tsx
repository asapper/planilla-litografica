import { useTasStore } from '../../tasStore';
import AlertMessage from '../ui/AlertMessage';
import ProcessingScreen from './ProcessingScreen';
import ReactivationReviewScreen from './ReactivationReviewScreen';
import VerificationScreen from './VerificationScreen';
import ReviewScreen from './ReviewScreen';
import TasResultScreen from './TasResultScreen';
import PollingScreen from './PollingScreen';
import AbsentReviewOverlay from './AbsentReviewOverlay';
import Spinner from '../ui/Spinner';

interface Props {
  fileName: string;
}

export default function TasUploadFlow({ fileName }: Props) {
  const tasView  = useTasStore(s => s.tasView);
  const warnings = useTasStore(s => s.warnings);

  if (tasView === 'idle') return null;

  if (tasView === 'processing') {
    return <ProcessingScreen fileName={fileName} />;
  }

  const warningBanner = warnings.length > 0 && (
    <div className="px-6 pt-4">
      {warnings.map((w, i) => (
        <AlertMessage key={i} message={w} variant="warning" />
      ))}
    </div>
  );

  if (tasView === 'inactiveReview') {
    return <>{warningBanner}<ReactivationReviewScreen /></>;
  }

  if (tasView === 'verification') {
    return <>{warningBanner}<VerificationScreen /></>;
  }

  if (tasView === 'review') {
    return <>{warningBanner}<ReviewScreen /></>;
  }

  if (tasView === 'submitting') {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-white/80">
        <Spinner size="w-10 h-10" />
        <p className="text-title-md text-primary">Enviando...</p>
      </div>
    );
  }

  if (tasView === 'polling') {
    return <PollingScreen />;
  }

  if (tasView === 'result') {
    return <TasResultScreen />;
  }

  if (tasView === 'absentReview') {
    return (
      <>
        <TasResultScreen />
        <AbsentReviewOverlay />
      </>
    );
  }

  return null;
}
