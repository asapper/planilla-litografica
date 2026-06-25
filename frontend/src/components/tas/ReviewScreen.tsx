import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useTasStore } from '../../tasStore';
import { submitTas, checkDuplicates } from '../../tasApi';
import { checkDbHealth } from '../../api';
import { useToastStore } from '../../toastStore';
import ReviewListView from './ReviewListView';
import ReviewDetailView from './ReviewDetailView';

export default function ReviewScreen() {
  const uploadToken = useTasStore(s => s.uploadToken);
  const overtimeOverrides = useTasStore(s => s.overtimeOverrides);
  const diasNoLaboradosOverrides = useTasStore(s => s.diasNoLaboradosOverrides);
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

  const duplicateSet = new Set(duplicateCodes);

  const handleSubmit = async () => {
    if (!uploadToken) return;
    try {
      setTasView('submitting');
      const filteredOverrides: Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }> = {};
      for (const [code, val] of Object.entries(overtimeOverrides)) {
        if (!duplicateSet.has(code)) filteredOverrides[code] = val;
      }
      const filteredDiasOverrides: Record<string, number> = {};
      for (const [code, val] of Object.entries(diasNoLaboradosOverrides)) {
        if (!duplicateSet.has(code)) filteredDiasOverrides[code] = val;
      }
      const { jobId } = await submitTas(uploadToken, filteredOverrides, filteredDiasOverrides);
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

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div ref={scrollRef} className="flex-1 flex flex-col overflow-auto">
        {reviewSelectedEmployee === null ? (
          <ReviewListView dbHealthy={dbHealthy} onSubmit={handleSubmit} />
        ) : (
          <ReviewDetailView onBack={() => setReviewSelectedEmployee(null)} />
        )}
      </div>
    </div>
  );
}
