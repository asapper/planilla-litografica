import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import axios from 'axios';
import { useTasStore } from '../../tasStore';
import { submitTas, checkDuplicates, getIncompletePeriods } from '../../tasApi';
import { checkDbHealth } from '../../api';
import { useToastStore } from '../../toastStore';
import ReviewListView from './ReviewListView';
import ReviewDetailView from './ReviewDetailView';
import ConfirmModal from '../ui/ConfirmModal';
import PrintDialog from './PrintDialog';
import PrintReport from './PrintReport';
import { buildReport, type PrintMode, type Report } from './reviewReport';
import { incompleteConfirmText } from './coverageText';
import type { IncompletePeriod } from '../../tasTypes';

const COVERAGE_FAILED_MESSAGE = 'No se pudo verificar que el archivo cubra la quincena completa.';

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
  const resolvedRows = useTasStore(s => s.resolvedRows);
  const sessionSummaries = useTasStore(s => s.sessionSummaries);
  const selectedPeriod = useTasStore(s => s.selectedPeriod);
  const usedFallbackHolidays = useTasStore(s => s.usedFallbackHolidays);
  const absentEmployees = useTasStore(s => s.absentEmployees);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, []);

  const [dbHealthy, setDbHealthy] = useState<boolean | null>(null);
  const [coverage, setCoverage] = useState<IncompletePeriod[] | 'failed' | null>(null);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printJob, setPrintJob] = useState<{ mode: PrintMode; generatedAt: Date; report: Report } | null>(null);

  useEffect(() => {
    const done = () => setPrintJob(null);
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, []);

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
      .then(periods => { if (!cancelled) setCoverage(periods); })
      .catch(() => {
        if (cancelled) return;
        setCoverage('failed');
        useToastStore.getState().showToast(COVERAGE_FAILED_MESSAGE, 'error');
      });
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

  const incompletePeriods = Array.isArray(coverage) ? coverage : [];
  const coverageLoading = uploadToken !== null && coverage === null;

  const printableReport = printDialogOpen
    ? buildReport({ rows: resolvedRows, sessionSummaries, overtimeOverrides, nonWorkedDaysOverrides, duplicateCodes, absentEmployees })
    : null;

  // Printed from the click, not an effect: StrictMode re-runs effects and would open the dialog twice.
  const handlePrint = (mode: PrintMode, report: Report) => {
    setPrintDialogOpen(false);
    flushSync(() => setPrintJob({ mode, generatedAt: new Date(), report }));
    window.print();
  };

  const requestSubmit = () => {
    if (coverage === 'failed' || incompletePeriods.length > 0) setConfirmIncomplete(true);
    else handleSubmit();
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-container-lowest" style={{ paddingTop: 64 }}>
      <div ref={scrollRef} className="flex-1 flex flex-col overflow-auto">
        {reviewSelectedEmployee === null ? (
          <ReviewListView
            dbHealthy={dbHealthy}
            coverageLoading={coverageLoading}
            incompletePeriods={incompletePeriods}
            onSubmit={requestSubmit}
            onPrint={() => setPrintDialogOpen(true)}
          />
        ) : (
          <ReviewDetailView onBack={() => setReviewSelectedEmployee(null)} />
        )}
      </div>
      {printableReport && (
        <PrintDialog
          employeeCount={printableReport.employees.length}
          onCancel={() => setPrintDialogOpen(false)}
          onPrint={mode => handlePrint(mode, printableReport)}
        />
      )}
      {printJob && (
        <PrintReport
          report={printJob.report}
          mode={printJob.mode}
          period={selectedPeriod}
          generatedAt={printJob.generatedAt}
          incompletePeriods={incompletePeriods}
          coverageUnverified={coverage === 'failed'}
          usedFallbackHolidays={usedFallbackHolidays}
        />
      )}
      {confirmIncomplete && (
        <ConfirmModal
          title={coverage === 'failed' ? 'Quincena sin verificar' : 'Quincena incompleta'}
          message={coverage === 'failed'
            ? `${COVERAGE_FAILED_MESSAGE} ¿Desea enviar de todas formas?`
            : incompleteConfirmText(incompletePeriods)}
          confirmLabel="Enviar de todas formas"
          cancelLabel="Cancelar"
          onConfirm={() => { setConfirmIncomplete(false); handleSubmit(); }}
          onCancel={() => setConfirmIncomplete(false)}
          focusCancel
        />
      )}
    </div>
  );
}
