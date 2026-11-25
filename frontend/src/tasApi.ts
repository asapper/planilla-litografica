import axios from 'axios';
import { API_BASE } from './constants/api';
import type { TasUploadResult, TasResolveResult, AbsentEmployee, TasPeriod, IncompletePeriod, ResolvedRow, SessionSummary, JobStatus, DraftSummary, DraftView } from './tasTypes';

export type TasResolution =
  | { sessionId: number; resolvedStart: string; resolvedEnd: string }
  | { sessionId: number; acceptedShiftId: string }
  | { employeeId: string; date: string; keepSessionId: number | 'all' };

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
});

export const uploadTasFile = (file: File): Promise<TasUploadResult> => {
  const form = new FormData();
  form.append('file', file);
  return client.post<TasUploadResult>('/tas/upload', form).then(r => r.data);
};

export const submitInactiveReview = (
  token: string,
  reactivate: string[],
  ignore: string[],
): Promise<TasUploadResult> =>
  client.post<TasUploadResult>('/tas/inactive-review', { uploadToken: token, reactivate, ignore }).then(r => r.data);

export const resolveVerification = (
  token: string,
  resolutions: TasResolution[],
  period?: TasPeriod | null,
): Promise<TasResolveResult> => {
  const body: Record<string, unknown> = { uploadToken: token, resolutions };
  if (period) {
    body.anio = period.anio;
    body.mes = period.mes;
    body.numeroDequincena = period.numeroDequincena;
  }
  return client.post<TasResolveResult>('/tas/resolve', body).then(r => r.data);
};

export const submitTas = (
  token: string,
  overtimeOverrides: Record<string, { horasExtrasSimples: number; horasExtrasDobles: number }>,
  nonWorkedDaysOverrides: Record<string, number>,
): Promise<{ jobId: string }> =>
  client.post<{ jobId: string }>('/tas/submit', { uploadToken: token, overtimeOverrides, nonWorkedDaysOverrides }).then(r => r.data);

export const getAbsentReview = (token: string): Promise<{ absentEmployees: AbsentEmployee[] }> =>
  client.get<{ absentEmployees: AbsentEmployee[] }>(`/tas/absent-review/${token}`).then(r => r.data);

export const setAbsentEmployeesActive = (token: string, employeeIds: string[], active: boolean): Promise<{ updated: number; notFound: string[] }> =>
  client.post<{ updated: number; notFound: string[] }>(`/tas/absent-review/${token}/deactivate`, { employeeIds, active }).then(r => r.data);

export interface RecomputeResult {
  uploadToken: string;
  stateRevision: number;
  resolvedRows: ResolvedRow[];
  sessionSummaries: Record<string, SessionSummary[]>;
}

export const recomputeTas = (token: string): Promise<RecomputeResult> =>
  client.post<RecomputeResult>(`/tas/recompute/${token}`).then(r => r.data);

export const getIncompletePeriods = (token: string): Promise<IncompletePeriod[]> =>
  client.get<{ incompletePeriods: IncompletePeriod[] }>(`/tas/coverage/${token}`).then(r => r.data.incompletePeriods);

export const checkDuplicates = (uploadToken: string): Promise<string[]> =>
  client.post<{ duplicates: string[] }>('/tas/check-duplicates', { uploadToken }).then(r => r.data.duplicates);

export const getTasJobStatus = (jobId: string): Promise<JobStatus> =>
  client.get<JobStatus>(`/tas/jobs/${jobId}`).then(r => r.data);

export const retryTasJob = (jobId: string): Promise<{ jobId: string }> =>
  client.post<{ jobId: string }>(`/tas/jobs/${jobId}/retry`).then(r => r.data);

export interface SaveDraftBody {
  uploadToken: string;
  stateRevision: number;
  fileName: string | null;
  view: DraftView;
  periodLabel: string | null;
  ui: Record<string, unknown>;
}

export const getDraftSummary = (): Promise<DraftSummary | null> =>
  client.get<DraftSummary>('/tas/draft').then(r => (r.status === 204 ? null : r.data));

export const saveDraft = (body: SaveDraftBody): Promise<void> =>
  client.put('/tas/draft', body).then(() => undefined);

export const deleteDraft = (): Promise<void> =>
  client.delete('/tas/draft').then(() => undefined);

export const resumeDraft = (): Promise<{ uploadToken: string; ui: Record<string, unknown> }> =>
  client.post<{ uploadToken: string; ui: Record<string, unknown> }>('/tas/draft/resume').then(r => r.data);
