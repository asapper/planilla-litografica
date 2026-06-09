import axios from 'axios';
import type { TasUploadResult, TasResolveResult, AbsentEmployee } from './tasTypes';

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
  resolutions: { sessionId: number; resolvedStart: string; resolvedEnd: string; updateShift?: boolean }[],
): Promise<TasResolveResult> =>
  client.post<TasResolveResult>('/tas/resolve', { uploadToken: token, resolutions }).then(r => r.data);

export const submitTas = (token: string): Promise<{ jobId: string }> =>
  client.post<{ jobId: string }>('/tas/submit', { uploadToken: token }).then(r => r.data);

export const getAbsentReview = (token: string): Promise<{ absentEmployees: AbsentEmployee[] }> =>
  client.get<{ absentEmployees: AbsentEmployee[] }>(`/tas/absent-review/${token}`).then(r => r.data);

export const deactivateAbsentEmployees = (token: string, employeeIds: string[]): Promise<void> =>
  client.post(`/tas/absent-review/${token}/deactivate`, { employeeIds }).then(() => undefined);
