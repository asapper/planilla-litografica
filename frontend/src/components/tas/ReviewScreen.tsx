import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useTasStore } from '../../tasStore';
import { submitTas, checkDuplicates, getIncompletePeriods } from '../../tasApi';
import { checkDbHealth } from '../../api';
import { useToastStore } from '../../toastStore';
import ReviewListView from './ReviewListView';
import ReviewDetailView from './ReviewDetailView';
import ConfirmModal from '../ui/ConfirmModal';
import { incompleteConfirmText } from './coverageText';
import type { IncompletePeriod } from '../../tasTypes';

export default function ReviewScreen() {
  const uploadToken = useTasStore(s => s.uploadToken);
  const overtimeOverrides = useTasStore(s => s.overtimeOverrides);
  const nonWorkedDaysOverrides = useTasStore(s => s.nonWorkedDaysOverrides);
  const setTasView = useTasStore(s => s.setTasView);
  const setJobId = useTasStore(s => s.setJobId);
  const duplicateCodes = useTasStore(s => s.duplicateCodes);
  const setDuplicateCodes = useTasStore(s => s.setDuplicateCodes);
  const setDuplicatesLoading = useTasStore(s => s.setDuplicatesLoading);
  const reviewSelectedEmployee = useTasStore(s => s.reviewSelectedEmployee);
  const setReviewSelectedEmployee = useTasStore(s => s.setReviewSelectedEmployee);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, []);

  const [dbHealthy, setDbHealthy] = useState<boolean | null>(null);
  const [incompletePeriods, setIncompletePeriods] = useState<IncompletePeriod[]>([]);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const healthy = await checkDbHealth();
      if (!cancelled) setDbHealthy(healthy);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!uploadToken) return;
    let cancelled = false;
    setDuplicatesLoading(true);
    checkDuplicates(uploadToken)
      .then(codes => { if (!cancelled) setDuplicateCodes(codes); })
      .catch(() => { if (!cancelled) useToastStore.getState().showToast('No se pudo verificar duplicados. Los registros se enviarán sin verificación.', 'error'); })
      .finally(() => { if (!cancelled) setDuplicatesLoading(false); });
    return () => { cancelled = true; };
  }, [uploadToken, setDuplicateCodes, setDuplicatesLoading]);

  useEffect(() => {
    if (!uploadToken) return;
    let cancelled = false;
    getIncompletePeriods(uploadToken)
      .then(periods => { if (!cancelled) setIncompletePeriods(periods); })
      .catch(() => { if (!cancelled) useToastStore.getState().showToast('No se pudo verificar que el archivo cubra la quincena completa.', 'error'); });
    return () => { cancelled = true; };
  }, [uploadToken]);

  const duplicateSet = new Set(duplicateCodes);

  const handleSubmit = async () => {
    if (!uploadToken) return;
    try {
      setTasView('submitting');
      const filteredOverrides: Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }> = {};
      for (const [code, val] of Object.entries(overtimeOverrides)) {
        if (!duplicateSet.has(code)) filteredOverrides[code] = val;
      }
      const filteredNonWorkedDaysOverrides: Record<string, number> = {};
      for (const [code, val] of Object.entries(nonWorkedDaysOverrides)) {
        if (!duplicateSet.has(code)) filteredNonWorkedDaysOverrides[code] = val;
      }
      const { jobId } = await submitTas(uploadToken, filteredOverrides, filteredNonWorkedDaysOverrides);
      setJobId(jobId);
      setTasView('polling');
    } catch (err) {
      setTasView('review');
      const msg = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Ocurrió un error al enviar. Intente nuevamente.';
      useToastStore.getState().showToast(msg, 'error');
    }
  };

  const requestSubmit = () => {
    if (incompletePeriods.length > 0) setConfirmIncomplete(true);
    else handleSubmit();
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div ref={scrollRef} className="flex-1 flex flex-col overflow-auto">
        {reviewSelectedEmployee === null ? (
          <ReviewListView dbHealthy={dbHealthy} incompletePeriods={incompletePeriods} onSubmit={requestSubmit} />
        ) : (
          <ReviewDetailView onBack={() => setReviewSelectedEmployee(null)} />
        )}
      </div>
      {confirmIncomplete && (
        <ConfirmModal
          title="Quincena incompleta"
          message={incompleteConfirmText(incompletePeriods)}
          confirmLabel="Enviar de todas formas"
          cancelLabel="Cancelar"
          onConfirm={() => { setConfirmIncomplete(false); handleSubmit(); }}
          onCancel={() => setConfirmIncomplete(false)}
        />
      )}
    </div>
  );
}
