import { describe, it, expect, vi } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    create: () => ({ get: mockGet }),
  },
}));

const { checkHealth, checkDbHealth } = await import('./api');

describe('checkHealth', () => {
  it('resolves when the health endpoint responds', async () => {
    mockGet.mockResolvedValue({ data: 'ok' });
    await expect(checkHealth()).resolves.toBeUndefined();
    expect(mockGet).toHaveBeenCalledWith('/health', { timeout: 2_000 });
  });
});

describe('checkDbHealth', () => {
  it('returns true when db-health responds ok', async () => {
    mockGet.mockResolvedValue({ data: { status: 'ok' } });
    await expect(checkDbHealth()).resolves.toBe(true);
    expect(mockGet).toHaveBeenCalledWith('/db-health', { timeout: 3_000 });
  });

  it('returns false when db-health responds with error status', async () => {
    mockGet.mockRejectedValue(new Error('503'));
    await expect(checkDbHealth()).resolves.toBe(false);
  });
});
