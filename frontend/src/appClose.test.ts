import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockListen = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

const { onAppCloseRequested, APP_CLOSE_EVENT } = await import('./appClose');

const flushPromises = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
});

function captureHandler(unlisten = vi.fn()) {
  let handler!: () => Promise<void>;
  mockListen.mockImplementation(async (_event: string, h: () => Promise<void>) => {
    handler = h;
    return unlisten;
  });
  return { handler: () => handler(), unlisten };
}

describe('onAppCloseRequested', () => {
  it('saves first, then tells the shell it may close', async () => {
    const order: string[] = [];
    const h = captureHandler();
    mockInvoke.mockImplementation(async (cmd: string) => { order.push(cmd); });
    onAppCloseRequested(async () => { order.push('save'); });
    await flushPromises();

    expect(mockListen).toHaveBeenCalledWith(APP_CLOSE_EVENT, expect.any(Function));
    await h.handler();
    expect(order).toEqual(['save', 'close_ready']);
  });

  it('still lets the shell close when the save fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = captureHandler();
    onAppCloseRequested(async () => { throw new Error('down'); });
    await flushPromises();

    await h.handler();
    expect(mockInvoke).toHaveBeenCalledWith('close_ready');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a failing close_ready (outside the shell) does not throw', async () => {
    const h = captureHandler();
    mockInvoke.mockRejectedValue(new Error('no shell'));
    onAppCloseRequested(async () => undefined);
    await flushPromises();
    await expect(h.handler()).resolves.toBeUndefined();
  });

  it('stops listening on cleanup, even before the listener is registered', async () => {
    const h = captureHandler();
    const stop = onAppCloseRequested(async () => undefined);
    stop();
    await flushPromises();
    expect(h.unlisten).toHaveBeenCalledTimes(1);

    const later = captureHandler();
    const stopLater = onAppCloseRequested(async () => undefined);
    await flushPromises();
    stopLater();
    expect(later.unlisten).toHaveBeenCalledTimes(1);
  });

  it('is a no-op outside the desktop shell', async () => {
    mockListen.mockRejectedValue(new Error('not tauri'));
    const stop = onAppCloseRequested(async () => undefined);
    await flushPromises();
    expect(() => stop()).not.toThrow();
  });
});
