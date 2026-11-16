import { describe, it, expect, vi } from 'vitest';

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

const { getBackendStatus, asStartFailure } = await import('./backendStatus');

describe('getBackendStatus', () => {
  it('returns the status reported by the shell', async () => {
    mockInvoke.mockResolvedValueOnce({ state: 'port_blocked', port: 41301 });
    await expect(getBackendStatus()).resolves.toEqual({ state: 'port_blocked', port: 41301 });
    expect(mockInvoke).toHaveBeenCalledWith('backend_status');
  });

  it('returns null when not running inside the shell', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('window.__TAURI_INTERNALS__ is undefined'));
    await expect(getBackendStatus()).resolves.toBeNull();
  });
});

describe('asStartFailure', () => {
  it('treats port_blocked and exited as definitive failures', () => {
    expect(asStartFailure({ state: 'port_blocked', port: 41301 })).toEqual({ state: 'port_blocked', port: 41301 });
    expect(asStartFailure({ state: 'exited', exitCode: 1 })).toEqual({ state: 'exited', exitCode: 1 });
  });

  it('ignores non-failure statuses', () => {
    expect(asStartFailure(null)).toBeNull();
    expect(asStartFailure({ state: 'unmanaged' })).toBeNull();
    expect(asStartFailure({ state: 'running' })).toBeNull();
  });
});
