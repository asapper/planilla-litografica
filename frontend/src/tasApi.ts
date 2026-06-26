import axios from 'axios';
import type { TasUploadResult, TasResolveResult, AbsentEmployee, TasPeriod, ResolvedRow, SessionSummary, JobStatus } from './tasTypes';

export type TasResolution =
  | { sessionId: number; resolvedStart: string; resolvedEnd: string }
  | { sessionId: number; acceptedShiftId: string }
  | { employeeId: string; date: string; keepSessionId: number | 'all' };

const client = axios.create({
  baseURL: 'http://localhost:49301/api',
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
  overtimeOverrides: Record<string, { horasExtrasSimples?: number; horasExtrasDobles?: number }>,
  nonWorkedDaysOverrides: Record<string, number>,
): Promise<{ jobId: string }> =>
  client.post<{ jobId: string }>('/tas/submit', { uploadToken: token, overtimeOverrides, nonWorkedDaysOverrides }).then(r => r.data);

export const getAbsentReview = (token: string): Promise<{ absentEmployees: AbsentEmployee[] }> =>
  client.get<{ absentEmployees: AbsentEmployee[] }>(`/tas/absent-review/${token}`).then(r => r.data);

export const setAbsentEmployeesActive = (token: string, employeeIds: string[], active: boolean): Promise<void> =>
  client.post(`/tas/absent-review/${token}/deactivate`, { employeeIds, active }).then(() => undefined);

export const recomputeTas = (token: string): Promise<{ uploadToken: string; resolvedRows: ResolvedRow[]; sessionSummaries: Record<string, SessionSummary[]> }> =>
  client.post<{ uploadToken: string; resolvedRows: ResolvedRow[]; sessionSummaries: Record<string, SessionSummary[]> }>(`/tas/recompute/${token}`).then(r => r.data);

export const checkDuplicates = (uploadToken: string): Promise<string[]> =>
  client.post<{ duplicates: string[] }>('/tas/check-duplicates', { uploadToken }).then(r => r.data.duplicates);

export const getTasJobStatus = (jobId: string): Promise<JobStatus> =>
  client.get<JobStatus>(`/tas/jobs/${jobId}`).then(r => r.data);

export const retryTasJob = (jobId: string): Promise<{ jobId: string }> =>
  client.post<{ jobId: string }>(`/tas/jobs/${jobId}/retry`).then(r => r.data);
