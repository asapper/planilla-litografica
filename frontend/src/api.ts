import axios from 'axios';
import type { EmployeeRow, UploadResponse, ValidateResponse, StartJobResponse, JobResponse } from './types';

const client = axios.create({
  baseURL: 'http://localhost:49301/api',
  timeout: 30_000,
});

export const uploadCsv = (file: File): Promise<UploadResponse> => {
  const form = new FormData();
  form.append('file', file);
  return client.post<UploadResponse>('/upload', form).then(r => r.data);
};

export const validateRows = (rows: EmployeeRow[]): Promise<ValidateResponse> =>
  client.post<ValidateResponse>('/validate', rows).then(r => r.data);

export const startJob = (rows: EmployeeRow[]): Promise<StartJobResponse> =>
  client.post<StartJobResponse>('/submit', rows).then(r => r.data);

export const getJob = (jobId: string): Promise<JobResponse> =>
  client.get<JobResponse>(`/jobs/${jobId}`).then(r => r.data);

export const retryJob = (jobId: string): Promise<StartJobResponse> =>
  client.post<StartJobResponse>(`/jobs/${jobId}/retry`).then(r => r.data);

export const checkHealth = (): Promise<void> =>
  client.get('/health', { timeout: 2_000 }).then(() => undefined);

export const checkDbHealth = (): Promise<void> =>
  client.get('/db-health', { timeout: 5_000 }).then(() => undefined);
