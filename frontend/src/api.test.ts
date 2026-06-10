import { describe, it, expect, vi } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    create: () => ({ get: mockGet }),
  },
}));

const { checkHealth } = await import('./api');

describe('checkHealth', () => {
  it('resolves when the health endpoint responds', async () => {
    mockGet.mockResolvedValue({ data: 'ok' });
    await expect(checkHealth()).resolves.toBeUndefined();
    expect(mockGet).toHaveBeenCalledWith('/health', { timeout: 2_000 });
  });
});
