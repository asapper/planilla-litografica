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
import PendingOvertimeDialog, { type PendingOvertimeItem } from './PendingOvertimeDialog';
import { effectiveOvertime, inPeriod, needsReview } from '../../overtime';
import type { IncompletePeriod } from '../../tasTypes';

const COVERAGE_FAILED_MESSAGE = 'No se pudo verificar que el archivo cubra la quincena completa.';

export default function ReviewScreen() {
  const uploadToken = useTasStore(s => s.uploadToken);
  const overtimeDecisions = useTasStore(s => inPeriod(s.overtimeDecisions, s.selectedPeriod));
  const nonWorkedDaysOverrides = useTasStore(s => inPeriod(s.nonWorkedDaysOverrides, s.selectedPeriod));
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
  const [confirmPending, setConfirmPending] = useState(false);
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
      // Every accruing row, duplicates included: the backend sends an unlisted row's overtime as zero, and
      // it is the job, not this screen, that finally decides which rows are duplicates.
      const overtime: Record<string, { horasExtrasSimples: number; horasExtrasDobles: number }> = {};
      for (const row of resolvedRows) {
        if (!row.accruesOvertime) continue;
        const e = effectiveOvertime(row, overtimeDecisions[row.codigoEmpleado]);
        overtime[row.codigoEmpleado] = { horasExtrasSimples: e.simples, horasExtrasDobles: e.dobles };
      }
      const filteredNonWorkedDaysOverrides: Record<string, number> = {};
      for (const [code, val] of Object.entries(nonWorkedDaysOverrides)) {
        if (!duplicateSet.has(code)) filteredNonWorkedDaysOverrides[code] = val;
      }
      const { jobId } = await submitTas(uploadToken, overtime, filteredNonWorkedDaysOverrides);
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
    ? buildReport({ rows: resolvedRows, sessionSummaries, overtimeDecisions, nonWorkedDaysOverrides, duplicateCodes, absentEmployees })
    : null;

  // Printed from the click, not an effect: StrictMode re-runs effects and would open the dialog twice.
  const handlePrint = (mode: PrintMode, report: Report) => {
    setPrintDialogOpen(false);
    flushSync(() => setPrintJob({ mode, generatedAt: new Date(), report }));
    window.print();
  };

  const unreviewed: PendingOvertimeItem[] = resolvedRows
    .filter(r => !duplicateSet.has(r.codigoEmpleado))
    .flatMap(r => {
      const e = effectiveOvertime(r, overtimeDecisions[r.codigoEmpleado]);
      if (!needsReview(e)) return [];
      return [{
        code: r.codigoEmpleado,
        name: r.nombreEmpleado,
        calcSimples: r.horasExtrasSimples,
        calcDobles: r.horasExtrasDobles,
        sendsSimples: e.simples,
        sendsDobles: e.dobles,
        changed: e.calcChanged,
        sendsTyped: e.status === 'adjusted',
      }];
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));

  const submitAfterCoverage = () => {
    if (unreviewed.length > 0) setConfirmPending(true);
    else handleSubmit();
  };

  const requestSubmit = () => {
    if (coverage === 'failed' || incompletePeriods.length > 0) setConfirmIncomplete(true);
    else submitAfterCoverage();
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
          onConfirm={() => { setConfirmIncomplete(false); submitAfterCoverage(); }}
          onCancel={() => setConfirmIncomplete(false)}
          focusCancel
        />
      )}
      {confirmPending && (
        <PendingOvertimeDialog
          items={unreviewed}
          onSubmit={() => { setConfirmPending(false); handleSubmit(); }}
          onCancel={() => setConfirmPending(false)}
        />
      )}
    </div>
  );
}
