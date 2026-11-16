import { invoke } from '@tauri-apps/api/core';

export type BackendStatus =
  | { state: 'unmanaged' }
  | { state: 'running' }
  | { state: 'port_blocked'; port: number }
  | { state: 'exited'; exitCode: number | null };

export type BackendStartFailure = Extract<BackendStatus, { state: 'port_blocked' | 'exited' }>;

// Resolves to null outside the Tauri shell (browser dev, tests) where the command doesn't exist.
export const getBackendStatus = async (): Promise<BackendStatus | null> => {
  try {
    return await invoke<BackendStatus>('backend_status');
  } catch {
    return null;
  }
};

export const asStartFailure = (status: BackendStatus | null): BackendStartFailure | null =>
  status?.state === 'port_blocked' || status?.state === 'exited' ? status : null;
