import { useTasStore } from '../../tasStore';
import ProcessingScreen from './ProcessingScreen';
import ReactivationReviewScreen from './ReactivationReviewScreen';
import VerificationScreen from './VerificationScreen';
import TasResultScreen from './TasResultScreen';
import AbsentReviewOverlay from './AbsentReviewOverlay';
import Spinner from '../ui/Spinner';

interface Props {
  fileName: string;
}

export default function TasUploadFlow({ fileName }: Props) {
  const tasView = useTasStore(s => s.tasView);

  if (tasView === 'idle') return null;

  if (tasView === 'processing') {
    return <ProcessingScreen fileName={fileName} />;
  }

  if (tasView === 'inactiveReview') {
    return <ReactivationReviewScreen />;
  }

  if (tasView === 'verification') {
    return <VerificationScreen />;
  }

  if (tasView === 'submitting') {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-white/80">
        <Spinner size="w-10 h-10" />
        <p className="text-title-md text-primary">Enviando...</p>
      </div>
    );
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
