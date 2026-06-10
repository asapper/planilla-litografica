import axios from 'axios';

const client = axios.create({
  baseURL: 'http://localhost:49301/api',
  timeout: 30_000,
});

export const checkHealth = (): Promise<void> =>
  client.get('/health', { timeout: 2_000 }).then(() => undefined);
