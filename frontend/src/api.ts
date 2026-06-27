import axios from 'axios';
import { API_BASE } from './constants/api';

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
});

export const checkHealth = (): Promise<void> =>
  client.get('/health', { timeout: 2_000 }).then(() => undefined);

export const checkDbHealth = (): Promise<boolean> =>
  client.get('/db-health', { timeout: 3_000 }).then(() => true).catch(() => false);
